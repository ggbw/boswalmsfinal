// backup-report — the VPS's only door into this project.
//
// The nightly pg_dump runs on the Contabo VPS (the same box as the Hikvision
// agent). It needs three things from Supabase, and it should not hold the
// service role key to get them — that key can read and rewrite every table in
// the database, and it would be sitting in a file on a machine whose job is to
// talk to the public internet.
//
// So this function holds the key and the VPS holds a shared secret that can
// only do these three things:
//
//   { action: "start",   kind }              open a backup_runs row
//   { action: "presign", filename }          a 10-minute upload URL, one object
//   { action: "finish",  id, status, … }     close the row, prune old objects
//
// Same pattern, same reasoning, and the same secret-header shape as
// ingest-attendance, which the VPS already calls. verify_jwt is off for this
// function (see supabase/config.toml) because cron has no user session; the
// x-backup-secret header is what stands in for one.

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
const BASE_ALLOWED_HEADERS = "authorization, x-client-info, apikey, content-type, x-backup-secret";

function cors(req: Request): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers":
      req.headers.get("access-control-request-headers") ?? BASE_ALLOWED_HEADERS,
    "Access-Control-Max-Age": "86400",
  };
}

const BUCKET = "db-backups";

/** How long a mirrored dump stays in Supabase Storage. Days, not months: this
 *  copy exists so the Backup page can hand last night's dump to a USB stick
 *  without the browser talking to the VPS. The retained history is in Google
 *  Drive, where storage is free and the retention policy is the VPS script's. */
const KEEP_DAYS = 7;

/** Length-independent comparison. A plain === leaks the length of the secret
 *  and, in principle, its prefix, through timing. Cheap insurance. */
function secretMatches(given: string, expected: string): boolean {
  if (!given || !expected) return false;
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    diff |= (a[i % a.length] ?? 0) ^ (b[i % b.length] ?? 0);
  }
  return diff === 0;
}

Deno.serve(async (req: Request) => {
  const corsHeaders = cors(req);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  const expected = Deno.env.get("BACKUP_REPORT_SECRET") ?? "";
  if (!expected) return json({ error: "BACKUP_REPORT_SECRET is not set on this function" }, 500);
  if (!secretMatches(req.headers.get("x-backup-secret") ?? "", expected)) {
    return json({ error: "Forbidden" }, 403);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceKey) {
    return json({ error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — re-deploy this function." }, 500);
  }
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const body = await req.json();
    const action = String(body?.action ?? "");

    if (action === "start") {
      const kind = ["cloud", "restore_test"].includes(body.kind) ? body.kind : "cloud";
      const { data, error } = await admin.rpc("record_backup_run", {
        p_kind: kind,
        p_status: "running",
        p_actor_label: String(body.actor ?? "vps"),
        p_destination: String(body.destination ?? "Google Drive"),
      });
      if (error) throw error;
      return json({ ok: true, id: data });
    }

    if (action === "presign") {
      const name = String(body.filename ?? "").replace(/[^A-Za-z0-9._-]/g, "");
      if (!name) return json({ error: "filename required" }, 400);
      // upsert so a re-run of the same night's job replaces rather than 409s.
      const { data, error } = await admin.storage
        .from(BUCKET)
        .createSignedUploadUrl(name, { upsert: true });
      if (error) throw error;
      return json({ ok: true, path: data.path, token: data.token, signedUrl: data.signedUrl });
    }

    if (action === "finish") {
      const { error } = await admin.rpc("record_backup_run", {
        p_id: body.id ?? null,
        p_kind: ["cloud", "restore_test"].includes(body.kind) ? body.kind : "cloud",
        p_status: ["success", "failed"].includes(body.status) ? body.status : "failed",
        p_artifact: body.artifact ?? null,
        p_destination: body.destination ?? null,
        p_storage_path: body.storage_path ?? null,
        p_size_bytes: body.size_bytes ?? null,
        p_table_count: body.table_count ?? null,
        p_row_count: body.row_count ?? null,
        p_checksum: body.checksum ?? null,
        p_actor_label: body.actor ?? "vps",
        p_message: body.message ?? null,
        p_metadata: body.metadata ?? null,
      });
      if (error) throw error;

      // Prune the mirror. Done here rather than on the VPS because deleting
      // storage objects needs the service role, and the whole point of this
      // function is that the VPS does not have it.
      let pruned: string[] = [];
      try {
        const cutoff = Date.now() - KEEP_DAYS * 86_400_000;
        const { data: objects } = await admin.storage.from(BUCKET).list("", { limit: 1000 });
        const stale = (objects ?? [])
          .filter((o) => new Date(o.created_at ?? o.updated_at ?? 0).getTime() < cutoff)
          .map((o) => o.name);
        if (stale.length) {
          await admin.storage.from(BUCKET).remove(stale);
          pruned = stale;
        }
      } catch {
        // Pruning is housekeeping. A backup that succeeded must not be
        // reported as failed because yesterday's copy could not be deleted.
      }

      return json({ ok: true, pruned });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
