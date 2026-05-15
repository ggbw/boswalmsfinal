import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ADMIN_ROLES = ["super_admin", "admin"];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");
    const { data: { user: caller }, error: callerError } = await supabaseAdmin.auth.getUser(token);
    if (callerError || !caller) throw new Error("Unauthorized");

    const { data: callerRoles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", caller.id);
    const callerRoleSet = new Set((callerRoles ?? []).map((r: { role: string }) => r.role));
    const callerIsSuper = callerRoleSet.has("super_admin");
    if (!ADMIN_ROLES.some((r) => callerRoleSet.has(r))) throw new Error("Insufficient permissions");

    const { target_user_id, redirect_to } = await req.json();
    if (!target_user_id) throw new Error("target_user_id is required");

    const { data: targetRoles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", target_user_id);
    const targetIsSuper = (targetRoles ?? []).some((r: { role: string }) => r.role === "super_admin");
    if (targetIsSuper && !callerIsSuper) {
      throw new Error("Cannot impersonate a Super Admin.");
    }

    const { data: { user: targetUser }, error: targetError } =
      await supabaseAdmin.auth.admin.getUserById(target_user_id);
    if (targetError || !targetUser?.email) throw new Error("Target user not found");

    const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email: targetUser.email,
      options: { redirectTo: redirect_to ?? undefined },
    });
    if (linkError) throw linkError;

    const actionLink = (linkData as unknown as { properties?: { action_link?: string } })
      ?.properties?.action_link ?? null;
    if (!actionLink) throw new Error("Failed to generate login link");

    const { data: targetProfile } = await supabaseAdmin
      .from("profiles")
      .select("username, name")
      .eq("user_id", target_user_id)
      .maybeSingle();

    // Persist a session row so the target user's ImpersonationBanner can
    // detect that the resulting session is an impersonation. Best-effort:
    // if the table doesn't exist yet (migration not applied) we still
    // return the action link so the magic-link flow keeps working.
    let sessionId: string | null = null;
    try {
      const { data: sessRow } = await supabaseAdmin
        .from("impersonation_sessions")
        .insert({
          admin_user_id: caller.id,
          target_user_id,
        })
        .select("id")
        .single();
      sessionId = (sessRow as { id?: string } | null)?.id ?? null;
    } catch {
      // Table missing — banner will not appear, but impersonation still works.
    }

    return new Response(
      JSON.stringify({
        success: true,
        action_link: actionLink,
        target_email: targetUser.email,
        target_username: targetProfile?.username ?? null,
        target_name: targetProfile?.name ?? null,
        session_id: sessionId,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 400,
    });
  }
});
