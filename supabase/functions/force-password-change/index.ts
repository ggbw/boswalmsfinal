// Bulk-set profiles.must_change_password so a group of users is required to
// choose a new password at their next login (the blocking ForcePasswordChange
// screen in AppLayout).
//
// Admins and super_admins are ALWAYS excluded, whatever scope is requested —
// locking every administrator out of the system at the same moment is the one
// mistake this action could make that is genuinely hard to undo.
//
// Callable only by admin / super_admin. Runs under the service role because the
// profiles UPDATE policy only grants 'admin', so a super_admin could not
// otherwise perform it.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const NEVER_TARGET = ["admin", "super_admin"];

const SCOPES: Record<string, string[]> = {
  // Everyone who is not an administrator.
  all_except_admins: ["student", "lecturer", "hod", "hoy", "hr", "manager", "employee"],
  students: ["student"],
  staff: ["lecturer", "hod", "hoy", "hr", "manager", "employee"],
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No authorization header" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: caller } } = await callerClient.auth.getUser();
    if (!caller) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: callerRoles } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", caller.id)
      .in("role", NEVER_TARGET);

    if (!callerRoles || callerRoles.length === 0) {
      return new Response(JSON.stringify({ error: "Only admins can require a password change" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const scope: string = body.scope || "all_except_admins";
    const dryRun: boolean = body.dry_run === true;

    const targetRoles = SCOPES[scope];
    if (!targetRoles) {
      return new Response(JSON.stringify({
        error: `Unknown scope "${scope}". Expected one of: ${Object.keys(SCOPES).join(", ")}`,
      }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Who holds a targeted role...
    const { data: targeted, error: targetErr } = await adminClient
      .from("user_roles").select("user_id").in("role", targetRoles);
    if (targetErr) {
      return new Response(JSON.stringify({ error: targetErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ...minus anyone who ALSO holds an admin role. A user can legitimately hold
    // more than one role, so this subtraction has to happen explicitly rather
    // than being assumed away by the role filter above.
    const { data: admins, error: adminErr } = await adminClient
      .from("user_roles").select("user_id").in("role", NEVER_TARGET);
    if (adminErr) {
      return new Response(JSON.stringify({ error: adminErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminIds = new Set((admins || []).map((r: { user_id: string }) => r.user_id));
    const userIds = [...new Set(
      (targeted || [])
        .map((r: { user_id: string }) => r.user_id)
        .filter((id: string) => !adminIds.has(id)),
    )];

    if (dryRun) {
      return new Response(JSON.stringify({ scope, would_update: userIds.length, dry_run: true }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (userIds.length === 0) {
      return new Response(JSON.stringify({ scope, updated: 0 }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Chunked: a single .in() with a few hundred UUIDs makes for a very long URL.
    let updated = 0;
    const CHUNK = 100;
    for (let i = 0; i < userIds.length; i += CHUNK) {
      const chunk = userIds.slice(i, i + CHUNK);
      const { data, error } = await adminClient
        .from("profiles")
        .update({ must_change_password: true })
        .in("user_id", chunk)
        .select("user_id");
      if (error) {
        return new Response(JSON.stringify({
          error: error.message,
          updated_before_failure: updated,
        }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      updated += (data || []).length;
    }

    return new Response(JSON.stringify({ scope, updated, excluded_admins: adminIds.size }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
