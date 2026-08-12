import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Unique single-use temporary password, matching create-user and
// provision-student-accounts. Replaces the shared "BoswaStaff2026!".
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

const faculty = [
  { email: "malcom@boswa.ac.bw", name: "Malcom", role: "hoy", dept: "Admin & Operations" },
  { email: "bonang@boswa.ac.bw", name: "Bonang Keabetswe", role: "hod", dept: "Culinary & Hospitality" },
  { email: "poneso@boswa.ac.bw", name: "Poneso Kgakge", role: "lecturer", dept: "Culinary Practicals", code: "004" },
  { email: "nthoyapelo@boswa.ac.bw", name: "Nthoyapelo Senatla", role: "lecturer", dept: "Culinary Practicals", code: "006" },
  { email: "sekgele@boswa.ac.bw", name: "Sekgele Mono", role: "lecturer", dept: "Culinary Practicals", code: "005" },
  { email: "neo@boswa.ac.bw", name: "Neo Medupe", role: "lecturer", dept: "Culinary & Hospitality", code: "008" },
  { email: "tshepang@boswa.ac.bw", name: "Tshepang Utlwang", role: "lecturer", dept: "Culinary & Hospitality", code: "007" },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // This function had NO caller check at all — any signed-in user, including a
    // student, could invoke it and create staff accounts. Match the guard the
    // other admin functions use.
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No authorization header" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: caller } } = await callerClient.auth.getUser();
    if (!caller) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: callerRoles } = await adminClient
      .from("user_roles").select("role").eq("user_id", caller.id)
      .in("role", ["admin", "super_admin"]);
    if (!callerRoles || callerRoles.length === 0) {
      return new Response(JSON.stringify({ error: "Only admins can seed faculty accounts" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results: any[] = [];

    for (const f of faculty) {
      // Check if user already exists by email
      const { data: existingUsers } = await adminClient.auth.admin.listUsers();
      const exists = existingUsers?.users?.find((u: any) => u.email === f.email);
      if (exists) {
        results.push({ email: f.email, status: "already_exists" });
        continue;
      }

      const tempPassword = generatePassword();

      const { data: newUser, error: createError } = await adminClient.auth.admin.createUser({
        email: f.email,
        password: tempPassword,
        email_confirm: true,
        user_metadata: { name: f.name },
      });

      if (createError) {
        results.push({ email: f.email, status: "error", message: createError.message });
        continue;
      }

      // Upsert, not update: an .update() silently matches zero rows when the
      // profile-creation trigger hasn't fired, leaving a login with no profile —
      // which bounces the user straight back to the sign-in screen.
      const { error: profErr } = await adminClient.from("profiles").upsert({
        user_id: newUser.user.id,
        name: f.name, email: f.email, dept: f.dept, code: (f as any).code || null,
        must_change_password: true,
      }, { onConflict: "user_id" });
      if (profErr) {
        results.push({ email: f.email, status: "error", message: "profile: " + profErr.message });
        continue;
      }

      // Exactly one role row; surface the failure rather than swallowing it.
      await adminClient.from("user_roles").delete().eq("user_id", newUser.user.id);
      const { error: roleErr } = await adminClient.from("user_roles").insert({
        user_id: newUser.user.id,
        role: f.role,
      });
      if (roleErr) {
        results.push({ email: f.email, status: "error", message: "role: " + roleErr.message });
        continue;
      }

      results.push({ email: f.email, name: f.name, status: "created", temp_password: tempPassword });
    }

    return new Response(JSON.stringify({ results }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
