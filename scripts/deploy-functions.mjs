#!/usr/bin/env node
/**
 * Deploy the edge functions, then prove they answer.
 *
 * WHY A SCRIPT AND NOT JUST THE CLI COMMAND
 *
 * `supabase functions deploy` reports success when it has uploaded a bundle.
 * That is not the same as the function being reachable, and the gap between
 * the two is where this project lost a day: an undeployed function does not
 * reach a browser as a 404. Supabase's gateway answers the CORS preflight
 * itself, allowing only `authorization, x-client-info, apikey` — not
 * `content-type`, which supabase-js always sends — so the browser rejects the
 * preflight and reports a CORS error. The 404 underneath is never displayed,
 * and people go looking for a header bug in a function that does not exist.
 *
 * So this deploys and then asks each function, over the wire, whether it is
 * there. curl-style checks do not enforce CORS, so the truth is visible.
 *
 * WHY IT DEPLOYS EVERYTHING BY DEFAULT
 *
 * On 25 August 2026 not one edge function was deployed on this project —
 * `ingest-attendance` (the Hikvision sync the VPS calls every five minutes)
 * and `hr-create-user` were missing along with the new ones. Deploying only
 * the backup functions would have left those broken and unnoticed.
 *
 * USAGE
 *
 *   # PowerShell — same token as scripts/apply-migration.mjs
 *   $env:SUPABASE_ACCESS_TOKEN = "sbp_…"
 *   node scripts/deploy-functions.mjs
 *
 *   node scripts/deploy-functions.mjs --check              verify only
 *   node scripts/deploy-functions.mjs db-backup db-restore just these
 *
 * No `supabase login` and no Docker needed: the token comes from the
 * environment and --use-api bundles server-side.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { readEnv, warnIfTracked } from './read-env.mjs';

const FUNCTIONS_DIR = path.resolve('supabase/functions');

const args = process.argv.slice(2);
const CHECK_ONLY = args.includes('--check');
const named = args.filter((a) => !a.startsWith('--'));

// ─── Config ───────────────────────────────────────────────────────────────────

function projectRef() {
  const envFile = path.resolve('.env');
  if (fs.existsSync(envFile)) {
    const m = /VITE_SUPABASE_PROJECT_ID\s*=\s*"?([a-z0-9]+)"?/.exec(fs.readFileSync(envFile, 'utf8'));
    if (m) return m[1];
  }
  throw new Error('No VITE_SUPABASE_PROJECT_ID in .env');
}

function localFunctions() {
  if (!fs.existsSync(FUNCTIONS_DIR)) return [];
  return fs
    .readdirSync(FUNCTIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('_'))
    .map((d) => d.name)
    .sort();
}

// ─── Verification ─────────────────────────────────────────────────────────────

/**
 * A deployed function answers its own OPTIONS with 2xx. The gateway answers an
 * unknown slug with 404 and `sb-error-code: NOT_FOUND`.
 *
 * Deliberately a preflight and not a real call: it needs no credentials,
 * changes nothing, and distinguishes "not deployed" from "deployed and
 * refusing me", which is the only distinction that matters here.
 */
async function probe(ref, fn) {
  try {
    const res = await fetch(`https://${ref}.supabase.co/functions/v1/${fn}`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:8080',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization, content-type, apikey',
      },
    });

    // The preflight must also ALLOW content-type, or the browser will refuse
    // the real request even though the function exists. Checking it here means
    // a CORS regression is caught by this script rather than by a user.
    const allowed = (res.headers.get('access-control-allow-headers') ?? '').toLowerCase();
    return {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      code: res.headers.get('sb-error-code') ?? '',
      allowsContentType: allowed.includes('content-type'),
    };
  } catch (e) {
    return { ok: false, status: 0, code: e.message, allowsContentType: false };
  }
}

async function verify(ref, names) {
  console.log('\nAsking each function whether it is there:\n');
  let missing = 0;

  for (const fn of names) {
    const r = await probe(ref, fn);
    if (r.ok && r.allowsContentType) {
      console.log(`[  OK  ] ${fn}`);
    } else if (r.ok) {
      console.log(`[ WARN ] ${fn} — deployed, but its preflight does not allow content-type;`);
      console.log(`         browsers will report a CORS error on the real request.`);
      missing++;
    } else {
      console.log(`[ FAIL ] ${fn} — HTTP ${r.status} ${r.code}`);
      missing++;
    }
  }
  return missing;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const ref = projectRef();
const all = localFunctions();
const targets = named.length ? named : all;

if (!targets.length) {
  console.error(`No function directories under ${FUNCTIONS_DIR}`);
  process.exit(1);
}

console.log(`Project:   ${ref}`);
console.log(`Functions: ${targets.join(', ')}\n`);

if (!CHECK_ONLY) {
  const { value: token, source: tokenSource } = readEnv('SUPABASE_ACCESS_TOKEN');
  if (!token) {
    console.error(`
Missing SUPABASE_ACCESS_TOKEN.

  1. https://supabase.com/dashboard/account/tokens → Generate new token
  2. PowerShell:  $env:SUPABASE_ACCESS_TOKEN = "sbp_…"
     git bash:    export SUPABASE_ACCESS_TOKEN=sbp_…
     or add SUPABASE_ACCESS_TOKEN=sbp_… to .env.local (gitignored)
  3. Run this again.

(Or run 'npx supabase login' once instead — the token is only needed so the
CLI can authenticate without a browser.)
`);
    process.exit(1);
  }
  warnIfTracked('SUPABASE_ACCESS_TOKEN', tokenSource);

  // --use-api bundles server-side, so Docker is not required. No --prune: it
  // deletes functions that exist in the project but not locally, and a partial
  // checkout would then quietly remove working production functions.
  const cliArgs = [
    'supabase', 'functions', 'deploy',
    ...(named.length ? named : []),
    '--project-ref', ref,
    '--use-api',
  ];

  console.log(`Running: npx ${cliArgs.join(' ')}\n`);
  try {
    execFileSync('npx', cliArgs, {
      stdio: 'inherit',
      shell: process.platform === 'win32',
      // The CLI looks in its own environment. The token may have come from
      // .env.local rather than the shell, so hand it over explicitly.
      env: { ...process.env, SUPABASE_ACCESS_TOKEN: token },
    });
  } catch (e) {
    console.error(`\nDeploy failed (exit ${e.status}). The CLI's output is above.`);
    console.error('Common causes: a bad or expired token, or a TypeScript error in a function.\n');
    process.exit(1);
  }
}

const missing = await verify(ref, targets);

if (missing === 0) {
  console.log(`
All ${targets.length} function(s) are live.

Reload the LMS (Ctrl+Shift+R) and try Backup & Restore -> Back up to USB.
`);
} else {
  console.error(`
${missing} function(s) still not reachable. See docs/BACKUP_INSTALL.md section 4.5.
`);
  process.exitCode = 1;
}
