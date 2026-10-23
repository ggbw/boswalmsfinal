/**
 * The Boswa backend: the client's own Supabase project, boswa-live.
 *
 * Pinned here rather than read from `.env` because Lovable Cloud owns `.env`,
 * `supabase/config.toml` and `src/integrations/supabase/*` and rewrites them
 * to its own database whenever it touches the project (it did on 21 Oct 2026,
 * which locked every user out). Nothing Lovable generates reaches this file.
 *
 * The publishable key is public by design — it ships in every browser bundle;
 * row-level security is what protects the data. Never put the service-role
 * key here.
 *
 * A developer can point a local dev server elsewhere with
 * VITE_BOSWA_SUPABASE_URL / VITE_BOSWA_SUPABASE_PUBLISHABLE_KEY in `.env.local`.
 */

export const BOSWA_PROJECT_REF = 'dwavbotriuabrvhqeshm';

export const SUPABASE_URL: string =
  import.meta.env.VITE_BOSWA_SUPABASE_URL || `https://${BOSWA_PROJECT_REF}.supabase.co`;

export const SUPABASE_PUBLISHABLE_KEY: string =
  import.meta.env.VITE_BOSWA_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_5pxrDo2uRg72lXGTRpE03Q_AyOce4jE';
