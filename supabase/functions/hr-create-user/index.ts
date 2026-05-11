// HR-specific user creation (separate from existing academic create-user
// edge function which handles student/lecturer onboarding). This one
// creates an auth user, links them to an employees row, sets the role
// from the HR enum (admin/hr/manager/employee/super_admin), and accepts
// HR-only fields (employee_code, username, must_change_password).
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
    if (!ADMIN_ROLES.some((r) => callerRoleSet.has(r))) throw new Error("Insufficient permissions");

    const {
      email,
      password,
      role,
      full_name,
      employee_code,
      username,
      must_change_password = true,
    } = await req.json();

    if (!password) throw new Error("password is required");
    const targetRole = role ?? "employee";

    const code = (employee_code ?? "user").toString().trim().toLowerCase();
    const authEmail = (email?.toString().trim()) || `${code}@boswalms.internal`;

    const { data, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: authEmail,
      password,
      email_confirm: true,
      user_metadata: { role: targetRole, full_name: full_name ?? "" },
    });

    let userId: string;
    if (createError) {
      const msg = (createError.message ?? "").toLowerCase();
      const looksLikeDuplicate =
        msg.includes("already registered") ||
        msg.includes("already been registered") ||
        msg.includes("already exists");
      if (!looksLikeDuplicate) throw createError;

      let existing: { id: string; email?: string | null } | null = null;
      for (let page = 1; page <= 50; page++) {
        const { data: list } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
        const users = list?.users ?? [];
        const hit = users.find((u: { email?: string | null }) =>
          (u.email ?? "").toLowerCase() === authEmail.toLowerCase()
        );
        if (hit) { existing = hit; break; }
        if (users.length < 200) break;
      }
      if (!existing) throw createError;

      const { data: existingProfile } = await supabaseAdmin
        .from("profiles")
        .select("id")
        .eq("user_id", existing.id)
        .maybeSingle();
      if (existingProfile) throw createError;

      const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(existing.id, {
        password,
        email_confirm: true,
        user_metadata: { role: targetRole, full_name: full_name ?? "" },
      });
      if (updErr) throw updErr;
      userId = existing.id;
    } else {
      userId = data.user!.id;
    }

    let employeeUuid: string | null = null;
    if (employee_code) {
      const codeUpper = employee_code.toString().trim().toUpperCase();
      const { data: emp } = await supabaseAdmin
        .from("employees")
        .select("id")
        .eq("employee_code", codeUpper)
        .maybeSingle();
      if (emp) {
        employeeUuid = emp.id;
        await supabaseAdmin.from("employees").update({ auth_user_id: userId }).eq("id", emp.id);
      }
    }

    await supabaseAdmin.from("profiles").upsert(
      {
        user_id: userId,
        name: full_name ?? authEmail,
        email: authEmail,
        username: username ?? null,
        must_change_password,
      },
      { onConflict: "user_id" },
    );

    await supabaseAdmin.from("user_roles").delete().eq("user_id", userId);
    const { error: roleErr } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: userId, role: targetRole });
    if (roleErr) throw roleErr;

    return new Response(
      JSON.stringify({
        success: true,
        user_id: userId,
        employee_id: employeeUuid,
        email: authEmail,
        username: username ?? null,
        employee_linked: employeeUuid !== null,
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
