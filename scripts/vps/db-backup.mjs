#!/usr/bin/env node
/**
 * Nightly database backup → Google Drive.
 *
 * Runs from cron on the same Contabo VPS as the Hikvision agent, in its own
 * folder (/opt/db-backup-boswa) with its own .env and its own log, exactly as
 * hik-sync-boswa does. Nothing here is Boswa-specific except the values in
 * that .env, so a second customer is a second folder.
 *
 * WHAT IT PRODUCES, EVERY NIGHT
 *
 *   boswa-db-2026-08-24.dump          pg_dump custom format, compressed
 *   boswa-db-2026-08-24.counts.json   exact row count of every table, taken
 *                                     inside the same connection as the dump
 *
 * The counts sidecar is what makes the weekly restore test meaningful. Without
 * it a restore test can only say "pg_restore exited 0", which is true of a
 * dump of an empty database. With it, db-restore-test.mjs can restore into a
 * scratch server and prove that all 66 tables came back with exactly the
 * number of rows they had when the dump was taken.
 *
 * WHY pg_dump AND NOT THE APP'S OWN EXPORT
 *
 * The Backup page in the LMS writes rows. This writes rows *and* the schema
 * that gives them meaning — tables, types, constraints, indexes, functions,
 * RLS policies, sequences and their current values. Restoring the app's export
 * needs a database that already exists; restoring this one needs an empty
 * Postgres. Only the second answers "the project was deleted".
 *
 * WHY IT REPORTS BACK
 *
 * A cron job that fails quietly is worse than no cron job: it manufactures
 * confidence. Every run — success or failure — is posted to the backup-report
 * edge function, which writes a row the Backup page reads. The page turns red
 * when the newest success is more than 36 hours old. That banner, not this
 * script's exit code, is what someone will actually notice.
 *
 * SETUP AND OPERATION: docs/BACKUP_AND_RESTORE.md §6.
 */

import { execFileSync, execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const BASE_DIR = process.env.BACKUP_BASE_DIR || '/opt/db-backup-boswa';
const WORK_DIR = path.join(BASE_DIR, 'work');
const LOCK_FILE = path.join(BASE_DIR, '.db-backup.lock');

const DRY_RUN = process.argv.includes('--dry-run');
const KEEP_LOCAL = process.argv.includes('--keep-local');

// ─── Logging ──────────────────────────────────────────────────────────────────
// Timestamped, one line per step. cron appends stdout to the log file, so this
// is the whole logging system; `tail -40` must be enough to see what happened.

const log = (...a) => console.log(`[${new Date().toISOString()}]`, ...a);
const fail = (...a) => console.error(`[${new Date().toISOString()}] ERROR`, ...a);

// ─── Config ───────────────────────────────────────────────────────────────────

function loadEnv() {
  const file = path.join(BASE_DIR, '.env');
  if (!fs.existsSync(file)) {
    throw new Error(`No .env at ${file} — copy .env.example and fill it in.`);
  }
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    // Strip one layer of surrounding quotes; a Postgres password full of
    // punctuation is the usual reason someone quotes a value here.
    process.env[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  }

  const cfg = {
    pgUri: process.env.PGURI,
    supabaseUrl: (process.env.SUPABASE_URL || '').replace(/\/$/, ''),
    reportSecret: process.env.BACKUP_REPORT_SECRET,
    rcloneRemote: process.env.RCLONE_REMOTE,          // e.g. gdrive:BoswaLMS-Backups
    keepDays: Number(process.env.KEEP_DAYS || 30),
    gpgPassphrase: process.env.GPG_PASSPHRASE || '',  // empty = no encryption
    mirrorMaxMb: Number(process.env.MIRROR_MAX_MB || 45),
    schemas: (process.env.DUMP_SCHEMAS || 'public').split(',').map((s) => s.trim()).filter(Boolean),
    label: process.env.BACKUP_LABEL || 'boswa',
  };

  for (const k of ['pgUri', 'supabaseUrl', 'reportSecret', 'rcloneRemote']) {
    if (!cfg[k]) throw new Error(`Missing ${k.toUpperCase()} in ${file}`);
  }
  return cfg;
}

// ─── Reporting ────────────────────────────────────────────────────────────────
// Best-effort in both directions. A backup that reached Google Drive must not
// be reported as failed because Supabase was briefly unreachable, and a
// reporting call must never be the thing that aborts a backup.

async function report(cfg, body) {
  try {
    const res = await fetch(`${cfg.supabaseUrl}/functions/v1/backup-report`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-backup-secret': cfg.reportSecret },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) fail(`backup-report ${body.action} → ${res.status}`, json?.error ?? '');
    return json;
  } catch (e) {
    fail(`backup-report ${body.action} unreachable:`, e.message);
    return {};
  }
}

// ─── Locking ──────────────────────────────────────────────────────────────────
// A dump that overruns into the next night would otherwise have two pg_dumps
// and two uploads competing. The lock records the pid so a stale one left by a
// reboot can be told apart from a live run.

function acquireLock() {
  if (fs.existsSync(LOCK_FILE)) {
    const pid = Number(fs.readFileSync(LOCK_FILE, 'utf8').trim());
    let alive = false;
    try { process.kill(pid, 0); alive = true; } catch { alive = false; }
    if (alive) throw new Error(`Another backup is already running (pid ${pid})`);
    log(`Clearing stale lock from pid ${pid}`);
    fs.unlinkSync(LOCK_FILE);
  }
  fs.writeFileSync(LOCK_FILE, String(process.pid));
}
const releaseLock = () => { try { fs.unlinkSync(LOCK_FILE); } catch { /* already gone */ } };

// ─── Steps ────────────────────────────────────────────────────────────────────

/**
 * Exact row counts for every table in the public schema, in ONE query.
 *
 * The query_to_xml trick runs a count(*) per table inside a single statement,
 * which matters more than it looks: sixty-six separate counts would be
 * sixty-six different moments, and rows written between them would make the
 * totals disagree with a dump that was taken at one moment.
 */
function rowCounts(cfg) {
  const sql = `
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
  const out = execFileSync('psql', [cfg.pgUri, '-Atqc', sql], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  return JSON.parse(out.trim() || '{}');
}

function versionCheck(cfg) {
  const server = execFileSync('psql', [cfg.pgUri, '-Atqc', 'SHOW server_version'], { encoding: 'utf8' })
    .trim().split('.')[0];
  const client = /(\d+)/.exec(execFileSync('pg_dump', ['--version'], { encoding: 'utf8' }).split(' ').pop())?.[1];

  // pg_dump refuses to dump a server newer than itself, and does so with a
  // message that reads like a connection problem. Saying it plainly here saves
  // an evening.
  if (Number(client) < Number(server)) {
    throw new Error(
      `pg_dump is version ${client} but the server is ${server}. ` +
      `Install postgresql-client-${server} (see docs/BACKUP_AND_RESTORE.md §6.2).`,
    );
  }
  return { server, client };
}

function dump(cfg, outFile) {
  const args = [
    '--format=custom',
    '--compress=6',
    '--no-owner',        // the restoring server will not have Supabase's roles
    '--no-privileges',   // …nor its grants; RLS policies still come across
    '--quote-all-identifiers',
    '--verbose',
    '--file', outFile,
  ];
  for (const s of cfg.schemas) args.push('--schema', s);
  args.push(cfg.pgUri);

  // stderr carries pg_dump's --verbose progress; letting it through to the log
  // is what makes a partial dump diagnosable a week later.
  execFileSync('pg_dump', args, { stdio: ['ignore', 'inherit', 'inherit'] });

  if (!fs.existsSync(outFile) || fs.statSync(outFile).size === 0) {
    throw new Error('pg_dump produced no output');
  }
}

/** Symmetric GPG, if a passphrase is configured. The backup then contains
 *  every student's personal data and sits in a consumer Google account; that
 *  is a decision worth making deliberately, so it is opt-in rather than
 *  silent, and documented in §6.5. */
function encrypt(file, passphrase) {
  const out = `${file}.gpg`;
  execSync(
    `gpg --batch --yes --symmetric --cipher-algo AES256 ` +
    `--passphrase-fd 0 --output ${JSON.stringify(out)} ${JSON.stringify(file)}`,
    { input: passphrase },
  );
  fs.unlinkSync(file);
  return out;
}

function sha256(file) {
  const h = createHash('sha256');
  h.update(fs.readFileSync(file));
  return h.digest('hex');
}

function uploadToDrive(cfg, files, stamp) {
  const dest = `${cfg.rcloneRemote}/daily`;
  for (const f of files) {
    execFileSync('rclone', ['copy', f, dest, '--no-traverse'], { stdio: 'inherit' });
  }

  // The first of the month is also filed under monthly/, which retention never
  // touches. Thirty days of dailies protects against last night's mistake;
  // twelve monthlies protect against a mistake nobody noticed for a term.
  if (stamp.endsWith('-01')) {
    for (const f of files) {
      execFileSync('rclone', ['copy', f, `${cfg.rcloneRemote}/monthly`, '--no-traverse'], { stdio: 'inherit' });
    }
    log('Filed a monthly copy');
  }

  const pruned = execFileSync(
    'rclone',
    ['delete', dest, '--min-age', `${cfg.keepDays}d`, '--verbose'],
    { encoding: 'utf8' },
  );
  return pruned;
}

/**
 * Mirror the dump into Supabase Storage so the Backup page can offer it.
 *
 * The VPS never holds the service role key. It asks backup-report for a
 * ten-minute upload URL for one named object, and that is the entire extent of
 * its write access to this project.
 */
async function mirrorToStorage(cfg, file) {
  const sizeMb = fs.statSync(file).size / 1048576;
  if (sizeMb > cfg.mirrorMaxMb) {
    log(`Skipping the Storage mirror: ${sizeMb.toFixed(1)} MB exceeds the ${cfg.mirrorMaxMb} MB limit`);
    return null;
  }

  const name = path.basename(file);
  const presigned = await report(cfg, { action: 'presign', filename: name });
  if (!presigned?.signedUrl) return null;

  // createSignedUploadUrl returns a path relative to the storage API.
  const url = presigned.signedUrl.startsWith('http')
    ? presigned.signedUrl
    : `${cfg.supabaseUrl}/storage/v1${presigned.signedUrl}`;

  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'content-type': 'application/octet-stream', 'x-upsert': 'true' },
    body: fs.readFileSync(file),
  });
  if (!res.ok) {
    log(`Storage mirror failed (${res.status}) — the Drive copy is unaffected`);
    return null;
  }
  log(`Mirrored ${name} into Supabase Storage`);
  return name;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const cfg = loadEnv();
  fs.mkdirSync(WORK_DIR, { recursive: true });
  acquireLock();

  const stamp = new Date().toISOString().slice(0, 10);
  const base = `${cfg.label}-db-${stamp}`;
  const dumpFile = path.join(WORK_DIR, `${base}.dump`);
  const countsFile = path.join(WORK_DIR, `${base}.counts.json`);

  const started = await report(cfg, {
    action: 'start',
    kind: 'cloud',
    actor: `vps:${os.hostname()}`,
    destination: `Google Drive ${cfg.rcloneRemote}/daily`,
  });
  const runId = started?.id ?? null;

  try {
    const versions = versionCheck(cfg);
    log(`pg_dump ${versions.client} → server ${versions.server}`);

    log('Counting rows…');
    const counts = rowCounts(cfg);
    const totalRows = Object.values(counts).reduce((s, n) => s + Number(n), 0);
    fs.writeFileSync(countsFile, JSON.stringify({
      taken_at: new Date().toISOString(),
      schemas: cfg.schemas,
      tables: Object.keys(counts).length,
      total_rows: totalRows,
      counts,
    }, null, 2));
    log(`${Object.keys(counts).length} tables, ${totalRows} rows`);

    log('Dumping…');
    dump(cfg, dumpFile);

    let artifact = dumpFile;
    if (cfg.gpgPassphrase) {
      log('Encrypting…');
      artifact = encrypt(dumpFile, cfg.gpgPassphrase);
    }

    const size = fs.statSync(artifact).size;
    const checksum = sha256(artifact);
    log(`${path.basename(artifact)} — ${(size / 1048576).toFixed(1)} MB, sha256 ${checksum.slice(0, 16)}…`);

    if (DRY_RUN) {
      log('--dry-run: not uploading, not reporting success');
      return;
    }

    log(`Uploading to ${cfg.rcloneRemote}/daily…`);
    uploadToDrive(cfg, [artifact, countsFile], stamp);

    const storagePath = await mirrorToStorage(cfg, artifact);

    await report(cfg, {
      action: 'finish',
      id: runId,
      kind: 'cloud',
      status: 'success',
      artifact: path.basename(artifact),
      destination: `Google Drive ${cfg.rcloneRemote}/daily`,
      storage_path: storagePath,
      size_bytes: size,
      table_count: Object.keys(counts).length,
      row_count: totalRows,
      checksum,
      actor: `vps:${os.hostname()}`,
      message: cfg.gpgPassphrase ? 'Encrypted (AES-256)' : null,
      metadata: { schemas: cfg.schemas, encrypted: !!cfg.gpgPassphrase, keep_days: cfg.keepDays },
    });

    // Local copies are working files, not the backup. Keeping them would fill
    // the VPS disk in a couple of months and the second copy adds nothing —
    // the backup is the one in Drive, and the mirror is in Storage.
    if (!KEEP_LOCAL) {
      fs.unlinkSync(artifact);
      fs.unlinkSync(countsFile);
    }

    log('Done.');
  } catch (e) {
    fail(e.message);
    await report(cfg, {
      action: 'finish',
      id: runId,
      kind: 'cloud',
      status: 'failed',
      actor: `vps:${os.hostname()}`,
      message: String(e.message).slice(0, 500),
    });
    process.exitCode = 1;
  } finally {
    releaseLock();
  }
}

main().catch((e) => {
  fail(e.message);
  releaseLock();
  process.exit(1);
});
