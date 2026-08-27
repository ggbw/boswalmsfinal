#!/usr/bin/env node
/**
 * Weekly proof that the nightly backup can actually be restored.
 *
 * This is the half of a backup system that people skip, and it is the half
 * that decides whether the other half was worth running. Everything up to here
 * proves that a file was produced and uploaded. Only this proves that the file
 * contains a working database.
 *
 * WHAT IT DOES
 *
 *   1. Fetches the newest dump — and its counts sidecar — back out of Google
 *      Drive. Out of Drive, not off the local disk: the copy in Drive is the
 *      one that would be used in a real recovery, so it is the one that has to
 *      be tested. A test of a local file would not notice a broken upload.
 *   2. Decrypts it, if backups are encrypted, with the passphrase from .env —
 *      which also tests that the passphrase on this machine still opens them.
 *   3. Creates a scratch database on the VPS's own Postgres, lays down a small
 *      shim for the pieces of Supabase a plain server does not have (the auth
 *      schema, auth.uid(), the anon/authenticated/service_role roles), and
 *      restores into it.
 *   4. Counts every table in the restored database and compares each one
 *      against the counts recorded when the dump was taken.
 *   5. Reports pass or fail to the backup-report edge function, which is what
 *      puts "Last verified restore" on the Backup page.
 *   6. Drops the scratch database.
 *
 * WHY THE COUNTS COMPARISON MATTERS
 *
 * `pg_restore` exiting 0 is a weak claim: it exits 0 for a dump of an empty
 * database. Comparing all sixty-odd tables against the counts captured in the
 * same connection as the dump turns the test into a real assertion — every row
 * that was there is here.
 *
 * Usage:  node db-restore-test.mjs [--keep] [--file /path/to.dump]
 *         --keep  leave the scratch database in place for inspection
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const BASE_DIR = process.env.BACKUP_BASE_DIR || '/opt/db-backup-boswa';
const WORK_DIR = path.join(BASE_DIR, 'restore-test');

const KEEP = process.argv.includes('--keep');
const fileArgIndex = process.argv.indexOf('--file');
const FILE_ARG = fileArgIndex > -1 ? process.argv[fileArgIndex + 1] : null;

const log = (...a) => console.log(`[${new Date().toISOString()}]`, ...a);
const fail = (...a) => console.error(`[${new Date().toISOString()}] ERROR`, ...a);

/**
 * The Supabase-shaped hole in a plain Postgres.
 *
 * A dump of Supabase's `public` schema carries RLS policies that call
 * auth.uid(), grants to roles named anon/authenticated/service_role, and
 * foreign keys onto auth.users. None of those exist on a stock server, and
 * without them pg_restore reports hundreds of errors that drown the real ones.
 *
 * These are stubs, not Supabase: auth.uid() returns null and auth.users is an
 * empty shell. That is exactly right for a restore *test*, whose question is
 * "did the data and its structure survive", not "does the API work". A real
 * recovery restores into a fresh Supabase project, which brings its own auth
 * schema — see §8.3.
 */
const SHIM_SQL = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

DO $shim$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role','supabase_admin',
                           'supabase_auth_admin','authenticator','dashboard_user']
  LOOP
    BEGIN
      EXECUTE format('CREATE ROLE %I NOLOGIN NOINHERIT', r);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END LOOP;
END
$shim$;

CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

-- Enough of auth.users for the public schema's foreign keys to attach to.
CREATE TABLE IF NOT EXISTS auth.users (
  id                 uuid PRIMARY KEY,
  email              text,
  raw_user_meta_data jsonb,
  created_at         timestamptz DEFAULT now()
);

CREATE OR REPLACE FUNCTION auth.uid()  RETURNS uuid  LANGUAGE sql STABLE AS $f$ SELECT NULL::uuid $f$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text  LANGUAGE sql STABLE AS $f$ SELECT NULL::text $f$;
CREATE OR REPLACE FUNCTION auth.jwt()  RETURNS jsonb LANGUAGE sql STABLE AS $f$ SELECT '{}'::jsonb $f$;

CREATE SCHEMA IF NOT EXISTS storage;
CREATE TABLE IF NOT EXISTS storage.buckets (id text PRIMARY KEY, name text, public boolean);
CREATE TABLE IF NOT EXISTS storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text, name text, owner uuid, metadata jsonb
);
`;

// ─── Config ───────────────────────────────────────────────────────────────────

// Same rule as db-backup.mjs: the .env file is optional, because in CI the
// values arrive as secrets already in the environment.
function loadEnv() {
  const file = path.join(BASE_DIR, '.env');
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (m) process.env[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
    }
  }
  const cfg = {
    supabaseUrl: (process.env.SUPABASE_URL || '').replace(/\/$/, ''),
    reportSecret: process.env.BACKUP_REPORT_SECRET,
    rcloneRemote: process.env.RCLONE_REMOTE,
    gpgPassphrase: process.env.GPG_PASSPHRASE || '',
    // A superuser connection to the VPS's own Postgres — the scratch server.
    // Never the production URI: this script creates and drops databases.
    localPgUri: process.env.LOCAL_PGURI || 'postgresql://postgres@localhost:5432/postgres',
    label: process.env.BACKUP_LABEL || 'boswa',
  };
  for (const k of ['supabaseUrl', 'reportSecret', 'rcloneRemote']) {
    if (!cfg[k]) throw new Error(`Missing ${k.toUpperCase()} in ${file}`);
  }
  if (cfg.localPgUri.includes('supabase.co') || cfg.localPgUri.includes('pooler.supabase.com')) {
    // Worth a hard stop rather than a warning. This script drops databases.
    throw new Error('LOCAL_PGURI points at Supabase. It must point at the VPS\'s own Postgres.');
  }
  return cfg;
}

async function report(cfg, body) {
  try {
    const res = await fetch(`${cfg.supabaseUrl}/functions/v1/backup-report`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-backup-secret': cfg.reportSecret },
      body: JSON.stringify(body),
    });
    return await res.json().catch(() => ({}));
  } catch (e) {
    fail('backup-report unreachable:', e.message);
    return {};
  }
}

// ─── Fetching the newest backup ───────────────────────────────────────────────

function newestFromDrive(cfg) {
  const listing = JSON.parse(
    execFileSync('rclone', ['lsjson', `${cfg.rcloneRemote}/daily`], { encoding: 'utf8', maxBuffer: 8 << 20 }),
  );
  const dumps = listing
    .filter((f) => /\.dump(\.gpg)?$/.test(f.Name))
    .sort((a, b) => (a.ModTime < b.ModTime ? 1 : -1));
  if (!dumps.length) throw new Error(`No dumps found in ${cfg.rcloneRemote}/daily`);

  const dump = dumps[0];
  const stem = dump.Name.replace(/\.dump(\.gpg)?$/, '');
  const counts = `${stem}.counts.json`;

  fs.mkdirSync(WORK_DIR, { recursive: true });
  log(`Newest backup in Drive: ${dump.Name} (${(dump.Size / 1048576).toFixed(1)} MB)`);

  execFileSync('rclone', ['copy', `${cfg.rcloneRemote}/daily/${dump.Name}`, WORK_DIR], { stdio: 'inherit' });
  execFileSync('rclone', ['copy', `${cfg.rcloneRemote}/daily/${counts}`, WORK_DIR], { stdio: 'inherit' });

  return {
    dumpFile: path.join(WORK_DIR, dump.Name),
    countsFile: path.join(WORK_DIR, counts),
    name: dump.Name,
  };
}

function decryptIfNeeded(file, passphrase) {
  if (!file.endsWith('.gpg')) return file;
  if (!passphrase) throw new Error('The backup is encrypted but GPG_PASSPHRASE is empty.');
  const out = file.replace(/\.gpg$/, '');
  execFileSync('gpg', ['--batch', '--yes', '--passphrase-fd', '0', '--decrypt', '--output', out, file], {
    input: passphrase,
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  log('Decrypted.');
  return out;
}

// ─── The scratch database ─────────────────────────────────────────────────────

const psql = (uri, sql, opts = {}) =>
  execFileSync('psql', [uri, '-v', 'ON_ERROR_STOP=1', '-Atqc', sql], {
    encoding: 'utf8',
    maxBuffer: 32 << 20,
    ...opts,
  });

function scratchUri(cfg, dbName) {
  // Swap the database at the end of the URI, keeping host, credentials and any
  // query parameters intact.
  const u = new URL(cfg.localPgUri);
  u.pathname = `/${dbName}`;
  return u.toString();
}

const COUNT_SQL = `
  SELECT coalesce(json_object_agg(t.tbl, t.n), '{}'::json)::text
    FROM (
      SELECT c.relname AS tbl,
             (xpath('/row/c/text()',
                    query_to_xml(format('SELECT count(*) AS c FROM public.%I', c.relname),
                                 false, true, '')))[1]::text::bigint AS n
        FROM pg_class c
        JOIN pg_namespace ns ON ns.oid = c.relnamespace
       WHERE ns.nspname = 'public' AND c.relkind = 'r' AND c.relpersistence = 'p'
    ) t`;

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const cfg = loadEnv();
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const dbName = `restore_test_${cfg.label}_${stamp}`;

  const started = await report(cfg, {
    action: 'start',
    kind: 'restore_test',
    actor: `vps:${os.hostname()}`,
    destination: `local scratch database ${dbName}`,
  });
  const runId = started?.id ?? null;

  let created = false;
  try {
    // ── 1. Get the artifact ────────────────────────────────────────────────
    let dumpFile, countsFile, name;
    if (FILE_ARG) {
      dumpFile = FILE_ARG;
      countsFile = FILE_ARG.replace(/\.dump(\.gpg)?$/, '.counts.json');
      name = path.basename(FILE_ARG);
    } else {
      ({ dumpFile, countsFile, name } = newestFromDrive(cfg));
    }
    dumpFile = decryptIfNeeded(dumpFile, cfg.gpgPassphrase);

    const expected = fs.existsSync(countsFile)
      ? JSON.parse(fs.readFileSync(countsFile, 'utf8')).counts
      : null;
    if (!expected) {
      throw new Error(`No counts sidecar next to ${name}; the restore cannot be verified.`);
    }

    // ── 2. Build the scratch database ──────────────────────────────────────
    log(`Creating ${dbName}…`);
    psql(cfg.localPgUri, `DROP DATABASE IF EXISTS ${dbName}`);
    psql(cfg.localPgUri, `CREATE DATABASE ${dbName}`);
    created = true;

    const target = scratchUri(cfg, dbName);
    execFileSync('psql', [target, '-v', 'ON_ERROR_STOP=1', '-q', '-f', '-'], {
      input: SHIM_SQL,
      stdio: ['pipe', 'inherit', 'inherit'],
    });
    log('Supabase shim applied.');

    // ── 3. Restore ─────────────────────────────────────────────────────────
    // pg_restore's exit status is not the verdict. It returns non-zero for
    // harmless things (an extension the scratch server does not carry, a grant
    // to a role the shim did not invent) and the counts comparison below is
    // the real test. Its errors are counted and reported so a run that passes
    // with fifty warnings is visibly different from one that passes clean.
    log('Restoring…');
    let restoreErrors = 0;
    try {
      execFileSync('pg_restore', [
        '--dbname', target,
        '--no-owner', '--no-privileges', '--no-comments',
        dumpFile,
      ], { stdio: ['ignore', 'inherit', 'pipe'], encoding: 'utf8' });
    } catch (e) {
      const stderr = String(e.stderr ?? '');
      restoreErrors = (stderr.match(/^pg_restore: error:/gm) ?? []).length;
      process.stderr.write(stderr);
      log(`pg_restore finished with ${restoreErrors} reported errors — checking the data anyway.`);
    }

    // ── 4. The actual test ─────────────────────────────────────────────────
    const actual = JSON.parse(psql(target, COUNT_SQL).trim() || '{}');

    const mismatches = [];
    for (const [table, n] of Object.entries(expected)) {
      const got = Number(actual[table] ?? -1);
      if (got !== Number(n)) mismatches.push({ table, expected: Number(n), got });
    }
    const totalExpected = Object.values(expected).reduce((s, n) => s + Number(n), 0);
    const totalGot = Object.values(actual).reduce((s, n) => s + Number(n), 0);

    const passed = mismatches.length === 0;
    if (passed) {
      log(`PASS — ${Object.keys(expected).length} tables, ${totalGot} rows, all counts match.`);
    } else {
      fail(`FAIL — ${mismatches.length} table(s) do not match:`);
      for (const m of mismatches.slice(0, 20)) {
        fail(`  ${m.table}: expected ${m.expected}, restored ${m.got === -1 ? 'MISSING' : m.got}`);
      }
    }

    await report(cfg, {
      action: 'finish',
      id: runId,
      kind: 'restore_test',
      status: passed ? 'success' : 'failed',
      artifact: name,
      destination: `local scratch database ${dbName}`,
      table_count: Object.keys(actual).length,
      row_count: totalGot,
      actor: `vps:${os.hostname()}`,
      message: passed
        ? `Restored and verified ${Object.keys(expected).length} tables / ${totalGot} rows` +
          (restoreErrors ? ` (${restoreErrors} pg_restore warnings)` : '')
        : `${mismatches.length} table(s) mismatched: ` +
          mismatches.slice(0, 5).map((m) => `${m.table} ${m.got}/${m.expected}`).join(', '),
      metadata: { mismatches: mismatches.slice(0, 50), restore_errors: restoreErrors, total_expected: totalExpected },
    });

    process.exitCode = passed ? 0 : 1;
  } catch (e) {
    fail(e.message);
    await report(cfg, {
      action: 'finish',
      id: runId,
      kind: 'restore_test',
      status: 'failed',
      actor: `vps:${os.hostname()}`,
      message: String(e.message).slice(0, 500),
    });
    process.exitCode = 1;
  } finally {
    if (created && !KEEP) {
      try {
        psql(cfg.localPgUri, `DROP DATABASE IF EXISTS ${dbName}`);
        log(`Dropped ${dbName}.`);
      } catch (e) {
        fail(`Could not drop ${dbName}: ${e.message}`);
      }
    }
    // The decrypted dump is plaintext student data on a public-facing box.
    // It does not stay there.
    try { fs.rmSync(WORK_DIR, { recursive: true, force: true }); } catch { /* nothing to clean */ }
  }
}

main().catch((e) => { fail(e.message); process.exit(1); });
