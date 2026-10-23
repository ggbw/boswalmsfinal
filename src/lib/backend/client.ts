/**
 * The app's Supabase client, pinned to boswa-live.
 *
 * vite.config.ts and tsconfig resolve `@/integrations/supabase/client` to this
 * file, so the 90-odd imports of that path land here and the Lovable-generated
 * client beside it is never loaded. See ./config.ts for why.
 */
import { createClient } from '@supabase/supabase-js';

import { brokeredPreviewStorage } from '@/integrations/supabase/previewAuthStorage';

import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './config';
import type { Database } from './types';

function isNewSupabaseApiKey(value: string): boolean {
  return value.startsWith('sb_publishable_') || value.startsWith('sb_secret_');
}

/** New sb_publishable_ keys are opaque, not JWTs, so they go in `apikey` and never as a bearer token. */
function createSupabaseFetch(supabaseKey: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(
      typeof Request !== 'undefined' && input instanceof Request ? input.headers : undefined,
    );

    if (init?.headers) {
      new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    }

    if (isNewSupabaseApiKey(supabaseKey) && headers.get('Authorization') === `Bearer ${supabaseKey}`) {
      headers.delete('Authorization');
    }

    headers.set('apikey', supabaseKey);
    return fetch(input, { ...init, headers });
  };
}

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  global: {
    fetch: createSupabaseFetch(SUPABASE_PUBLISHABLE_KEY),
  },
  auth: {
    storage: brokeredPreviewStorage(),
    persistSession: true,
    autoRefreshToken: true,
  },
});
