// backup-trigger — start a backup workflow from inside the app.
//
// WHY THIS EXISTS
//
// The nightly backup runs on a GitHub Actions runner at 02:15 UTC. Until now
// that was the only way it could ever run: an administrator who had just made a
// large change, or who had watched the job fail three nights running, could do
// nothing from the Backup page but read about it and wait. The page said "check
// the VPS log" to people with no VPS and no shell.
//
// So this function does the one thing the browser cannot: it asks GitHub to run
// the workflow now.
//
// WHY A FUNCTION RATHER THAN A FETCH FROM THE BROWSER
//
// Dispatching a workflow needs a GitHub token with write access to Actions on
// this repository. A token in the browser bundle is a token published to
// everyone who opens the site. It lives here instead, and the only way to reach
// it is with an admin's session JWT.
//
// SECURITY NOTES
//
//   * verify_jwt stays ON (the default). This function is NOT listed in
//     supabase/config.toml, and must not be — that file records at length how
//     turning verify_jwt off for two Hikvision functions left them callable by
//     anyone on the internet.
//   * The JWT gate alone is not enough, because the publishable key is itself a
//     valid JWT and is public. The real gate is the role check below, which
//     resolves the caller and requires admin or super_admin, exactly as
//     db-backup does.
//   * The workflow to run comes from an allowlist. A caller-supplied filename
//     would let any admin run any workflow in the repository.
//
// WHAT IT CANNOT TELL YOU
//
// GitHub's workflow_dispatch endpoint answers 204 with an empty body. There is
// no run id, no URL, nothing to await. The client finds out what happened by
// watching backup_runs for a row it has not seen before; the `status` action
// below covers the gap before the runner has written anything at all.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BASE_ALLOWED_HEADERS = "authorization, x-client-info, apikey, content-type";

function cors(req: Request): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers":
      req.headers.get("access-control-request-headers") ?? BASE_ALLOWED_HEADERS,
    "Access-Control-Max-Age": "86400",
  };
}

const ADMIN_ROLES = ["admin", "super_admin"];

/** Workflows an administrator may start, and the file each one means. Never
 *  take a filename from the caller: this map is the whole authorisation
 *  boundary for *what* gets run. */
const WORKFLOWS: Record<string, string> = {
  "db-backup": "db-backup.yml",
  "db-files-backup": "db-files-backup.yml",
  "db-restore-test": "db-restore-test.yml",
};

/** Which backup_runs kind each workflow writes, for the double-fire guard. */
const WORKFLOW_KIND: Record<string, string> = {
  "db-backup": "cloud",
  "db-files-backup": "files",
  "db-restore-test": "restore_test",
};

/** A run still open and younger than this means one is genuinely in progress. */
const IN_PROGRESS_MINUTES = 30;
/** Two dispatches inside this window are a double-click, not a decision. */
const COOLDOWN_MINUTES = 3;

/** GitHub refuses requests without a User-Agent, with an error that does not
 *  mention User-Agent. */
const GH_HEADERS = (token: string) => ({
  "Accept": "application/vnd.github+json",
  "Authorization": `Bearer ${token}`,
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "boswa-lms-backup-trigger",
});

Deno.serve(async (req: Request) => {
  const corsHeaders = cors(req);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  // Built inside a guard so every exit carries CORS headers — a throw that
  // escapes becomes the runtime's own 500, which has none, and the browser then
  // reports a CORS error while the real message goes unread.
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceKey) {
    return json({
      error: "This function is missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. " +
             "Both are injected automatically — re-deploy the function.",
    }, 500);
  }
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // ── Who is asking ──────────────────────────────────────────────────────────
  let actorLabel = "unknown";
  try {
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const { data: { user: caller }, error: callerError } = await admin.auth.getUser(token);
    if (callerError || !caller) throw new Error("Unauthorized");

    const { data: roles } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", caller.id);
    const held = new Set((roles ?? []).map((r: { role: string }) => r.role));
    if (!ADMIN_ROLES.some((r) => held.has(r))) {
      throw new Error("Only an administrator may start a backup");
    }

    const { data: profile } = await admin
      .from("profiles")
      .select("name, email")
      .eq("user_id", caller.id)
      .maybeSingle();
    actorLabel = `${profile?.name ?? profile?.email ?? caller.email ?? caller.id}`;
  } catch (e) {
    return json({ error: (e as Error).message }, 401);
  }

  // ── Configuration ──────────────────────────────────────────────────────────
  const ghToken = Deno.env.get("GITHUB_DISPATCH_TOKEN") ?? "";
  const repo = Deno.env.get("GITHUB_REPO") ?? "ggbw/boswalmsfinal";
  const ref = Deno.env.get("GITHUB_REF") ?? "main";

  if (!ghToken) {
    return json({
      error:
        "GITHUB_DISPATCH_TOKEN is not set on this function, so the backup cannot be started " +
        "from here. Set it under Supabase → Edge Functions → Secrets (a fine-grained personal " +
        "access token for this repository, with Actions: Read and write). " +
        "Until then, start the run from the repository's Actions tab.",
    }, 503);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? "dispatch");
    const name = String(body?.workflow ?? "db-backup");
    const file = WORKFLOWS[name];
    if (!file) return json({ error: `Unknown workflow: ${name}` }, 400);

    // ── Status: what GitHub thinks is happening ──────────────────────────────
    if (action === "status") {
      const res = await fetch(
        `https://api.github.com/repos/${repo}/actions/workflows/${file}/runs?per_page=5`,
        { headers: GH_HEADERS(ghToken) },
      );
      if (!res.ok) return json({ error: await describeGithubError(res, repo, file, ref) }, 502);
      const data = await res.json();
      return json({
        ok: true,
        runs: (data.workflow_runs ?? []).map((r: Record<string, unknown>) => ({
          id: r.id,
          status: r.status,
          conclusion: r.conclusion,
          created_at: r.created_at,
          html_url: r.html_url,
        })),
      });
    }

    if (action !== "dispatch") return json({ error: `Unknown action: ${action}` }, 400);

    // ── Do not start a second one on top of the first ────────────────────────
    //
    // The workflow's own `concurrency:` group already prevents two runs
    // overlapping — GitHub would simply queue the second. This guard exists so
    // the person is TOLD that, instead of clicking again into silence.
    const kind = WORKFLOW_KIND[name];
    const { data: recent } = await admin
      .from("backup_runs")
      .select("id, status, started_at")
      .eq("kind", kind)
      .order("started_at", { ascending: false })
      .limit(1);

    const last = recent?.[0];
    if (last) {
      const ageMin = (Date.now() - new Date(last.started_at as string).getTime()) / 60_000;
      if (last.status === "running" && ageMin < IN_PROGRESS_MINUTES) {
        return json({
          error: `A backup started ${Math.max(1, Math.round(ageMin))} minute(s) ago and is still ` +
                 `running. Wait for it to finish — starting another would only queue behind it.`,
        }, 409);
      }
      if (ageMin < COOLDOWN_MINUTES) {
        return json({
          error: `A backup was started less than ${COOLDOWN_MINUTES} minutes ago. ` +
                 `Give the runner a moment to report back before starting another.`,
        }, 409);
      }
    }

    // ── Ask GitHub ───────────────────────────────────────────────────────────
    const res = await fetch(
      `https://api.github.com/repos/${repo}/actions/workflows/${file}/dispatches`,
      { method: "POST", headers: { ...GH_HEADERS(ghToken), "Content-Type": "application/json" }, body: JSON.stringify({ ref }) },
    );

    if (res.status !== 204) {
      return json({ error: await describeGithubError(res, repo, file, ref) }, res.status === 404 ? 400 : 502);
    }

    console.log(`backup-trigger: ${actorLabel} dispatched ${file} on ${repo}@${ref}`);

    return json({
      ok: true,
      workflow: file,
      repo,
      ref,
      // A fine-grained PAT expires, and when it does this button starts
      // answering 401 with no other warning. Surfacing the date is the cheapest
      // possible early notice.
      token_expires: res.headers.get("github-authentication-token-expiration"),
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

/**
 * Turn GitHub's status codes into something with a fix in it.
 *
 * GitHub answers 404 both for "this repository does not exist" and for "this
 * token cannot see it" — and, most confusingly here, for "that workflow file is
 * not on the default branch". A workflow that exists only on a laptop, or only
 * on a feature branch, cannot be dispatched at all, and the bare 404 gives no
 * hint of that. It is by far the most likely reason this button fails the first
 * time anyone presses it.
 */
async function describeGithubError(res: Response, repo: string, file: string, ref: string): Promise<string> {
  const detail = await res.text().catch(() => "");
  const brief = detail.slice(0, 200);

  if (res.status === 404) {
    return `GitHub answered 404. Either the token cannot see ${repo}, or ${file} is not on the ` +
           `default branch — a workflow must be committed and pushed to the default branch before ` +
           `it can be triggered, however complete the file is locally.`;
  }
  if (res.status === 401) {
    return `GitHub rejected the token (401). GITHUB_DISPATCH_TOKEN is invalid or has expired — ` +
           `issue a new fine-grained token with Actions: Read and write on ${repo}.`;
  }
  if (res.status === 403) {
    const owner = repo.split("/")[0];
    // "Resource not accessible by personal access token" is GitHub's answer to
    // several quite different mistakes, and the wording points at none of them.
    // The first cause below is the one people lose an afternoon to: a
    // fine-grained token can ONLY reach repositories owned by the account
    // chosen as its resource owner. Being a collaborator on someone else's
    // repository is not enough — no permission setting fixes it, and the only
    // way through is a classic token.
    return `GitHub refused the request (403). Three things cause this, in order of how ` +
           `often they are the answer:\n\n` +
           `1. The token is a fine-grained token that does not belong to "${owner}". ` +
           `Fine-grained tokens can only reach repositories owned by their resource owner, ` +
           `so if you are a collaborator on ${repo} rather than "${owner}" itself, no ` +
           `permission setting will make one work — use a CLASSIC token with the "workflow" ` +
           `scope instead.\n` +
           `2. The token's repository access is "Public repositories (read-only)". Read-only ` +
           `cannot start a workflow. Set it to "Only select repositories" and pick ${repo}.\n` +
           `3. Repository permissions → Actions is missing or set to Read-only. It must be ` +
           `"Read and write".\n\n` +
           `GitHub said: ${brief}`;
  }
  if (res.status === 422) {
    return `GitHub could not use the ref "${ref}" (422). It does not exist on ${repo}, or the ` +
           `workflow has no workflow_dispatch trigger. ${brief}`;
  }
  return `GitHub returned ${res.status}. ${brief}`;
}
