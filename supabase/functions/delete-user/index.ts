// Delete a user properly — including their login.
//
// Both User Management and the Lecturers page used to delete a user by removing
// their `profiles` and `user_roles` rows and nothing else. The auth account
// survived. App.tsx checks `if (!user || !profile) return <LoginScreen/>`, so a
// "deleted" person could still sign in with their old password and was simply
// bounced back to the login screen with no message — invisible in both admin
// screens, but still holding valid credentials.
//
// That is exactly the state 11 accounts were found in on 2026-08-12, and it
// would have kept recurring.
//
// Deleting an auth account needs service-role rights, which the browser does not
// and should not have — hence this function.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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
      .from("user_roles").select("role").eq("user_id", caller.id)
      .in("role", ["admin", "super_admin"]);
    if (!callerRoles || callerRoles.length === 0) {
      return new Response(JSON.stringify({ error: "Only admins can delete users" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { user_id } = await req.json();
    if (!user_id) {
      return new Response(JSON.stringify({ error: "Missing user_id" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Deleting yourself would leave you signed in with no profile and unable to
    // get back in — and if you were the only admin, nobody could undo it.
    if (user_id === caller.id) {
      return new Response(JSON.stringify({ error: "You cannot delete your own account." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Refuse to remove the last administrator. Recovering from that needs
    // database access, which is not a position to put anyone in by accident.
    const { data: targetRoles } = await adminClient
      .from("user_roles").select("role").eq("user_id", user_id);
    const targetIsAdmin = (targetRoles || []).some(
      (r: { role: string }) => r.role === "admin" || r.role === "super_admin",
    );
    if (targetIsAdmin) {
      const { count } = await adminClient
        .from("user_roles")
        .select("user_id", { count: "exact", head: true })
        .in("role", ["admin", "super_admin"]);
      if ((count ?? 0) <= 1) {
        return new Response(JSON.stringify({
          error: "This is the only administrator account. Give someone else the admin role first.",
        }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Keep a note of what was removed — it is the only record afterwards.
    const { data: profile } = await adminClient
      .from("profiles").select("name,email,student_id").eq("user_id", user_id).maybeSingle();

    await adminClient.from("user_roles").delete().eq("user_id", user_id);
    await adminClient.from("profiles").delete().eq("user_id", user_id);

    // The login itself. Without this the person keeps working credentials.
    const { error: authErr } = await adminClient.auth.admin.deleteUser(user_id);
    if (authErr) {
      return new Response(JSON.stringify({
        error: "Profile and role were removed, but the login could not be deleted: " + authErr.message
             + " — the account can still sign in. Please retry.",
      }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({
      success: true,
      deleted: { name: profile?.name ?? null, email: profile?.email ?? null },
    }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
