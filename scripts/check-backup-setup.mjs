#!/usr/bin/env node
/**
 * Backup setup preflight — answers "is the nightly Google Drive backup actually
 * wired up?" without changing a single thing.
 *
 * WHY THIS EXISTS
 *
 * The backup feature has three halves that are installed in three different
 * places, and a failure in any one of them looks identical from the Backup
 * page: an empty Nightly tab. The migration lives in Postgres, the functions
 * live in Supabase's edge runtime, and the job itself lives in GitHub Actions
 * with six repository secrets. Nothing correlates them.
 *
 * The sharpest edge is BACKUP_REPORT_SECRET. It has to match in two places —
 * the `backup-report` function's secrets and the GitHub repository secret — and
 * when it does not, the nightly job runs to completion, uploads the dump to
 * Drive, gets a 403 on the way back, and reports nothing. Drive fills up while
 * the page insists no backup has ever run. There is no way to tell that apart
 * from "the job never ran" by looking at the app.
 *
 * This repository currently holds TWO different values for that secret, in
 * `.env` and in `backup-report-secret.local`. So the first thing this script
 * does is ask the deployed function which one it actually accepts.
 *
 * EVERYTHING HERE IS READ-ONLY. It writes no rows, uploads nothing, and
 * triggers no workflow.
 *
 * USAGE
 *
 *   npm run check:backup
 *
 * The Management API checks need SUPABASE_ACCESS_TOKEN (same token as
 * apply-migration.mjs); without it those checks are skipped rather than failed,
 * because the secret probe above them is the valuable half and needs no token.
 *
 * See docs/BACKUP_GITHUB_ACTIONS.md for what to do about anything it reports.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { readEnv, warnIfTracked } from './read-env.mjs';

const API = 'https://api.supabase.com/v1';

const log = (...a) => console.log(...a);
const ok = (label, note = '') => log(`[  OK  ] ${label}${note ? `  ${note}` : ''}`);
const bad = (label, note = '') => log(`[ FAIL ] ${label}${note ? `  ${note}` : ''}`);
const skip = (label, note = '') => log(`[ SKIP ] ${label}${note ? `  ${note}` : ''}`);
const warn = (label, note = '') => log(`[ WARN ] ${label}${note ? `  ${note}` : ''}`);

let failures = 0;
const fail = (label, note) => { bad(label, note); failures++; };

/** Show enough of a secret to recognise it, never enough to use it. */
const mask = (s) => (s ? `${s.slice(0, 8)}… (${s.length} chars)` : '(empty)');

// ─── Config ───────────────────────────────────────────────────────────────────

function projectRef() {
  const envFile = path.resolve('.env');
  if (fs.existsSync(envFile)) {
    const m = /VITE_SUPABASE_PROJECT_ID\s*=\s*"?([a-z0-9]+)"?/.exec(fs.readFileSync(envFile, 'utf8'));
    if (m) return m[1];
  }
  throw new Error('No project ref — set VITE_SUPABASE_PROJECT_ID in .env');
}

const REF = projectRef();
const FUNCTIONS_BASE = `https://${REF}.supabase.co/functions/v1`;

// ─── 1. Which BACKUP_REPORT_SECRET does the deployed function accept? ─────────

/**
 * Every place a value for this secret might be hiding, in the order a human
 * would trust them. `backup-report-secret.local` is not a .env file — it is a
 * commented note with the value on a line of its own — so it is parsed
 * separately: any 32+ character hex string in it is a candidate.
 */
function secretCandidates() {
  const out = [];
  const seen = new Set();
  const add = (value, source) => {
    if (!value || seen.has(value)) return;
    seen.add(value);
    out.push({ value, source });
  };

  const fromEnv = readEnv('BACKUP_REPORT_SECRET');
  if (fromEnv.value) add(fromEnv.value, fromEnv.source);

  const notes = path.resolve('backup-report-secret.local');
  if (fs.existsSync(notes)) {
    for (const line of fs.readFileSync(notes, 'utf8').split(/\r?\n/)) {
      if (line.trim().startsWith('#')) continue;
      const m = /([0-9a-fA-F]{32,})/.exec(line);
      if (m) add(m[1], 'backup-report-secret.local');
    }
  }
  return out;
}

/**
 * Probe one candidate.
 *
 * `backup-report` checks the secret BEFORE it looks at the action, and it has
 * no action called `__preflight`. So the two outcomes are unambiguous and
 * neither writes anything:
 *
 *   403 Forbidden          → wrong secret
 *   400 Unknown action     → correct secret, and the function is deployed
 *   500 …is not set…       → the function has no BACKUP_REPORT_SECRET at all
 */
async function probeSecret(secret) {
  const res = await fetch(`${FUNCTIONS_BASE}/backup-report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-backup-secret': secret },
    body: JSON.stringify({ action: '__preflight' }),
  });
  const body = await res.text();
  return { status: res.status, body };
}

async function checkSecret() {
  log('\n1. Which BACKUP_REPORT_SECRET does the deployed function accept?\n');

  const candidates = secretCandidates();
  if (!candidates.length) {
    fail('no candidate secret found', '— looked in the environment, .env.local, .env, backup-report-secret.local');
    return null;
  }

  if (candidates.length > 1) {
    warn(
      `${candidates.length} DIFFERENT values found in this repository`,
      '— only one of them can be right, and the GitHub secret must match it',
    );
    for (const c of candidates) log(`         ${c.source.padEnd(28)} ${mask(c.value)}`);
    log('');
  }

  let accepted = null;
  for (const c of candidates) {
    let r;
    try {
      r = await probeSecret(c.value);
    } catch (e) {
      fail(`could not reach backup-report`, `— ${e.message}`);
      return null;
    }

    if (r.status === 500 && r.body.includes('is not set')) {
      fail(
        'backup-report has no BACKUP_REPORT_SECRET set',
        '— set it under Supabase → Edge Functions → Secrets, then redeploy',
      );
      return null;
    }
    if (r.status === 400) { accepted = c; break; }
    if (r.status !== 403) {
      warn(`${c.source}: unexpected HTTP ${r.status}`, r.body.slice(0, 120));
    }
  }

  if (!accepted) {
    fail(
      'none of the values in this repository is the one on the function',
      '— every value here returns 403, so the nightly job could never report back',
    );
    log('\n         Fix: rotate. Generate one value, set it on the function AND in');
    log('         GitHub Secrets in the same sitting, and treat the old one as burned.');
    return null;
  }

  ok(`the live secret is the one in ${accepted.source}`, mask(accepted.value));

  const stale = candidates.filter((c) => c !== accepted);
  if (stale.length) {
    log('');
    for (const c of stale) {
      warn(`${c.source} holds a STALE value`, mask(c.value));
    }
    if (stale.some((c) => c.source === '.env')) {
      log('');
      log('         .env is TRACKED BY GIT. Delete the BACKUP_REPORT_SECRET line from it');
      log('         before committing — a secret in .env goes to GitHub with the next push.');
    }
  }

  log(`\n         This exact value must be the GitHub repository secret\n         BACKUP_REPORT_SECRET, or every nightly run reports nothing.`);
  return accepted;
}

// ─── 2. Are the edge functions deployed? ──────────────────────────────────────
// Same OPTIONS technique as apply-migration.mjs:185 — an undeployed function
// reaches the browser as a CORS error, not a 404, and hours get spent on
// header configuration for something that was never deployed.

const FUNCTIONS = [
  { name: 'db-backup', required: true },
  { name: 'db-restore', required: true },
  { name: 'backup-report', required: true },
  { name: 'backup-trigger', required: false, note: 'needed for the "Run backup now" button' },
];

async function checkFunctions() {
  log('\n2. Edge functions\n');
  for (const fn of FUNCTIONS) {
    let status = 0;
    let detail = '';
    try {
      const res = await fetch(`${FUNCTIONS_BASE}/${fn.name}`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'http://localhost:8080',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'authorization, content-type, apikey',
        },
      });
      status = res.status;
      detail = res.headers.get('sb-error-code') ?? '';
    } catch (e) {
      detail = e.message;
    }

    const deployed = status >= 200 && status < 300;
    if (deployed) ok(fn.name);
    else if (fn.required) fail(fn.name, `→ HTTP ${status} ${detail} — node scripts/deploy-functions.mjs ${fn.name}`);
    else skip(fn.name, `not deployed — ${fn.note}`);
  }
}

// ─── 3. The database half ─────────────────────────────────────────────────────

const { value: token, source: tokenSource } = readEnv('SUPABASE_ACCESS_TOKEN');

async function sql(query) {
  const res = await fetch(`${API}/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  if (!res.ok) throw new Error(body?.message ?? body?.error ?? text);
  return Array.isArray(body) ? body : [body];
}

/** Buckets the weekly files backup will copy. db-backups is deliberately NOT
 *  here — backing up the backups is not a backup. */
const APP_BUCKETS = ['student-photos', 'applicant-docs', 'employee-docs', 'assignment-files', 'timetables'];

async function checkDatabase() {
  log('\n3. Database\n');

  if (!token) {
    skip('all database checks', '— set SUPABASE_ACCESS_TOKEN (see apply-migration.mjs) to run them');
    return;
  }
  warnIfTracked('SUPABASE_ACCESS_TOKEN', tokenSource);

  // 3.1 The backup migration.
  try {
    const [row] = await sql(`SELECT to_regclass('public.backup_runs')::text AS t`);
    if (row?.t) ok('backup_runs table');
    else fail('backup_runs table is missing', '— node scripts/apply-migration.mjs supabase/migrations/20260824120000_backup_and_restore.sql');
  } catch (e) {
    fail('could not query the database', `— ${e.message}`);
    return;
  }

  // 3.2 Does the kind CHECK allow 'files' yet? Phase 5 of the plan depends on
  //     this, and sending 'files' to the old constraint makes record_backup_run
  //     raise — which surfaces as the whole finish call 500ing.
  try {
    const rows = await sql(
      `SELECT conname, pg_get_constraintdef(oid) AS def
         FROM pg_constraint
        WHERE conrelid = 'public.backup_runs'::regclass AND contype = 'c'`,
    );
    const kindCheck = rows.find((r) => /kind/.test(r.def ?? ''));
    if (!kindCheck) warn('no CHECK constraint on backup_runs.kind');
    else if (/files/.test(kindCheck.def)) ok(`backup_runs.kind allows 'files'`);
    else skip(`backup_runs.kind does NOT allow 'files' yet`, `— apply 20260827120000_backup_runs_files_kind.sql before the first files run`);
  } catch (e) {
    warn('could not read the backup_runs constraints', e.message);
  }

  // 3.3 Storage buckets.
  try {
    const rows = await sql(`SELECT id FROM storage.buckets ORDER BY id`);
    const have = new Set(rows.map((r) => r.id));
    if (have.has('db-backups')) ok('db-backups bucket');
    else warn('db-backups bucket is missing', '— the Nightly tab cannot list the Supabase mirror without it');

    const missing = APP_BUCKETS.filter((b) => !have.has(b));
    if (!missing.length) ok(`all ${APP_BUCKETS.length} app buckets present`, APP_BUCKETS.join(', '));
    else warn(`${missing.length} app bucket(s) absent`, `— the files backup will skip: ${missing.join(', ')}`);
  } catch (e) {
    warn('could not list storage buckets', e.message);
  }

  // 3.4 hr_notifications — the failure alert's destination.
  //
  //     The migration that creates this table is NOT in this repository. It
  //     exists only in the live database, so its shape has to be asked for
  //     rather than read. If a CHECK restricts `type`, an insert of
  //     'backup_failed' is rejected and the alert silently never arrives —
  //     which is the one failure mode an alerting feature must not have.
  try {
    const [reg] = await sql(`SELECT to_regclass('public.hr_notifications')::text AS t`);
    if (!reg?.t) {
      warn('hr_notifications does not exist', '— failed-backup alerts will be skipped (non-fatal by design)');
    } else {
      ok('hr_notifications table');
      const checks = await sql(
        `SELECT conname, pg_get_constraintdef(oid) AS def
           FROM pg_constraint
          WHERE conrelid = 'public.hr_notifications'::regclass AND contype = 'c'`,
      );
      const onType = checks.filter((c) => /\btype\b/.test(c.def ?? ''));
      if (!onType.length) {
        ok(`hr_notifications.type is unconstrained`, `— 'backup_failed' will be accepted`);
      } else {
        for (const c of onType) {
          const permits = /backup_failed/.test(c.def);
          if (permits) ok(`hr_notifications.type permits 'backup_failed'`);
          else fail(`hr_notifications.type REJECTS 'backup_failed'`, `— ${c.conname}: ${c.def}`);
        }
      }

      // Print the live definition so the missing migration can be captured
      // accurately later rather than guessed at.
      const cols = await sql(
        `SELECT column_name, data_type, is_nullable
           FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'hr_notifications'
          ORDER BY ordinal_position`,
      );
      log('\n         Live definition (its migration is missing from this repo):');
      for (const c of cols) {
        log(`           ${c.column_name.padEnd(14)} ${String(c.data_type).padEnd(26)} ${c.is_nullable === 'NO' ? 'NOT NULL' : ''}`);
      }
    }
  } catch (e) {
    warn('could not inspect hr_notifications', e.message);
  }

  // 3.5 What has actually run.
  try {
    const rows = await sql(
      `SELECT DISTINCT ON (kind) kind, status, started_at, artifact, message
         FROM public.backup_runs ORDER BY kind, started_at DESC`,
    );
    log('');
    if (!rows.length) {
      warn('backup_runs is EMPTY', '— no backup of any kind has ever been recorded');
    } else {
      log('         Newest run of each kind:');
      for (const r of rows) {
        const when = r.started_at ? new Date(r.started_at).toISOString().replace('T', ' ').slice(0, 16) : '?';
        log(`           ${String(r.kind).padEnd(13)} ${String(r.status).padEnd(8)} ${when}  ${r.artifact ?? r.message ?? ''}`);
      }
      if (!rows.some((r) => r.kind === 'cloud')) {
        log('');
        warn('no `cloud` run has EVER happened', '— the nightly Google Drive backup has never run');
      }
    }
  } catch (e) {
    warn('could not read backup_runs', e.message);
  }
}

// ─── 4. What cannot be checked from here ──────────────────────────────────────

function reportManual(acceptedSecret) {
  log('\n4. Cannot be verified from this machine — you must check these yourself\n');

  const workflowsPushed = (() => {
    try {
      return execFileSync('git', ['ls-files', '.github/workflows'], { encoding: 'utf8' }).trim().length > 0;
    } catch { return null; }
  })();

  if (workflowsPushed === false) {
    fail(
      '.github/workflows is NOT tracked by git',
      '— GitHub has never seen db-backup.yml',
    );
    log('         Nothing can run, and the "Run backup now" button will 404, until');
    log('         these are committed and pushed to the `main` branch.');
    log('');
  } else if (workflowsPushed === true) {
    ok('.github/workflows is tracked by git', '— confirm on github.com that it is on `main`');
    log('');
  }

  log('         GitHub → Settings → Secrets and variables → Actions:');
  log('');
  log(`           BACKUP_REPORT_SECRET   must equal ${acceptedSecret ? mask(acceptedSecret.value) : '(unresolved — see section 1)'}`);
  log('           PGURI                  the SESSION POOLER string, not db.<ref>.supabase.co');
  log('           SUPABASE_URL           https://' + REF + '.supabase.co');
  log('           RCLONE_REMOTE          e.g. gdrive:BoswaLMS-Backups');
  log('           RCLONE_CONFIG          the whole rclone.conf, incl. the Drive refresh token');
  log('           GPG_PASSPHRASE         optional; if lost, every backup is unopenable');
  log('');
  log('         For the weekly files backup (Supabase → Storage → S3 access keys):');
  log('           SUPABASE_S3_ACCESS_KEY_ID');
  log('           SUPABASE_S3_SECRET_ACCESS_KEY');
  log('           SUPABASE_S3_REGION');
  log('');
  log('         For the "Run backup now" button (Supabase → Edge Functions → Secrets):');
  log('           GITHUB_DISPATCH_TOKEN  fine-grained PAT, this repo only, Actions: Read and write');
  log('');
  log('         See docs/BACKUP_GITHUB_ACTIONS.md for how to obtain each one.');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

log(`Backup setup preflight — project ${REF}`);
log('Nothing here writes, uploads, or triggers anything.');

const accepted = await checkSecret();
await checkFunctions();
await checkDatabase();
reportManual(accepted);

log('');
if (failures === 0) {
  log('No blocking problems found. Anything marked SKIP or WARN is listed above.');
} else {
  log(`${failures} blocking problem(s) — the nightly backup cannot work until they are fixed.`);
  process.exitCode = 1;
}
log('');
