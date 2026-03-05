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
    const anonKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;

    // Verify caller is admin
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
    const { data: roleData } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", caller.id)
      .eq("role", "admin")
      .single();

    if (!roleData) {
      return new Response(JSON.stringify({ error: "Only admins can provision accounts" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const defaultPassword = body.default_password || "BoswaStudent2026!";
    // Optional: provision only specific student IDs
    const studentIds: string[] | undefined = body.student_ids;

    // Get all students with emails
    let query = adminClient.from("students").select("*").not("email", "is", null).neq("email", "");
    if (studentIds && studentIds.length > 0) {
      query = query.in("id", studentIds);
    }
    const { data: students, error: fetchErr } = await query;
    if (fetchErr) {
      return new Response(JSON.stringify({ error: fetchErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get existing profiles to find which students already have accounts
    const { data: existingProfiles } = await adminClient.from("profiles").select("student_ref, email");
    const existingEmails = new Set((existingProfiles || []).map(p => p.email?.toLowerCase()));
    const existingStudentRefs = new Set((existingProfiles || []).map(p => p.student_ref));

    const results: Array<{ student_id: string; name: string; email: string; status: string; error?: string }> = [];

    for (const student of students || []) {
      if (!student.email) {
        results.push({ student_id: student.student_id, name: student.name, email: "", status: "skipped_no_email" });
        continue;
      }

      const email = student.email.toLowerCase().trim();

      // Skip if already has an account
      if (existingEmails.has(email) || existingStudentRefs.has(student.id)) {
        results.push({ student_id: student.student_id, name: student.name, email, status: "already_exists" });
        continue;
      }

      try {
        // Create auth user
        const { data: newUser, error: createErr } = await adminClient.auth.admin.createUser({
          email,
          password: defaultPassword,
          email_confirm: true,
          user_metadata: { name: student.name },
        });

        if (createErr) {
          // If user already exists in auth, try to link
          if (createErr.message.includes("already been registered")) {
            results.push({ student_id: student.student_id, name: student.name, email, status: "already_exists" });
          } else {
            results.push({ student_id: student.student_id, name: student.name, email, status: "error", error: createErr.message });
          }
          continue;
        }

        // Update profile with student reference
        await adminClient.from("profiles").update({
          name: student.name,
          student_ref: student.id,
          student_id: student.student_id,
        }).eq("user_id", newUser.user.id);

        // Assign student role
        await adminClient.from("user_roles").insert({
          user_id: newUser.user.id,
          role: "student",
        });

        results.push({ student_id: student.student_id, name: student.name, email, status: "created" });
      } catch (e) {
        results.push({ student_id: student.student_id, name: student.name, email, status: "error", error: e.message });
      }
    }

    const created = results.filter(r => r.status === "created").length;
    const existing = results.filter(r => r.status === "already_exists").length;
    const errors = results.filter(r => r.status === "error").length;
    const skipped = results.filter(r => r.status === "skipped_no_email").length;

    return new Response(JSON.stringify({ results, summary: { created, existing, errors, skipped } }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
