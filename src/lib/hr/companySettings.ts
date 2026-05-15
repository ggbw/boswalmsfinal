/**
 * Tiny helper for reading rows from the `company_settings` key/value table
 * (see migration 20260514000005_company_settings.sql).
 *
 * Reads are cached in a module-level Map for the lifetime of the page load so
 * that the same setting fetched twice in a render cycle hits the network
 * once. Use `invalidateCompanySettingsCache()` after an admin edit if you
 * want subsequent reads to see the new value without a page reload.
 */

import { supabase } from '@/integrations/supabase/client';

const cache = new Map<string, string | null>();

export async function getCompanySetting(key: string): Promise<string | null> {
  if (cache.has(key)) return cache.get(key) ?? null;
  try {
    const { data } = await supabase
      .from('company_settings')
      .select('value')
      .eq('key', key)
      .maybeSingle();
    const value = (data as { value?: string | null } | null)?.value ?? null;
    cache.set(key, value);
    return value;
  } catch {
    return null;
  }
}

export async function getCompanySettingNumber(key: string, fallback: number): Promise<number> {
  const raw = await getCompanySetting(key);
  if (raw === null || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export function invalidateCompanySettingsCache(): void {
  cache.clear();
}

export async function setCompanySetting(key: string, value: string, description?: string): Promise<{ error: string | null }> {
  const payload: Record<string, unknown> = {
    key,
    value,
    updated_at: new Date().toISOString(),
  };
  if (description !== undefined) payload.description = description;
  const { error } = await supabase
    .from('company_settings')
    .upsert(payload, { onConflict: 'key' });
  if (error) return { error: error.message };
  // Reflect the new value immediately for subsequent reads in the same tab.
  cache.set(key, value);
  return { error: null };
}
