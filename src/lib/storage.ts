/**
 * Signed URLs for private storage buckets.
 *
 * A public bucket hands out permanent, unauthenticated URLs — anyone with the
 * link can fetch the object forever, no login. That is fine for a logo and
 * wrong for photographs of students. Signing keeps the bucket private: the URL
 * carries a short-lived token tied to the request that created it.
 *
 * The cost is that signed URLs EXPIRE. Anything rendered from one has to be
 * re-signed if the page is left open past the TTL, so keep the TTL comfortably
 * longer than a realistic sitting on the page rather than as short as possible.
 */

import { supabase } from '@/integrations/supabase/client';

/** One hour — long enough to browse a gallery without a mid-session refresh. */
export const SIGNED_URL_TTL = 60 * 60;

/** Signed URL for a single object. Returns '' on failure, so callers can render a placeholder. */
export async function signedUrl(
  bucket: string,
  path: string,
  ttl = SIGNED_URL_TTL,
): Promise<string> {
  if (!path) return '';
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, ttl);
  if (error || !data) return '';
  return data.signedUrl;
}

/**
 * Signed URLs for many objects, keyed by path.
 *
 * One request per chunk rather than one per file — a gallery of 200 photos
 * signed individually would be 200 round trips.
 */
export async function signedUrls(
  bucket: string,
  paths: string[],
  ttl = SIGNED_URL_TTL,
): Promise<Record<string, string>> {
  const unique = [...new Set(paths.filter(Boolean))];
  const map: Record<string, string> = {};
  if (unique.length === 0) return map;

  const CHUNK = 100;
  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK);
    const { data, error } = await supabase.storage.from(bucket).createSignedUrls(chunk, ttl);
    if (error || !data) continue;
    for (const entry of data) {
      // `path` comes back without a leading slash, matching what we sent.
      if (entry.path && entry.signedUrl) map[entry.path] = entry.signedUrl;
    }
  }
  return map;
}
