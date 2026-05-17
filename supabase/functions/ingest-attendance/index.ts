// ═══════════════════════════════════════════════════════════════════════════
// supabase/functions/ingest-attendance/index.ts
//
// LOVABLE EDGE FUNCTION
//
// Receives parsed attendance records from the Contabo VPS and writes them
// into Supabase using the service role key (which is auto-injected here).
//
// Authentication: shared secret in HTTP header `x-sync-key`.
// ═══════════════════════════════════════════════════════════════════════════

import { serve }        from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-sync-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })

  try {
    // ─── Authenticate the VPS using shared secret ────────────────────────
    const expectedSecret = Deno.env.get("HIK_SYNC_SECRET")
    if (!expectedSecret) {
      console.error("HIK_SYNC_SECRET not set in Lovable Cloud secrets")
      return json({ success: false, error: "Server misconfiguration" }, 500)
    }
    const providedSecret = req.headers.get("x-sync-key")
    if (providedSecret !== expectedSecret) {
      console.warn("Auth failed:", providedSecret ? "wrong key" : "no key sent")
      return json({ success: false, error: "Unauthorized" }, 401)
    }

    // ─── Parse and validate request body ─────────────────────────────────
    const body = await req.json()
    const { records, runMetadata } = body

    if (!Array.isArray(records)) {
      return json({ success: false, error: "records must be an array" }, 400)
    }
    if (!records.length) {
      return json({ success: true, inserted: 0, skipped: 0, message: "No records to process" })
    }

    console.log(`[ingest] Received ${records.length} records from VPS`)

    // ─── Initialize Supabase client with service role ────────────────────
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    // ─── Optional: log this run ──────────────────────────────────────────
    let runId: number | null = null
    if (runMetadata) {
      const { data: run } = await supabase
        .from("sync_runs")
        .insert({
          status: "running",
          emails_seen:      runMetadata.emailsSeen      ?? 0,
          emails_processed: runMetadata.emailsProcessed ?? 0,
        })
        .select("id")
        .single()
      runId = run?.id ?? null
    }

    // ─── Auto-register devices first ─────────────────────────────────────
    const devicesSeen = new Map<string, string>()
    for (const r of records) {
      if (r.device_serial) {
        devicesSeen.set(r.device_serial, r.device_name ?? devicesSeen.get(r.device_serial) ?? "")
      }
    }
    for (const [serial, name] of devicesSeen) {
      const { error } = await supabase
        .from("attendance_devices")
        .upsert(
          {
            device_serial: serial,
            device_name:   name || serial,
            last_seen:     new Date().toISOString(),
            last_sync:     new Date().toISOString(),
          },
          { onConflict: "device_serial", ignoreDuplicates: false }
        )
      if (error) console.warn(`Device upsert ${serial}: ${error.message}`)
    }

    // ─── Insert attendance records in batches ────────────────────────────
    let inserted = 0
    let skipped  = 0
    const batchSize = 500

    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize)
      const { data, error } = await supabase
        .from("attendance_records")
        .upsert(batch, {
          onConflict: "device_serial,employee_id,punch_at",
          ignoreDuplicates: true,
        })
        .select("id")

      if (error) {
        console.error(`Batch insert failed: ${error.message}`)
        if (runId) {
          await supabase
            .from("sync_runs")
            .update({
              finished_at:   new Date().toISOString(),
              status:        "error",
              error_message: error.message,
              rows_inserted: inserted,
              rows_skipped:  skipped,
            })
            .eq("id", runId)
        }
        return json({ success: false, error: error.message, inserted, skipped }, 500)
      }

      const insertedThisBatch = (data || []).length
      inserted += insertedThisBatch
      skipped  += batch.length - insertedThisBatch
    }

    // ─── Finish the run log ──────────────────────────────────────────────
    if (runId) {
      await supabase
        .from("sync_runs")
        .update({
          finished_at:   new Date().toISOString(),
          status:        "success",
          rows_inserted: inserted,
          rows_skipped:  skipped,
        })
        .eq("id", runId)
    }

    console.log(`[ingest] Done. Inserted ${inserted}, skipped ${skipped} duplicates.`)
    return json({ success: true, inserted, skipped })
  } catch (e) {
    console.error("[ingest] Fatal error:", e)
    return json({ success: false, error: String(e) }, 500)
  }
})
