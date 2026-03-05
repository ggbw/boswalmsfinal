import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const results: any[] = [];
    const defaultPassword = "BoswaStaff2026!";

    for (const f of faculty) {
      // Check if user already exists by email
      const { data: existingUsers } = await adminClient.auth.admin.listUsers();
      const exists = existingUsers?.users?.find((u: any) => u.email === f.email);
      if (exists) {
        results.push({ email: f.email, status: "already_exists" });
        continue;
      }

      const { data: newUser, error: createError } = await adminClient.auth.admin.createUser({
        email: f.email,
        password: defaultPassword,
        email_confirm: true,
        user_metadata: { name: f.name },
      });

      if (createError) {
        results.push({ email: f.email, status: "error", message: createError.message });
        continue;
      }

      // Update profile
      await adminClient.from("profiles").update({
        name: f.name, dept: f.dept, code: (f as any).code || null,
      }).eq("user_id", newUser.user.id);

      // Assign role
      await adminClient.from("user_roles").insert({
        user_id: newUser.user.id,
        role: f.role,
      });

      results.push({ email: f.email, status: "created" });
    }

    return new Response(JSON.stringify({ results }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
