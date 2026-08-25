#!/usr/bin/env node
/**
 * Apply one SQL file to the Supabase project, and say plainly what happened.
 *
 * WHY THIS EXISTS
 *
 * `supabase db push` is banned on this project — the 72 migration files in
 * ./migrations were never registered with the CLI, and a push would try to
 * replay all of them against a populated database (see supabase/config.toml).
 * So migrations are applied by hand, which in practice means pasting into the
 * dashboard SQL editor. That editor has two failure modes that cost real time:
 *
 *   1. It runs the whole script as ONE transaction. A single failing statement
 *      at the bottom of the file silently rolls back everything above it. The
 *      editor reports the error, but if you scrolled away, or read it as a
 *      warning, the result looks like "it ran" while the database is unchanged.
 *   2. If any text is selected, it runs ONLY the selection.
 *
 * This script removes both. It sends the file through the Management API — the
 * same endpoint the SQL editor uses — prints the error verbatim if there is
 * one, and then re-checks what actually exists in the database afterwards. It
 * cannot half-apply and tell you it worked.
 *
 * USAGE
 *
 *   # 1. Make a Personal Access Token (one minute, once):
 *   #    https://supabase.com/dashboard/account/tokens  → Generate new token
 *
 *   # 2. Windows PowerShell
 *   $env:SUPABASE_ACCESS_TOKEN = "sbp_…"
 *   node scripts/apply-migration.mjs supabase/migrations/20260824120000_backup_and_restore.sql
 *
 *   # git bash / macOS / Linux
 *   SUPABASE_ACCESS_TOKEN=sbp_… node scripts/apply-migration.mjs supabase/migrations/20260824120000_backup_and_restore.sql
 *
 *   --check      run the verification queries only, change nothing
 *   --project X  override the project ref from .env
 *
 * The token is looked for in the shell environment first, then .env.local,
 * then .env — and using .env prints a warning, because that file is tracked by
 * git. It is a full-account credential; keep it out of anything committed.
 */

import fs from 'node:fs';
import path from 'node:path';
import { readEnv, warnIfTracked } from './read-env.mjs';

const API = 'https://api.supabase.com/v1';

const args = process.argv.slice(2);
const CHECK_ONLY = args.includes('--check');
const projectFlag = args.indexOf('--project');
const sqlPath = args.find((a) => a.endsWith('.sql'));

// ─── Config ───────────────────────────────────────────────────────────────────

function projectRef() {
  if (projectFlag > -1 && args[projectFlag + 1]) return args[projectFlag + 1];
  const envFile = path.resolve('.env');
  if (fs.existsSync(envFile)) {
    const m = /VITE_SUPABASE_PROJECT_ID\s*=\s*"?([a-z0-9]+)"?/.exec(fs.readFileSync(envFile, 'utf8'));
    if (m) return m[1];
  }
  throw new Error('No project ref. Pass --project <ref> or set VITE_SUPABASE_PROJECT_ID in .env');
}

const { value: token, source: tokenSource } = readEnv('SUPABASE_ACCESS_TOKEN');
if (!token) {
  console.error(`
Missing SUPABASE_ACCESS_TOKEN.

  1. Open https://supabase.com/dashboard/account/tokens
  2. Generate new token → copy it (starts with sbp_)
  3. Put it somewhere this script can see:
       PowerShell:  $env:SUPABASE_ACCESS_TOKEN = "sbp_…"
       git bash:    export SUPABASE_ACCESS_TOKEN=sbp_…
       or add SUPABASE_ACCESS_TOKEN=sbp_… to .env.local
  4. Run this command again.

  Note: putting it in .env does work, but .env is tracked by git — use
  .env.local, which the *.local rule already ignores.
`);
  process.exit(1);
}
warnIfTracked('SUPABASE_ACCESS_TOKEN', tokenSource);

// ─── The one API call ─────────────────────────────────────────────────────────

async function run(ref, query) {
  const res = await fetch(`${API}/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });

  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }

  if (!res.ok) {
    const message = body?.message ?? body?.error ?? text;
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return body;
}

// ─── Verification ─────────────────────────────────────────────────────────────
// Asked of the database itself, after the fact. "The POST returned 200" is a
// claim about an HTTP request; this is a claim about the schema.

const CHECKS = [
  {
    label: 'backup_* functions',
    sql: `SELECT string_agg(proname, ', ' ORDER BY proname) AS found
            FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public'
             AND (proname LIKE 'backup%' OR proname = 'record_backup_run')`,
    expect: (r) => (r?.found ?? '').split(',').length >= 6,
    want: 'backup_clear_table, backup_health, backup_row_counts, backup_table_columns, backup_table_order, record_backup_run',
  },
  {
    label: 'backup_runs table',
    sql: `SELECT to_regclass('public.backup_runs')::text AS found`,
    expect: (r) => !!r?.found,
    want: 'public.backup_runs',
  },
  {
    label: 'row-level security on backup_runs',
    sql: `SELECT count(*)::int AS found FROM pg_policy WHERE polrelid = 'public.backup_runs'::regclass`,
    expect: (r) => Number(r?.found) >= 1,
    want: '1 policy',
  },
  {
    label: 'db-backups storage bucket',
    sql: `SELECT id AS found FROM storage.buckets WHERE id = 'db-backups'`,
    expect: (r) => !!r?.found,
    want: 'db-backups (optional — only the Nightly tab needs it)',
    optional: true,
  },
];

async function verify(ref) {
  console.log('\nChecking what is actually in the database:\n');
  let hardFailures = 0;

  for (const c of CHECKS) {
    let row = null;
    let error = null;
    try {
      const rows = await run(ref, c.sql);
      row = Array.isArray(rows) ? rows[0] : rows;
    } catch (e) {
      error = e.message;
    }

    const ok = !error && c.expect(row);
    const mark = ok ? '  OK  ' : c.optional ? ' SKIP ' : ' FAIL ';
    console.log(`[${mark}] ${c.label}`);
    if (!ok) {
      console.log(`         expected: ${c.want}`);
      console.log(`         got:      ${error ?? JSON.stringify(row)}`);
      if (!c.optional) hardFailures++;
    }
  }
  return hardFailures;
}

// ─── Are the edge functions actually there? ───────────────────────────────────
/**
 * The half of the install that is invisible from SQL.
 *
 * An undeployed function does not reach the browser as a 404. Supabase's
 * gateway answers the CORS preflight itself and allows only
 * `authorization, x-client-info, apikey` — not `content-type`, which
 * supabase-js always sends — so the browser rejects the preflight and reports
 * a CORS error. Hours get spent on header configuration for a function that
 * was never deployed.
 *
 * curl does not enforce CORS, so from here the 404 is plainly visible.
 */
const FUNCTIONS = ['db-backup', 'db-restore', 'backup-report'];

async function checkFunctions(ref) {
  console.log('\nChecking the edge functions:\n');
  let missing = 0;

  for (const fn of FUNCTIONS) {
    let status = 0;
    let code = '';
    try {
      const res = await fetch(`https://${ref}.supabase.co/functions/v1/${fn}`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'http://localhost:8080',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'authorization, content-type, apikey',
        },
      });
      status = res.status;
      code = res.headers.get('sb-error-code') ?? '';
    } catch (e) {
      code = e.message;
    }

    // A deployed function answers its own preflight (2xx). NOT_FOUND is the
    // gateway saying the slug does not exist.
    const ok = status >= 200 && status < 300;
    console.log(`[${ok ? '  OK  ' : ' FAIL '}] ${fn}${ok ? '' : `  → HTTP ${status} ${code}`}`);
    if (!ok) missing++;
  }

  if (missing) {
    console.log('\n  Deploy them with:');
    console.log('    npx supabase login');
    for (const fn of FUNCTIONS) {
      console.log(`    npx supabase functions deploy ${fn} --project-ref ${ref}`);
    }
  }
  return missing;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const ref = projectRef();
console.log(`Project: ${ref}`);

if (!CHECK_ONLY) {
  if (!sqlPath) {
    console.error('Pass the .sql file to apply, or --check to only verify.');
    process.exit(1);
  }
  if (!fs.existsSync(sqlPath)) {
    console.error(`No such file: ${sqlPath}`);
    process.exit(1);
  }

  const sql = fs.readFileSync(sqlPath, 'utf8');
  console.log(`Applying ${sqlPath} (${sql.length.toLocaleString()} characters)…`);

  try {
    await run(ref, sql);
    console.log('Applied without error.');
  } catch (e) {
    console.error(`\nThe database REFUSED this migration (HTTP ${e.status ?? '?'}):\n`);
    console.error(`  ${e.message}\n`);
    console.error(
      'Nothing was applied — the whole file runs as one transaction, so a single\n' +
      'failing statement rolls back everything before it. Fix the statement named\n' +
      'above and run this command again.\n',
    );
    process.exit(1);
  }

  // The migration ends with NOTIFY pgrst, but the reload is asynchronous;
  // asking again a moment later is what makes the check below trustworthy.
  console.log('Waiting 3s for the API schema cache to reload…');
  await new Promise((r) => setTimeout(r, 3000));
}

const failures = await verify(ref);
const missingFunctions = await checkFunctions(ref);

if (failures === 0 && missingFunctions === 0) {
  console.log(`
Both halves are in place. Reload the LMS (Ctrl+Shift+R) and open
Management -> Backup & Restore.
`);
} else {
  if (failures) {
    console.error(`
${failures} database check(s) failed — the migration has NOT taken effect.
See docs/BACKUP_INSTALL.md section 4.`);
  }
  if (missingFunctions) {
    console.error(`
${missingFunctions} function(s) are not deployed. In the browser this shows up
as a CORS error, not a 404 — see docs/BACKUP_INSTALL.md section 4.5.`);
  }
  console.error('');
  process.exitCode = 1;
}
