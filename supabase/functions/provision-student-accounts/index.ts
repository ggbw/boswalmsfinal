import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
    const studentIds: string[] | undefined = body.student_ids;

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

    const results: Array<{ student_id: string; name: string; email: string; status: string; error?: string }> = [];

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

      try {
        const { data: newUser, error: createErr } = await adminClient.auth.admin.createUser({
          email,
          password: defaultPassword,
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
