import { supabase } from '@/integrations/supabase/client';

/**
 * Call an edge function and get the REAL error message back.
 *
 * supabase.functions.invoke() does something unhelpful on any non-2xx reply:
 * `data` comes back null and `error.message` is the literal string
 *
 *     "Edge Function returned a non-2xx status code"
 *
 * The message the function actually sent — "Only admins can delete users",
 * "This is the only administrator account", the Postgres constraint that was
 * violated — is sitting unread in the response body on `error.context`.
 *
 * So every call site that did
 *
 *     if (error || data?.error) toast(data?.error || error.message)
 *
 * showed the generic string, because on a 4xx `data` is null and there is no
 * `data.error` to prefer. Deleting a student reported "something about edge
 * functions" for exactly this reason: the function was explaining itself and
 * nobody was listening.
 */
export async function invokeFn<T = unknown>(
  name: string,
  body?: unknown,
): Promise<{ data: T | null; error: string | null }> {
  const { data, error } = await supabase.functions.invoke(name, { body: body ?? {} });

  if (error) {
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      try {
        const parsed = await ctx.clone().json();
        if (parsed?.error) return { data: null, error: String(parsed.error) };
      } catch {
        // Not JSON — fall through to the text body, then to error.message.
        try {
          const text = await ctx.clone().text();
          if (text) return { data: null, error: text.slice(0, 400) };
        } catch { /* nothing readable */ }
      }
    }
    // A function that was never deployed fails here, and the generic message
    // gives no hint. Name it, so the fix is obvious.
    if (/Failed to send a request|Failed to fetch|NetworkError/i.test(error.message)) {
      return { data: null, error: `The "${name}" function could not be reached — it may not be deployed.` };
    }
    return { data: null, error: error.message || `${name} failed` };
  }

  const payload = data as { error?: string } | null;
  if (payload?.error) return { data: null, error: String(payload.error) };
  return { data: data as T, error: null };
}
