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
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Check if admin already exists
    const { data: existingUsers } = await adminClient.auth.admin.listUsers();
    const adminExists = existingUsers?.users?.some(u => u.email === "admin@boswa.ac.bw");
    
    if (adminExists) {
      return new Response(JSON.stringify({ message: "Admin already exists" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create admin user
    const { data: newUser, error } = await adminClient.auth.admin.createUser({
      email: "admin@boswa.ac.bw",
      password: "BoswaAdmin2026!",
      email_confirm: true,
      user_metadata: { name: "Admin Julia" },
    });

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Update profile
    await adminClient.from("profiles").update({
      name: "Admin Julia", dept: "ADM",
    }).eq("user_id", newUser.user.id);

    // Assign admin role
    await adminClient.from("user_roles").insert({
      user_id: newUser.user.id, role: "admin",
    });

    return new Response(JSON.stringify({ message: "Admin created successfully", userId: newUser.user.id }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
