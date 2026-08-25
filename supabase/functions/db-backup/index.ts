// db-backup — stream the whole database out as one NDJSON document.
//
// This is the server half of the "Save backup to USB" button. It runs with the
// service role, so it sees every row of every table regardless of RLS: a
// backup taken through a normal login would silently omit exactly the records
// that user cannot read, and would look complete while being useless.
//
// WHY A STREAM, AND WHY NDJSON
//
// The obvious implementation — read every table into memory, JSON.stringify
// the lot, return it — works until the database outgrows the function's
// memory, and then it fails at the worst possible moment: the day someone
// takes a backup because something has gone wrong. Streaming keeps memory flat
// at one page of rows no matter how large the database gets, and the browser
// writes each chunk straight to the USB stick as it arrives.
//
// NDJSON (one JSON value per line) is what makes that possible. A single JSON
// array cannot be produced or consumed incrementally without a streaming
// parser; a file of independent lines can be read back with split('\n') and
// resynchronises after a damaged line instead of being a total loss.
//
// THE FORMAT
//
//   line 1     {"kind":"manifest", ...}   what follows, and how many rows
//   line 2..n  {"kind":"rows","table":"students","data":[ … ]}
//   last line  {"kind":"end","tables":N,"rows":M}
//
// The manifest first and the trailer last is deliberate. A file with no `end`
// line was truncated — the write was interrupted, the stick was pulled — and
// the verifier says so rather than presenting a half backup as a whole one.
//
// WHAT THIS BACKUP DOES *NOT* CONTAIN
//
//   • Schema. It is rows, not DDL. Restoring it needs a database whose tables
//     already exist — which is why the nightly pg_dump on the VPS exists too.
//   • auth.users, and therefore passwords. Those live outside the public
//     schema and no API can export their hashes.
//   • Storage objects: student photos, notes, contract PDFs.
//
// docs/BACKUP_AND_RESTORE.md sets out which of the two backups answers which
// kind of disaster. Neither one alone covers everything.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * CORS.
 *
 * `Access-Control-Allow-Headers` must name every header the browser announces
 * in its preflight, or the request is refused before this function ever runs.
 * Rather than maintain a list that drifts as supabase-js adds headers, the
 * preflight echoes back whatever was asked for, falling back to the known set
 * when a caller sends no Access-Control-Request-Headers at all.
 *
 * Worth knowing while debugging: if this function is NOT deployed, none of
 * this runs. Supabase's gateway answers the preflight itself, allowing only
 * `authorization, x-client-info, apikey` — not `content-type` — so the browser
 * reports a CORS error and hides the 404 underneath it. A "CORS error" from an
 * edge function is far more often a deployment problem than a header problem.
 */
const BASE_ALLOWED_HEADERS = "authorization, x-client-info, apikey, content-type";

function cors(req: Request): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers":
      req.headers.get("access-control-request-headers") ?? BASE_ALLOWED_HEADERS,
    "Access-Control-Max-Age": "86400",
    // Without this the browser can see the body but not the X-Backup-* headers,
    // and the client would have no run id to close out afterwards.
    "Access-Control-Expose-Headers": "x-backup-run-id, x-backup-expected-rows, x-backup-tables",
  };
}

const ADMIN_ROLES = ["admin", "super_admin"];

/** Rows per fetch, and per output line. Small enough that one page is never a
 *  memory problem, large enough that a 40 000-row table is 80 round trips. */
const PAGE_SIZE = 500;

/** Format version. Bump it if the shape of a line ever changes, so an old file
 *  meeting a new restorer is refused by name instead of misread. */
const FORMAT_VERSION = 1;

interface TableInfo {
  table_name: string;
  pk_columns: string[] | null;
  depth: number;
  approx_rows: number;
}

Deno.serve(async (req: Request) => {
  const corsHeaders = cors(req);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

  // Built inside a guard, not at the top of the handler. If a secret is missing
  // this throws, and a throw that escapes the handler becomes the runtime's own
  // 500 — which carries no CORS headers, so the browser reports it as a CORS
  // error and the real message ("SUPABASE_SERVICE_ROLE_KEY is undefined") is
  // never seen. Every exit from this function carries corsHeaders.
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceKey) {
    return new Response(
      JSON.stringify({
        error: "This function is missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. " +
               "Both are injected automatically — re-deploy the function.",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // ── Who is asking ──────────────────────────────────────────────────────────
  let actorLabel = "unknown";
  try {
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const { data: { user: caller }, error: callerError } = await admin.auth.getUser(token);
    if (callerError || !caller) throw new Error("Unauthorized");

    const { data: roles } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", caller.id);
    const held = new Set((roles ?? []).map((r: { role: string }) => r.role));
    if (!ADMIN_ROLES.some((r) => held.has(r))) {
      throw new Error("Only an administrator may take a database backup");
    }

    const { data: profile } = await admin
      .from("profiles")
      .select("name, email")
      .eq("user_id", caller.id)
      .maybeSingle();
    actorLabel = `${profile?.name ?? profile?.email ?? caller.email ?? caller.id}`;
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    // ── Inventory ────────────────────────────────────────────────────────────
    const { data: order, error: orderError } = await admin.rpc("backup_table_order");
    if (orderError) throw orderError;
    const tables = (order ?? []) as TableInfo[];
    if (!tables.length) throw new Error("backup_table_order() returned nothing — is the migration applied?");

    const { data: counts, error: countError } = await admin.rpc("backup_row_counts");
    if (countError) throw countError;
    const exact = new Map<string, number>(
      ((counts ?? []) as { table_name: string; exact_rows: number }[])
        .map((c) => [c.table_name, Number(c.exact_rows)]),
    );

    // Tables the caller asked to skip — the UI offers this for the two audit
    // tables, which can be far larger than the rest of the database put
    // together and are not needed to reconstitute the school's records.
    let skip: string[] = [];
    if (req.method === "POST") {
      try {
        const body = await req.json();
        if (Array.isArray(body?.skip)) skip = body.skip.map(String);
      } catch { /* no body is fine */ }
    }
    const included = tables.filter((t) => !skip.includes(t.table_name));

    const expectedRows = included.reduce((s, t) => s + (exact.get(t.table_name) ?? 0), 0);

    // ── Open the history row ─────────────────────────────────────────────────
    // Opened before a byte is sent so that an interrupted backup leaves a
    // 'running' row behind. The client closes it as 'success' once the file is
    // on disk — which is the only moment anyone can honestly call it a backup.
    const { data: runId } = await admin.rpc("record_backup_run", {
      p_kind: "usb",
      p_status: "running",
      p_actor_label: actorLabel,
      p_destination: "Local disk / USB",
      p_table_count: included.length,
      p_row_count: expectedRows,
    });

    const manifest = {
      kind: "manifest",
      version: FORMAT_VERSION,
      generated_at: new Date().toISOString(),
      project_ref: supabaseUrl.replace(/^https:\/\/([^.]+).*$/, "$1"),
      run_id: runId ?? null,
      taken_by: actorLabel,
      total_rows: expectedRows,
      skipped: skip,
      tables: included.map((t) => ({
        name: t.table_name,
        rows: exact.get(t.table_name) ?? 0,
        depth: t.depth,
        pk: t.pk_columns ?? [],
      })),
    };

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        const line = (o: unknown) => controller.enqueue(encoder.encode(JSON.stringify(o) + "\n"));
        let written = 0;

        try {
          line(manifest);

          for (const t of included) {
            const pk = (t.pk_columns ?? [])[0];
            let from = 0;

            // Keyset paging would be nicer, but the primary keys here are a
            // mix of uuid, text and composite. Ordering by the first PK column
            // and using range() is stable enough: the backup runs in seconds
            // and nothing reorders rows underneath it.
            for (;;) {
              let q = admin.from(t.table_name).select("*").range(from, from + PAGE_SIZE - 1);
              if (pk) q = q.order(pk, { ascending: true });
              const { data, error } = await q;
              if (error) throw new Error(`${t.table_name}: ${error.message}`);

              const rows = data ?? [];
              if (rows.length) {
                // `n` before `data` on purpose: it lets the browser read the
                // size of a batch off the first hundred bytes of the line with
                // a regex, and show progress, without JSON.parse-ing a payload
                // it is only going to forward to disk unchanged.
                line({ kind: "rows", table: t.table_name, n: rows.length, data: rows });
                written += rows.length;
              }
              if (rows.length < PAGE_SIZE) break;
              from += PAGE_SIZE;
            }
          }

          line({ kind: "end", tables: included.length, rows: written });
          controller.close();
        } catch (e) {
          // The response has already begun, so there is no status code left to
          // change. An `error` line instead of an `end` line is how the client
          // learns this file is not a backup — and the absence of `end` alone
          // would already have told the verifier the same thing.
          line({ kind: "error", message: (e as Error).message });
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Backup-Run-Id": String(runId ?? ""),
        "X-Backup-Expected-Rows": String(expectedRows),
        "X-Backup-Tables": String(included.length),
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
