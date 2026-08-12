import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Unique single-use temporary password. Replaces the shared "BoswaStaff2026!"
// every account used to get. Ambiguous characters (0/O, 1/l/I) are excluded so
// it can be read off a printout and typed without confusion.
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

// auth.admin.listUsers() returns a single page (default 50 users). Walking every
// page makes "find the existing user" reliable no matter how many accounts exist —
// without this, re-adding an email belonging to an older account fails with a
// false "User exists but could not be found".
async function findUserByEmail(adminClient: any, email: string) {
  const target = email.toLowerCase();
  for (let page = 1; page <= 100; page++) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage: 200 });
    if (error) return null;
    const users = data?.users ?? [];
    if (users.length === 0) return null;
    const found = users.find((u: any) => (u.email || "").toLowerCase() === target);
    if (found) return found;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Verify the caller is an admin
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No authorization header" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Verify caller is admin using their token
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: caller } } = await callerClient.auth.getUser();
    if (!caller) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check admin role using service role client
    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: roleData } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", caller.id)
      .in("role", ["admin", "super_admin"]);

    if (!roleData || roleData.length === 0) {
      return new Response(JSON.stringify({ error: "Only admins can create users" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const {
      email, password, name, role, dept, code, student_ref, student_id,
      must_change_password = true,
    } = await req.json();

    if (!email || !name || !role) {
      return new Response(JSON.stringify({ error: "Missing required fields: email, name, role" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // `password` is now optional. When the caller doesn't supply one we mint a
    // unique temporary password and return it, so no two accounts ever share
    // the same starting credential.
    const tempPassword: string = password || generatePassword();

    // Try to create the user with service role
    const { data: newUser, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { name },
    });

    let userId: string;
    // Whether tempPassword is actually this account's password. False when the
    // account already existed — we deliberately do NOT reset a working login.
    let passwordApplied = true;

    if (createError) {
      // If user already exists, find them and update instead
      if (createError.message.includes("already been registered")) {
        const existing = await findUserByEmail(adminClient, email);
        if (!existing) {
          return new Response(JSON.stringify({ error: "User exists but could not be found" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        userId = existing.id;
        passwordApplied = false;
      } else {
        return new Response(JSON.stringify({ error: createError.message }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } else {
      userId = newUser.user.id;
    }

    // Upsert profile (in case trigger already created it)
    // must_change_password drives the blocking first-login screen
    // (ForcePasswordChange, mounted in AppLayout). It was never being set here,
    // which is why LMS accounts were never asked to change their password.
    const { error: profileErr } = await adminClient.from("profiles").upsert({
      user_id: userId,
      name, dept: dept || null, code: code || null,
      email, student_ref: student_ref || null, student_id: student_id || null,
      must_change_password: passwordApplied ? must_change_password : undefined,
    }, { onConflict: "user_id" });
    if (profileErr) throw profileErr;

    // Set the role. NOTE: user_roles has a UNIQUE(user_id, role) constraint —
    // there is NO single-column unique on user_id — so an upsert with
    // onConflict:"user_id" fails (and, previously, that error was swallowed,
    // leaving the account with no role → dumped into the applicant portal =
    // "cannot log in"). Delete any existing rows then insert exactly one,
    // and surface the error so creation actually fails if the role can't be set.
    await adminClient.from("user_roles").delete().eq("user_id", userId);
    const { error: roleErr } = await adminClient.from("user_roles").insert({ user_id: userId, role });
    if (roleErr) throw roleErr;

    return new Response(JSON.stringify({
      user: { id: userId, email },
      // The admin has to be able to hand this to the person. It is single-use:
      // must_change_password forces a reset at first login.
      temp_password: passwordApplied ? tempPassword : null,
      password_applied: passwordApplied,
      must_change_password: passwordApplied ? must_change_password : null,
    }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
