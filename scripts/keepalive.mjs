#!/usr/bin/env node
/**
 * Supabase keep-alive — stop a Free plan project being paused for inactivity.
 *
 * THE PROBLEM
 *
 * Supabase pauses Free plan projects that show low database activity over a
 * rolling 7-day window. A school is exactly the shape of user this catches:
 * nobody signs in over a long holiday, three weeks pass, and the project is
 * paused. Restoring it is a button in the dashboard — but only for 90 days,
 * and only by somebody who notices. In the meantime the app is simply down.
 *
 * Supabase's own wording is the specification this script is written to:
 *
 *   "Typically a few user requests to the database each day over the previous
 *    week is enough to keep the project from being paused."
 *
 * A few requests, EACH DAY. Not one request a week. That is why this runs
 * daily and makes several queries per run rather than one — the threshold is
 * not published, so the cheap thing to do is comfortably exceed it. Four
 * queries a day is nothing next to the free quota and removes the guesswork.
 *
 * WHAT COUNTS
 *
 * A real query against a real table. Every request below goes through
 * PostgREST and executes SQL in Postgres, which is the activity being
 * measured. A row-level-security policy that returns no rows is fine — the
 * query still ran. A 404 is NOT fine: a missing table is rejected by PostgREST
 * before Postgres is ever asked, so it looks like a successful ping while
 * generating no activity at all. That distinction is why the table list is
 * checked rather than assumed, and why a 404 counts as a failure here.
 *
 * WHAT THIS CANNOT DO
 *
 * It cannot un-pause a project. Once paused, the API stops answering and
 * nothing this script sends will reach it — resuming is a button in the
 * Supabase dashboard and there is no API for it on the Free plan. Keep-alive
 * is prevention only. If the run below reports the project as already paused,
 * go and press Resume; this script cannot do it for you.
 *
 * SECRETS: none. It uses the publishable (anon) key, which already ships in
 * the browser bundle and is in the tracked `.env` on purpose. There is nothing
 * here worth putting in a secret store, and no write of any kind is performed.
 *
 * USAGE
 *
 *   node scripts/keepalive.mjs            # read .env / .env.local
 *   node scripts/keepalive.mjs --verbose  # print every request
 *
 * Exit code 0 = the database answered. Non-zero = it did not, and whatever is
 * running this (GitHub Actions, cron) should make a noise about it.
 */

import { readEnv } from './read-env.mjs';

// ─── Configuration ────────────────────────────────────────────────────────────

/**
 * Tables to query, in order. Several rather than one, for two reasons: Supabase
 * counts "a few requests", and a single table that is later renamed would turn
 * this script into a silent no-op — the worst possible failure, because the
 * job stays green while the project drifts towards a pause.
 *
 * These are configuration tables that every deployment of this system has and
 * that nothing would sensibly drop. Override with KEEPALIVE_TABLES if the
 * schema ever moves under it.
 */
const DEFAULT_TABLES = ['classes', 'modules', 'departments', 'school_config'];

/** Per-request ceiling. A paused project hangs rather than refusing quickly. */
const REQUEST_TIMEOUT_MS = 20_000;

const VERBOSE = process.argv.includes('--verbose') || process.env.KEEPALIVE_VERBOSE === '1';

// ─── Output ───────────────────────────────────────────────────────────────────
// Timestamped, because these lines end up in a cron log or an Actions run read
// weeks later, where "when" is most of the information.

const stamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
const log = (msg) => console.log(`[${stamp()}] ${msg}`);
const fail = (msg) => console.error(`[${stamp()}] ${msg}`);

// ─── Settings ─────────────────────────────────────────────────────────────────

function settings() {
  const { value: url } = readEnv('SUPABASE_URL');
  const { value: key } =
    readEnv('SUPABASE_PUBLISHABLE_KEY').value
      ? readEnv('SUPABASE_PUBLISHABLE_KEY')
      : readEnv('VITE_SUPABASE_PUBLISHABLE_KEY');

  const missing = [];
  if (!url) missing.push('SUPABASE_URL');
  if (!key) missing.push('SUPABASE_PUBLISHABLE_KEY');
  if (missing.length) {
    fail(`Missing ${missing.join(' and ')}. Add to .env, or set in the environment.`);
    process.exit(2);
  }

  const tables = (process.env.KEEPALIVE_TABLES || '')
    .split(',').map((t) => t.trim()).filter(Boolean);

  return {
    url: url.replace(/\/+$/, ''),
    key,
    tables: tables.length ? tables : DEFAULT_TABLES,
  };
}

// ─── One request ──────────────────────────────────────────────────────────────

/**
 * @returns {Promise<{ ok: boolean, status: number|null, detail: string, ms: number }>}
 */
async function request(url, key, path) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(`${url}${path}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: controller.signal,
    });
    const ms = Date.now() - started;

    // 200 and 206 both mean PostgREST ran the query. 401/403 mean RLS refused
    // the ROWS — the query still executed, which is the thing being measured,
    // so they are not treated as failures of the keep-alive.
    if (res.ok || res.status === 401 || res.status === 403) {
      return { ok: true, status: res.status, detail: '', ms };
    }

    // A 404 is the dangerous one: PostgREST rejects an unknown table without
    // asking Postgres, so this request generated no activity whatsoever.
    if (res.status === 404) {
      return {
        ok: false, status: 404, ms,
        detail: 'table not found — this request never reached Postgres, so it does NOT count as activity',
      };
    }

    const body = await res.text().catch(() => '');
    return { ok: false, status: res.status, ms, detail: body.slice(0, 200) };
  } catch (e) {
    const ms = Date.now() - started;
    const aborted = e?.name === 'AbortError';
    return {
      ok: false, status: null, ms,
      detail: aborted ? `no answer within ${REQUEST_TIMEOUT_MS / 1000}s` : String(e?.message || e),
    };
  } finally {
    clearTimeout(timer);
  }
}

// ─── Run ──────────────────────────────────────────────────────────────────────

async function main() {
  const { url, key, tables } = settings();
  const project = url.replace(/^https?:\/\//, '').split('.')[0];

  log(`Keeping Supabase project ${project} awake.`);

  const results = [];

  for (const table of tables) {
    // limit=1 and a single column: the smallest query that is still a query.
    const r = await request(url, key, `/rest/v1/${table}?select=*&limit=1`);
    results.push({ label: `db:${table}`, ...r });
    if (VERBOSE || !r.ok) {
      const how = r.ok ? `HTTP ${r.status}` : `FAILED — ${r.detail}`;
      log(`  ${table.padEnd(16)} ${String(r.ms).padStart(5)}ms  ${how}`);
    }
  }

  // Auth is a separate service on the same project. Including it means a
  // keep-alive that also notices when GoTrue is down but Postgres is fine —
  // which, to a user who cannot sign in, is indistinguishable from an outage.
  const auth = await request(url, key, '/auth/v1/health');
  results.push({ label: 'auth:health', ...auth });
  if (VERBOSE || !auth.ok) {
    log(`  ${'auth/health'.padEnd(16)} ${String(auth.ms).padStart(5)}ms  ${auth.ok ? `HTTP ${auth.status}` : `FAILED — ${auth.detail}`}`);
  }

  const dbResults = results.filter((r) => r.label.startsWith('db:'));
  const dbOk = dbResults.filter((r) => r.ok).length;
  const total = results.length;
  const ok = results.filter((r) => r.ok).length;

  log(`${ok}/${total} requests answered; ${dbOk}/${dbResults.length} were real database queries.`);

  // The database queries are the point. Auth answering while every table
  // request failed is not a successful keep-alive, so the verdict is taken
  // from dbOk rather than from ok.
  if (dbOk > 0) {
    log('Project is awake. Activity recorded.');
    return 0;
  }

  fail('NO database query succeeded — this run generated no activity.');

  // Everything timing out or refusing connection is what a paused project
  // looks like from outside. Saying so plainly is worth more than the raw
  // errors, because the fix is a button and the 90-day clock has started.
  const allDead = dbResults.every((r) => r.status === null || r.status >= 500);
  if (allDead) {
    fail('');
    fail('  The project appears to be PAUSED or down.');
    fail('  Keep-alive cannot resume a paused project — nothing it sends arrives.');
    fail(`  Go to https://supabase.com/dashboard/project/${project} and press Resume.`);
    fail('  A paused project can only be restored for 90 days. After that it is');
    fail('  a download-and-restore job, not a button.');
  } else if (dbResults.some((r) => r.status === 404)) {
    fail('');
    fail('  Every table returned 404, so the project is up but the table names are wrong.');
    fail('  A 404 never reaches Postgres, so these runs count as NO activity at all —');
    fail('  the job would stay green while the project drifted towards a pause.');
    fail('  Fix DEFAULT_TABLES in this script, or set KEEPALIVE_TABLES.');
  }

  return 1;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    fail(`Unexpected failure: ${e?.stack || e}`);
    process.exit(1);
  });
