import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// The two standard passwords. There are exactly two — one for students, one for
// staff — and every account created with either is flagged
// must_change_password, so the holder replaces it at first sign-in.
//
// ⚠ Admin and super_admin passwords are NEVER changed in bulk. force-password-change
// excludes them unconditionally, so an administrator cannot be locked out by a
// mass reset.
const STUDENT_PASSWORD = "BoswaStudent2026!";
const STAFF_PASSWORD   = "BoswaStaff2026!";
function defaultPasswordFor(role: string | null | undefined): string {
  return role === "student" ? STUDENT_PASSWORD : STAFF_PASSWORD;
}

function generateEmail(name: string, studentId: string): string {
  // Create email from student_id: BCI2023D-01 -> bci2023d01@boswa.ac.bw
  const cleaned = studentId.toLowerCase().replace(/[^a-z0-9]/g, '');
  return `${cleaned}@boswa.ac.bw`;
}

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

    // Verify caller is admin
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: caller } } = await callerClient.auth.getUser();
    if (!caller) {
      // "Unauthorized" told the admin nothing. This branch means the JWT did
      // not resolve to a user — almost always an expired session in a tab that
      // has been open a long time, not a permissions problem.
      return new Response(JSON.stringify({
        error: "Your session is no longer valid — sign out and sign in again, then retry.",
      }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: roleData } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", caller.id)
      .in("role", ["admin", "super_admin"]);

    if (!roleData || roleData.length === 0) {
      // Say what role the caller actually holds. "Only admins can provision accounts"
      // is unactionable when the person believes they ARE an admin — and this
      // system has five roles that look administrative from the inside.
      const { data: actual } = await adminClient
        .from("user_roles").select("role").eq("user_id", caller.id);
      const held = (actual ?? []).map((r: { role: string }) => r.role).join(", ") || "none";
      return new Response(JSON.stringify({
        error: `Your account holds the role: ${held}. Only admin and super_admin may provision accounts. `
             + `Ask a system administrator to perform this, or to grant you the role.`,
      }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const studentIds: string[] | undefined = body.student_ids;
    // body.default_password is ignored — the student password is fixed.

    // Get all students
    let query = adminClient.from("students").select("*");
    if (studentIds && studentIds.length > 0) {
      query = query.in("id", studentIds);
    }
    const { data: students, error: fetchErr } = await query;
    if (fetchErr) {
      return new Response(JSON.stringify({ error: fetchErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get existing profiles to check for already-provisioned students
    const { data: existingProfiles } = await adminClient.from("profiles").select("student_ref, email");
    const existingStudentRefs = new Set((existingProfiles || []).map(p => p.student_ref));

    const results: Array<{
      student_id: string; name: string; email: string; status: string;
      temp_password?: string; error?: string;
    }> = [];

    for (const student of students || []) {
      // Skip if already provisioned
      if (existingStudentRefs.has(student.id)) {
        results.push({ student_id: student.student_id, name: student.name, email: student.email || "", status: "already_exists" });
        continue;
      }

      // Generate email if missing
      let email = student.email?.trim();
      if (!email) {
        email = generateEmail(student.name, student.student_id);
        // Update student record with generated email
        await adminClient.from("students").update({ email }).eq("id", student.id);
      }

      const tempPassword = STUDENT_PASSWORD;

      try {
        const { data: newUser, error: createErr } = await adminClient.auth.admin.createUser({
          email,
          password: tempPassword,
          email_confirm: true,
          user_metadata: { name: student.name },
        });

        if (createErr) {
          if (createErr.message.includes("already been registered")) {
            results.push({ student_id: student.student_id, name: student.name, email, status: "already_exists" });
          } else {
            results.push({ student_id: student.student_id, name: student.name, email, status: "error", error: createErr.message });
          }
          continue;
        }

        // UPSERT, not UPDATE. This used to be an .update() that assumed a
        // database trigger had already created the profile row. When the
        // trigger didn't fire it silently matched zero rows — and the error was
        // never checked — leaving an account with no student_id. Those students
        // could sign in but the app couldn't find their record, so they saw
        // either nothing at all or every other class's data.
        const { error: profErr } = await adminClient.from("profiles").upsert({
          user_id: newUser.user.id,
          name: student.name,
          email,
          student_ref: student.id,
          student_id: student.student_id,
          must_change_password: true,
        }, { onConflict: "user_id" });
        if (profErr) {
          results.push({ student_id: student.student_id, name: student.name, email, status: "error", error: "profile: " + profErr.message });
          continue;
        }

        // Assign the student role. user_roles has UNIQUE(user_id, role) and no
        // single-column unique on user_id, so delete-then-insert is the only
        // safe way to guarantee exactly one row. An account left with no role
        // gets dropped into the applicant portal — which reads to the user as
        // "I can't log in". Surface the failure instead of swallowing it.
        await adminClient.from("user_roles").delete().eq("user_id", newUser.user.id);
        const { error: roleErr } = await adminClient.from("user_roles").insert({
          user_id: newUser.user.id,
          role: "student",
        });
        if (roleErr) {
          results.push({ student_id: student.student_id, name: student.name, email, status: "error", error: "role: " + roleErr.message });
          continue;
        }

        results.push({
          student_id: student.student_id, name: student.name, email,
          status: "created", temp_password: tempPassword,
        });
      } catch (e) {
        results.push({ student_id: student.student_id, name: student.name, email, status: "error", error: e instanceof Error ? e.message : "Unknown error" });
      }
    }

    const created = results.filter(r => r.status === "created").length;
    const existing = results.filter(r => r.status === "already_exists").length;
    const errors = results.filter(r => r.status === "error").length;

    return new Response(JSON.stringify({ results, summary: { created, existing, errors } }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
