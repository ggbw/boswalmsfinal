// db-restore — put a backup file back into the database.
//
// The counterpart to db-backup. A backup nobody has ever restored is a
// hypothesis, not a backup, so this exists as much to be rehearsed as to be
// used in anger.
//
// SHAPE OF THE CONVERSATION
//
// The browser holds the file and drives; this function is stateless and does
// one small thing per call. That keeps a 200 MB restore inside a browser's
// memory budget and lets the UI show real progress.
//
//   { mode: "inspect", manifest }          → what would happen, changing nothing
//   { mode: "clear",   tables: [...] }     → empty these, deepest first
//   { mode: "apply",   table, rows }       → upsert one batch
//   { mode: "finish",  summary }           → write the audit entry
//
// SAFETY
//
//   • super_admin only. Not admin — an LMS administrator manages the school,
//     they do not overwrite it.
//   • "clear" refuses audit_logs, user_sessions, backup_runs and user_roles.
//     A restore that erased the record of itself, or that locked out every
//     account because the backup predates a role change, is not recoverable
//     by the person running it.
//   • Every call is audited, and "finish" writes a critical-severity entry
//     naming the file, the strategy and the row counts.
//   • Unknown columns are dropped and reported rather than failing the batch —
//     a backup restored six months later is precisely the case that matters,
//     and it is the case where the schema will have moved.

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
  };
}

const FORMAT_VERSION = 1;

/** Tables a restore may never clear. Mirrors backup_clear_table() so the
 *  refusal arrives as a readable message instead of a Postgres exception. */
const PROTECTED = new Set(["audit_logs", "user_sessions", "backup_runs", "user_roles"]);

interface ManifestTable { name: string; rows: number; depth: number; pk: string[] }

Deno.serve(async (req: Request) => {
  const corsHeaders = cors(req);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceKey) {
    return json({ error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — re-deploy this function." }, 500);
  }
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    // ── Caller must be super_admin ───────────────────────────────────────────
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const { data: { user: caller }, error: callerError } = await admin.auth.getUser(token);
    if (callerError || !caller) return json({ error: "Unauthorized" }, 401);

    const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", caller.id);
    const held = new Set((roles ?? []).map((r: { role: string }) => r.role));
    if (!held.has("super_admin")) {
      return json({ error: "Only a super administrator may restore the database" }, 403);
    }

    const body = await req.json();
    const mode = String(body?.mode ?? "");

    // Column map is needed by inspect and apply alike; one call, reused.
    const columnsOf = async () => {
      const { data, error } = await admin.rpc("backup_table_columns");
      if (error) throw error;
      const map = new Map<string, Set<string>>();
      for (const c of (data ?? []) as { table_name: string; column_name: string; is_generated: boolean }[]) {
        if (c.is_generated) continue;  // GENERATED ALWAYS columns reject writes
        if (!map.has(c.table_name)) map.set(c.table_name, new Set());
        map.get(c.table_name)!.add(c.column_name);
      }
      return map;
    };

    // ── inspect: a dry run that touches nothing ──────────────────────────────
    if (mode === "inspect") {
      const manifest = body.manifest ?? {};
      if (Number(manifest.version) !== FORMAT_VERSION) {
        return json({
          error: `This file is format version ${manifest.version ?? "?"}; this system reads version ${FORMAT_VERSION}.`,
        }, 400);
      }

      const cols = await columnsOf();
      const { data: countRows } = await admin.rpc("backup_row_counts");
      const current = new Map<string, number>(
        ((countRows ?? []) as { table_name: string; exact_rows: number }[])
          .map((c) => [c.table_name, Number(c.exact_rows)]),
      );

      const incoming = (manifest.tables ?? []) as ManifestTable[];
      const report = incoming.map((t) => {
        const live = cols.get(t.name);
        return {
          table: t.name,
          exists: !!live,
          protected: PROTECTED.has(t.name),
          incoming_rows: t.rows,
          current_rows: current.get(t.name) ?? 0,
          no_primary_key: !t.pk?.length,
        };
      });

      // Tables that exist now but are absent from the file. A replace-restore
      // leaves them untouched — worth saying out loud, because "restored to
      // the state of 3 March" is then not quite true.
      const known = new Set(incoming.map((t) => t.name));
      const notInFile = [...cols.keys()].filter((t) => !known.has(t)).sort();

      return json({
        ok: true,
        version: manifest.version,
        generated_at: manifest.generated_at ?? null,
        taken_by: manifest.taken_by ?? null,
        total_rows: manifest.total_rows ?? null,
        tables: report,
        missing_tables: report.filter((r) => !r.exists).map((r) => r.table),
        tables_not_in_file: notInFile,
      });
    }

    // ── clear: empty tables ahead of a replace-restore ───────────────────────
    if (mode === "clear") {
      const tables = (body.tables ?? []) as string[];
      const refused = tables.filter((t) => PROTECTED.has(t));
      if (refused.length) {
        return json({ error: `Refusing to clear: ${refused.join(", ")}` }, 400);
      }

      const cleared: Record<string, number> = {};
      // Caller sends them deepest-first; honouring that order is what keeps
      // the foreign keys satisfied at every intermediate step.
      for (const t of tables) {
        const { data, error } = await admin.rpc("backup_clear_table", { _table: t });
        if (error) return json({ error: `${t}: ${error.message}`, cleared }, 400);
        cleared[t] = Number(data ?? 0);
      }
      return json({ ok: true, cleared });
    }

    // ── apply: one batch of rows ─────────────────────────────────────────────
    if (mode === "apply") {
      const table = String(body.table ?? "");
      const rows = (body.rows ?? []) as Record<string, unknown>[];
      const pk = (body.pk ?? []) as string[];
      if (!table || !rows.length) return json({ ok: true, written: 0, dropped_columns: [] });

      const cols = (await columnsOf()).get(table);
      if (!cols) return json({ error: `Table ${table} no longer exists` }, 400);

      const dropped = new Set<string>();
      const clean = rows.map((row) => {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(row)) {
          if (cols.has(k)) out[k] = v;
          else dropped.add(k);
        }
        return out;
      });

      // upsert on the primary key, so re-running a restore is idempotent and a
      // half-finished one can simply be run again. Without a PK there is
      // nothing to conflict on and insert is the only option — which is why
      // inspect flags those tables.
      const q = pk.length
        ? admin.from(table).upsert(clean, { onConflict: pk.join(","), defaultToNull: false })
        : admin.from(table).insert(clean);

      const { error } = await q;
      if (error) return json({ error: `${table}: ${error.message}` }, 400);

      return json({ ok: true, written: clean.length, dropped_columns: [...dropped] });
    }

    // ── finish: leave a mark in the audit trail ──────────────────────────────
    if (mode === "finish") {
      const s = body.summary ?? {};
      const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { autoRefreshToken: false, persistSession: false },
      });
      // Logged as the person, not as the service role: "the database was
      // overwritten" is only useful next to a name.
      await userClient.rpc("log_audit_event", {
        p_action: "database_restore",
        p_category: "admin",
        p_entity_type: "database",
        p_entity_id: null,
        p_entity_label: String(s.file ?? "backup file"),
        p_summary: `Restored ${s.rows ?? 0} rows across ${s.tables ?? 0} tables (${s.strategy ?? "merge"}) from ${s.file ?? "a backup file"}`,
        p_metadata: s,
        p_severity: "critical",
        p_status: s.failed ? "failure" : "success",
        p_session_id: null,
      });
      return json({ ok: true });
    }

    return json({ error: `Unknown mode: ${mode}` }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
