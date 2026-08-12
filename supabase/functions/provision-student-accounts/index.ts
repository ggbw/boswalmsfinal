import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Unique single-use temporary password, one per student. Replaces the shared
// "BoswaStudent2026!" every student account used to get — since emails are
// derived from student numbers, a shared password meant any student who knew
// the pattern could sign in as any other. Ambiguous characters (0/O, 1/l/I) are
// excluded so it survives being printed and typed.
const PWD_ALPHABET =
  "ABCDEFGHJKLMNPQRSTUVWXYZ" + "abcdefghijkmnpqrstuvwxyz" + "23456789"; // 56 chars
function generatePassword(groups = 3, size = 4): string {
  const limit = 256 - (256 % PWD_ALPHABET.length); // reject above this to avoid modulo bias
  const chars: string[] = [];
  const buf = new Uint8Array(1);
  while (chars.length < groups * size) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) chars.push(PWD_ALPHABET[buf[0] % PWD_ALPHABET.length]);
  }
  return Array.from({ length: groups }, (_, g) =>
    chars.slice(g * size, (g + 1) * size).join("")
  ).join("-");
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
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
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
      return new Response(JSON.stringify({ error: "Only admins can provision accounts" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const studentIds: string[] | undefined = body.student_ids;
    // NOTE: body.default_password is deliberately ignored. Every account now
    // gets its own generated password; there is no shared default any more.

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

      const tempPassword = generatePassword();

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
