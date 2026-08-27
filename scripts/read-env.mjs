/**
 * Read a value from the shell environment, or failing that from `.env.local`
 * and `.env`.
 *
 * Shared by apply-migration.mjs and deploy-functions.mjs, because both need
 * SUPABASE_ACCESS_TOKEN and the obvious place to put it — next to the other
 * Supabase settings in `.env` — is not somewhere `process.env` looks. Vite
 * injects `.env` into the *browser bundle*, not into Node, so a token pasted
 * there silently does nothing and the script keeps saying it is missing.
 *
 * Precedence, highest first:
 *
 *   1. the shell environment   ($env:SUPABASE_ACCESS_TOKEN = "…")
 *   2. .env.local              gitignored by the `*.local` rule
 *   3. .env                    TRACKED BY GIT — see the warning below
 *
 * `.env` is last deliberately, and using it is reported rather than silently
 * accepted: it is committed to this repository, so a service role key or a
 * personal access token left in it goes to the remote with the next push. Both
 * are far more dangerous than the publishable key that legitimately lives
 * there — the service role key bypasses every RLS policy in the database, and
 * a personal access token controls the whole Supabase account.
 */

import fs from 'node:fs';
import path from 'node:path';

function parse(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  // Split on \r?\n, not \n. A CRLF file — which is what `.env` becomes after a
  // checkout on Windows — otherwise leaves \r at the end of every line, and
  // JavaScript's `.` does not match \r, so `(.*)$` fails on all of them. The
  // parser then reports every variable as missing, and the scripts that call
  // it insist a token is absent while the user is looking straight at it.
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    out[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

/**
 * @param {string} name
 * @returns {{ value: string | undefined, source: string }}
 */
export function readEnv(name) {
  if (process.env[name]) return { value: process.env[name], source: 'environment' };

  const local = parse(path.resolve('.env.local'));
  if (local[name]) return { value: local[name], source: '.env.local' };

  const dotenv = parse(path.resolve('.env'));
  if (dotenv[name]) return { value: dotenv[name], source: '.env' };

  return { value: undefined, source: 'nowhere' };
}

/** Print the warning once, if a secret came out of the tracked file. */
export function warnIfTracked(name, source) {
  if (source !== '.env') return;
  console.warn(`
  ⚠  ${name} was read from .env, which IS TRACKED BY GIT.
     It will be committed and pushed. Move it to .env.local (already ignored
     by the *.local rule) and, if it has been pushed, rotate it:
       service role key  → Supabase → Settings → API → Reset
       sbp_ access token → https://supabase.com/dashboard/account/tokens
`);
}
