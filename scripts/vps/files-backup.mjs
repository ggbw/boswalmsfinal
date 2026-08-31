#!/usr/bin/env node
/**
 * Weekly file backup — Supabase Storage → Google Drive.
 *
 * WHAT THIS COVERS, AND WHY IT IS SEPARATE
 *
 * The nightly pg_dump backs up the database. It does not — cannot — back up
 * anything in Supabase Storage, because those objects are not rows: student
 * photos, applicant documents, employee files, assignment uploads and
 * timetables all live outside the database entirely. Until this script existed
 * they were in no backup at all. A recovery from the nightly dump would have
 * restored every record about a student and none of their documents.
 *
 * WHY IT IS ITS OWN SCRIPT AND ITS OWN RUN
 *
 * It could have been another step inside db-backup.mjs. It is not, because the
 * two have different failure domains. Folded together, an rclone error copying
 * photos would either mark the *database* backup failed — turning the health
 * banner red for a reason that has nothing to do with the database — or be
 * swallowed, which is a lie in the other direction. Separate runs, separate
 * rows in the history, separate truth.
 *
 * It is also weekly rather than nightly. Photos and documents are almost
 * entirely write-once; a seven-day worst case on a student photo is
 * proportionate where a twenty-four-hour one on the database is not.
 *
 * WHY `rclone sync` AND NOT A DOWNLOAD LOOP
 *
 * This is the only approach that copies just what changed. Storage is the one
 * part of this system that grows without bound, and re-uploading every object
 * every time would stop being viable well before the school notices.
 *
 * THE FLAG THAT MATTERS MOST: --backup-dir
 *
 * A plain sync is a mirror, and a mirror is not a backup: delete a file in the
 * app and the next run deletes it from Drive too, which is exactly the accident
 * anyone would want a backup for. With --backup-dir a deleted or overwritten
 * object is MOVED ASIDE into files/_replaced/<date>/ instead of destroyed, and
 * stays there for FILES_KEEP_DAYS. That is what makes this recoverable.
 *
 * CREDENTIALS
 *
 * Two, deliberately kept apart:
 *
 *   Google Drive     the existing rclone.conf (RCLONE_CONFIG), same as the
 *                    nightly job
 *   Supabase Storage S3 access keys, passed as environment variables so they
 *                    never touch the config file the Drive side uses
 *
 * The Supabase keys are storage credentials. They cannot read a table, bypass
 * RLS, read auth.users, or call a function — they are strictly weaker than the
 * service role key, which is the whole reason backup-report exists. They are
 * not nothing, though: today they can read AND write every bucket. Hence the
 * allowlist below (never a denylist), the read-only direction of the sync, and
 * --max-delete. See docs/BACKUP_AND_RESTORE.md §10.
 *
 * RESTORING
 *
 *   rclone copy "$RCLONE_REMOTE/files/student-photos" supastore:student-photos
 *
 * SETUP AND OPERATION: docs/BACKUP_GITHUB_ACTIONS.md.
 *
 * NOTE ON DUPLICATION: loadEnv, report, the lock and the loggers below are
 * copied from db-backup.mjs rather than shared. Extracting a common module
 * would mean editing the one script that must not break — the database backup —
 * in order to add a new one. The copies are ~40 lines and are marked in both
 * files; change them together.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const BASE_DIR = process.env.BACKUP_BASE_DIR || '/opt/db-backup-boswa';
const LOCK_FILE = path.join(BASE_DIR, '.files-backup.lock');

const DRY_RUN = process.argv.includes('--dry-run');

/**
 * The buckets to copy — an ALLOWLIST, never a denylist.
 *
 * `db-backups` must never appear here. It holds the mirrored pg_dumps, and
 * copying the backups into the backup would double the Drive footprint every
 * week to protect a convenience copy that is itself derived from the thing
 * being protected.
 */
const DEFAULT_BUCKETS = [
  'student-photos',
  'applicant-docs',
  'employee-docs',
  'assignment-files',
  'timetables',
];

/** rclone's name for the Supabase side. Defined by the environment variables
 *  set in rcloneEnv() below, so no config file is involved. */
const SRC = 'supastore';

// ─── Logging ──────────────────────────────────────────────────────────────────
// Copied from db-backup.mjs. cron appends stdout to the log file, so this is the
// whole logging system; `tail -40` must be enough to see what happened.

const log = (...a) => console.log(`[${new Date().toISOString()}]`, ...a);
const fail = (...a) => console.error(`[${new Date().toISOString()}] ERROR`, ...a);

// ─── Config ───────────────────────────────────────────────────────────────────
// Copied from db-backup.mjs: a `.env` beside the script on a VPS, or straight
// from the environment in CI. A file that IS present wins, so a VPS operator
// editing .env never has to wonder whether a stale shell export is overriding
// them.

function loadEnv() {
  const file = path.join(BASE_DIR, '.env');
  const fromFile = fs.existsSync(file);

  if (fromFile) {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (!m) continue;
      process.env[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
    }
  }

  const cfg = {
    supabaseUrl: (process.env.SUPABASE_URL || '').replace(/\/$/, ''),
    reportSecret: process.env.BACKUP_REPORT_SECRET,
    rcloneRemote: process.env.RCLONE_REMOTE,
    s3AccessKey: process.env.SUPABASE_S3_ACCESS_KEY_ID,
    s3SecretKey: process.env.SUPABASE_S3_SECRET_ACCESS_KEY,
    // eu-west-1 is this project's actual region, confirmed against the
    // Management API — not a guess from the URL, which does not contain it.
    // The region is part of the S3 signature, so a wrong value here fails with
    // SignatureDoesNotMatch, which reads like bad keys rather than bad config.
    // Verify with: Supabase → Project Settings → Storage → S3 connection.
    s3Region: process.env.SUPABASE_S3_REGION || 'eu-west-1',
    buckets: (process.env.FILES_BUCKETS || DEFAULT_BUCKETS.join(','))
      .split(',').map((s) => s.trim()).filter(Boolean),
    keepDays: Number(process.env.FILES_KEEP_DAYS || 90),
    maxDelete: Number(process.env.FILES_MAX_DELETE || 50),
  };

  const where = fromFile ? file : 'the environment (no .env file found)';
  const required = {
    supabaseUrl: 'SUPABASE_URL',
    reportSecret: 'BACKUP_REPORT_SECRET',
    rcloneRemote: 'RCLONE_REMOTE',
    s3AccessKey: 'SUPABASE_S3_ACCESS_KEY_ID',
    s3SecretKey: 'SUPABASE_S3_SECRET_ACCESS_KEY',
  };
  for (const [k, name] of Object.entries(required)) {
    if (!cfg[k]) throw new Error(`Missing ${name} in ${where}`);
  }

  if (cfg.buckets.includes('db-backups')) {
    // Worth refusing rather than filtering. Someone who has put this in FILES_BUCKETS
    // believes the backups are being protected by this job; quietly dropping it
    // would leave them believing it.
    throw new Error(
      'FILES_BUCKETS contains db-backups. That bucket holds the mirrored database ' +
      'dumps, which are already in Drive — remove it.',
    );
  }
  return cfg;
}

/**
 * The Supabase side of rclone, as environment variables.
 *
 * rclone reads remotes from RCLONE_CONFIG_<NAME>_<KEY>, which means the S3 keys
 * never have to be written into the same rclone.conf the Drive credentials live
 * in. Two credentials, two places, and the nightly database job never sees
 * these at all.
 */
function rcloneEnv(cfg) {
  const host = new URL(cfg.supabaseUrl).hostname.replace('.supabase.co', '.storage.supabase.co');
  return {
    ...process.env,
    RCLONE_CONFIG_SUPASTORE_TYPE: 's3',
    RCLONE_CONFIG_SUPASTORE_PROVIDER: 'Other',
    RCLONE_CONFIG_SUPASTORE_ACCESS_KEY_ID: cfg.s3AccessKey,
    RCLONE_CONFIG_SUPASTORE_SECRET_ACCESS_KEY: cfg.s3SecretKey,
    RCLONE_CONFIG_SUPASTORE_REGION: cfg.s3Region,
    RCLONE_CONFIG_SUPASTORE_ENDPOINT: `https://${host}/storage/v1/s3`,
    RCLONE_CONFIG_SUPASTORE_FORCE_PATH_STYLE: 'true',
    // Supabase creates buckets itself; rclone must not try to.
    RCLONE_CONFIG_SUPASTORE_NO_CHECK_BUCKET: 'true',
  };
}

// ─── Reporting ────────────────────────────────────────────────────────────────
// Copied from db-backup.mjs. Best-effort in both directions: a copy that reached
// Google Drive must not be reported as failed because Supabase was briefly
// unreachable, and a reporting call must never abort the backup.

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
// Copied from db-backup.mjs. Its own lock file, so a long file sync and the
// nightly dump can overlap — they touch nothing in common.

function acquireLock() {
  if (fs.existsSync(LOCK_FILE)) {
    const pid = Number(fs.readFileSync(LOCK_FILE, 'utf8').trim());
    let alive = false;
    try { process.kill(pid, 0); alive = true; } catch { alive = false; }
    if (alive) throw new Error(`Another file backup is already running (pid ${pid})`);
    log(`Clearing stale lock from pid ${pid}`);
    fs.unlinkSync(LOCK_FILE);
  }
  fs.writeFileSync(LOCK_FILE, String(process.pid));
}
const releaseLock = () => { try { fs.unlinkSync(LOCK_FILE); } catch { /* already gone */ } };

// ─── Steps ────────────────────────────────────────────────────────────────────

function rclone(cfg, args, opts = {}) {
  return execFileSync('rclone', args, { env: rcloneEnv(cfg), encoding: 'utf8', ...opts });
}

/** Objects and bytes in one bucket, according to the source. */
function bucketSize(cfg, bucket) {
  const out = rclone(cfg, ['size', `${SRC}:${bucket}`, '--json'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const { count = 0, bytes = 0 } = JSON.parse(out);
  return { objects: Number(count), bytes: Number(bytes) };
}

/**
 * Copy one bucket to Drive.
 *
 * The empty-source check is the important part. rclone reports a bucket it
 * could not list as containing nothing, and "nothing" to a sync means "delete
 * everything at the destination". A transient listing failure would therefore
 * empty that bucket's backup — with --backup-dir the files would be recoverable
 * for FILES_KEEP_DAYS, but a backup that quietly moves itself aside is not one
 * anybody should have to notice in time. So an empty listing is treated as a
 * reason to skip, never as an instruction.
 */
function syncBucket(cfg, bucket, stamp) {
  const size = bucketSize(cfg, bucket);
  if (size.objects === 0) {
    log(`  ${bucket}: source lists 0 objects — skipping (a sync would empty the copy in Drive)`);
    return { name: bucket, objects: 0, bytes: 0, skipped: 'Source listed no objects — not synced' };
  }

  const dest = `${cfg.rcloneRemote}/files/${bucket}`;
  const args = [
    'sync', `${SRC}:${bucket}`, dest,
    '--backup-dir', `${cfg.rcloneRemote}/files/_replaced/${stamp}/${bucket}`,
    '--max-delete', String(cfg.maxDelete),
    '--transfers', '4',
    '--checkers', '8',
    '--stats-one-line', '--stats', '30s',
    '-v',
  ];
  if (DRY_RUN) args.push('--dry-run');

  log(`  ${bucket}: ${size.objects} object(s), ${(size.bytes / 1048576).toFixed(1)} MB →  ${dest}`);
  rclone(cfg, args, { stdio: ['ignore', 'inherit', 'inherit'] });

  return { name: bucket, objects: size.objects, bytes: size.bytes, skipped: null };
}

/** Drop aside-copies older than the retention window, and the empty date
 *  folders they leave behind. Same shape as uploadToDrive's prune. */
function pruneReplaced(cfg) {
  const root = `${cfg.rcloneRemote}/files/_replaced`;
  try {
    rclone(cfg, ['delete', root, '--min-age', `${cfg.keepDays}d`, '--verbose'], { stdio: ['ignore', 'inherit', 'inherit'] });
    rclone(cfg, ['rmdirs', root, '--leave-root'], { stdio: ['ignore', 'inherit', 'inherit'] });
  } catch {
    // Nothing has been replaced yet, so the folder does not exist. Not an error.
  }
}

/** What is in Drive afterwards, for the Backup page. Best-effort — a listing
 *  failure says nothing about whether the copy arrived. */
function driveTotals(cfg) {
  try {
    const out = rclone(cfg, ['size', `${cfg.rcloneRemote}/files`, '--json'], { stdio: ['ignore', 'pipe', 'pipe'] });
    const { count = 0, bytes = 0 } = JSON.parse(out);
    return { objects: Number(count), bytes: Number(bytes) };
  } catch {
    return null;
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const cfg = loadEnv();
  fs.mkdirSync(BASE_DIR, { recursive: true });
  acquireLock();

  const stamp = new Date().toISOString().slice(0, 10);

  const started = await report(cfg, {
    action: 'start',
    kind: 'files',
    actor: `runner:${os.hostname()}`,
    destination: `Google Drive ${cfg.rcloneRemote}/files`,
  });
  const runId = started?.id ?? null;

  try {
    log(`Copying ${cfg.buckets.length} bucket(s) to ${cfg.rcloneRemote}/files…`);
    if (DRY_RUN) log('--dry-run: rclone will report what it would do and change nothing');

    const buckets = [];
    for (const bucket of cfg.buckets) {
      try {
        buckets.push(syncBucket(cfg, bucket, stamp));
      } catch (e) {
        // One unreachable bucket must not cost the other four their backup.
        fail(`${bucket}: ${e.message}`);
        buckets.push({ name: bucket, objects: 0, bytes: 0, skipped: String(e.message).slice(0, 160) });
      }
    }

    if (!DRY_RUN) pruneReplaced(cfg);

    const copied = buckets.filter((b) => !b.skipped);
    const failed = buckets.filter((b) => b.skipped);
    const totalObjects = copied.reduce((s, b) => s + b.objects, 0);
    const totalBytes = copied.reduce((s, b) => s + b.bytes, 0);

    if (DRY_RUN) {
      log('--dry-run: not reporting success');
      return;
    }

    // Every bucket failing is a failure, however cleanly each one failed.
    const allFailed = copied.length === 0 && buckets.length > 0;
    const summary =
      `${totalObjects.toLocaleString()} object(s) across ${copied.length} bucket(s)` +
      (failed.length ? `; ${failed.length} skipped: ${failed.map((b) => b.name).join(', ')}` : '');

    log(summary);

    await report(cfg, {
      action: 'finish',
      id: runId,
      kind: 'files',
      status: allFailed ? 'failed' : 'success',
      artifact: `files/ (${copied.length} buckets)`,
      destination: `Google Drive ${cfg.rcloneRemote}/files`,
      size_bytes: totalBytes,
      // table_count and row_count stay null on purpose: the History tab labels
      // that column "Rows", and object counts are not rows. The numbers are in
      // the message and in metadata instead.
      actor: `runner:${os.hostname()}`,
      message: summary.slice(0, 500),
      metadata: {
        buckets,
        keep_days: cfg.keepDays,
        drive: { remote: `${cfg.rcloneRemote}/files`, listed_at: new Date().toISOString(), totals: driveTotals(cfg) },
      },
    });

    // The exit code is what GitHub Actions turns into a green tick or a red
    // cross, and it is the only signal the `if: failure()` step reacts to. A
    // run in which every bucket failed had been reporting `failed` to the
    // database while still exiting 0 — so the workflow went green over a backup
    // that copied nothing, which is the precise kind of manufactured confidence
    // this whole system exists to prevent.
    if (allFailed) {
      fail(`No bucket was copied. ${summary}`);
      process.exitCode = 1;
    } else {
      if (failed.length) log(`${failed.length} bucket(s) were skipped — see the run in the LMS.`);
      log('Done.');
    }
  } catch (e) {
    fail(e.message);
    await report(cfg, {
      action: 'finish',
      id: runId,
      kind: 'files',
      status: 'failed',
      actor: `runner:${os.hostname()}`,
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
