import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ADMIN_ROLES = ["super_admin", "admin", "hr"];

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

    const {
      user_id,
      username,
      full_name,
      email,
      password,
      role,
      employee_id,
      must_change_password,
      employee_code,
    } = await req.json();

    if (!user_id) throw new Error("user_id is required");

    // Block non-super-admins from editing super_admin accounts
    const { data: targetRoles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", user_id);
    const targetIsSuper = (targetRoles ?? []).some((r: { role: string }) => r.role === "super_admin");
    if (targetIsSuper && !callerIsSuper) {
      throw new Error("Only a Super Admin can edit a Super Admin account.");
    }

    if (typeof username === "string" && username.trim()) {
      const cleaned = username.trim().toLowerCase();
      if (!/^[a-z0-9._-]+$/.test(cleaned)) {
        throw new Error("Username may only contain letters, numbers, '.', '_' or '-'.");
      }
      const { data: clash } = await supabaseAdmin
        .from("profiles")
        .select("user_id")
        .eq("username", cleaned)
        .neq("user_id", user_id)
        .maybeSingle();
      if (clash) throw new Error(`Username "${cleaned}" is already taken.`);
    }

    // Update auth.users for email/password
    const authUpdate: Record<string, unknown> = {};
    if (typeof email === "string" && email.trim()) {
      authUpdate.email = email.trim();
      authUpdate.email_confirm = true;
    }
    if (typeof password === "string" && password.length > 0) {
      if (password.length < 6) throw new Error("Password must be at least 6 characters");
      authUpdate.password = password;
    }
    if (Object.keys(authUpdate).length > 0) {
      const { error: authErr } = await supabaseAdmin.auth.admin.updateUserById(user_id, authUpdate);
      if (authErr) throw authErr;
    }

    // Update profiles row
    const profileUpdate: Record<string, unknown> = {};
    if (typeof username === "string") profileUpdate.username = username.trim() || null;
    if (typeof full_name === "string") profileUpdate.name = full_name.trim() || null;
    if (typeof email === "string" && email.trim()) profileUpdate.email = email.trim();
    if (must_change_password !== undefined) profileUpdate.must_change_password = must_change_password;

    if (Object.keys(profileUpdate).length > 0) {
      await supabaseAdmin.from("profiles").update(profileUpdate).eq("user_id", user_id);
    }

    // Update role (delete + insert keeps single-role invariant)
    if (typeof role === "string") {
      await supabaseAdmin.from("user_roles").delete().eq("user_id", user_id);
      const { error: roleErr } = await supabaseAdmin
        .from("user_roles")
        .insert({ user_id, role });
      if (roleErr) throw roleErr;
    }

    // Sync employee linkage
    if (employee_id !== undefined) {
      await supabaseAdmin
        .from("employees")
        .update({ auth_user_id: null })
        .eq("auth_user_id", user_id);
      if (employee_id) {
        await supabaseAdmin
          .from("employees")
          .update({ auth_user_id: user_id })
          .eq("id", employee_id);
      }
    }

    // Update employee_code on linked employee
    if (typeof employee_code === "string" && employee_code.trim()) {
      const code = employee_code.trim().toUpperCase();
      const { data: linkedEmp } = await supabaseAdmin
        .from("employees")
        .select("id")
        .eq("auth_user_id", user_id)
        .maybeSingle();
      const targetEmployeeId = (employee_id !== undefined ? employee_id : null) ?? linkedEmp?.id ?? null;
      if (!targetEmployeeId) {
        throw new Error("Cannot set employee code: this user is not linked to an employee record.");
      }
      const { data: clash } = await supabaseAdmin
        .from("employees")
        .select("id")
        .eq("employee_code", code)
        .neq("id", targetEmployeeId)
        .maybeSingle();
      if (clash) throw new Error(`Employee code "${code}" is already in use.`);
      await supabaseAdmin.from("employees").update({ employee_code: code }).eq("id", targetEmployeeId);
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 400,
    });
  }
});
