/**
 * The single place the Supabase project URL and publishable key are read.
 *
 * Both are supplied by Vite from `.env` (committed, the live project) and can
 * be overridden per-developer by `.env.local`, which Vite loads last and which
 * `.gitignore` already excludes via its `*.local` rule. To point a local dev
 * server at the old Lovable project instead:
 *
 *     cp .env.lovable.example .env.local   # then restart `npm run dev`
 *
 * Deleting `.env.local` switches back. Nothing else in the codebase reads
 * these variables directly, so that copy/delete is the whole switch.
 */

const url = import.meta.env.VITE_SUPABASE_URL;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

/**
 * Fail loudly and by name. Passing `undefined` into `createClient` is accepted
 * without complaint and only blows up later, on the first query, as an opaque
 * network error — which reads like "the database is down" rather than "the env
 * var is missing". Naming the variable here turns a confusing outage into a
 * one-line fix.
 */
function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing ${name}. Add it to .env (or .env.local) and restart the dev server.`,
    );
  }
  return value;
}

export const SUPABASE_URL = required('VITE_SUPABASE_URL', url);
export const SUPABASE_PUBLISHABLE_KEY = required(
  'VITE_SUPABASE_PUBLISHABLE_KEY',
  publishableKey,
);
