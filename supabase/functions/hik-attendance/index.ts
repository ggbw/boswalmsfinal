// Edge Function: hik-attendance
// Fetches attendance records from Hik-Connect cloud (P2P account login flow).
//
// Request:
//   POST { action: "getAttendance", deviceSerial, startTime, endTime }
//
// Per-device credentials:
//   If the `attendance_devices` row for `deviceSerial` has a non-null `api_key`,
//   it is used as the Bearer token directly (skipping the login step — for
//   devices already provisioned with a long-lived Hik-Connect OpenAPI key).
//   Otherwise the function falls back to logging in with the global
//   HIK_CONNECT_EMAIL / HIK_CONNECT_PASSWORD env vars.
//
// Response:
//   { success: true,  data: [{ employeeNo, personName, transTime, eventType, checkOutTime }] }
//   { success: false, message: string }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const HIK_BASE = "https://ieu.hik-connect.com";

interface AttendanceRequest {
  action: "getAttendance";
  deviceSerial: string;
  startTime: string;
  endTime: string;
}

interface NormalizedRecord {
  employeeNo: string;
  personName: string;
  transTime: string;
  eventType: "checkIn" | "checkOut" | "unknown";
  checkOutTime: string | null;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const fail = (message: string, status = 200) =>
  json({ success: false, message }, status);

// ── Login to Hik-Connect and return a session token ────────────────────────
async function loginToHikConnect(email: string, password: string): Promise<string> {
  const res = await fetch(`${HIK_BASE}/v3/users/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ loginType: "Hik-Connect", account: email, password }),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Hik-Connect login failed (${res.status}): ${text.slice(0, 200)}`);
  }

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      `Hik-Connect returned non-JSON (likely HTML portal). First 200 chars: ${text.slice(0, 200)}`,
    );
  }

  const token =
    (data?.loginSession as Record<string, string> | undefined)?.sessionId ??
    (data?.data as Record<string, string> | undefined)?.accessToken ??
    (data?.accessToken as string | undefined) ??
    "";

  if (!token) throw new Error("No session token in Hik-Connect login response");
  return token;
}

// ── Fetch attendance records from Hik-Connect cloud ────────────────────────
async function fetchAttendance(
  token: string,
  deviceSerial: string,
  startTime: string,
  endTime: string,
): Promise<NormalizedRecord[]> {
  const url =
    `${HIK_BASE}/v1/attendance/records?` +
    `deviceSerial=${encodeURIComponent(deviceSerial)}&` +
    `startTime=${encodeURIComponent(startTime)}&` +
    `endTime=${encodeURIComponent(endTime)}&` +
    `pageNo=1&pageSize=500`;

  const res = await fetch(url, {
    headers: {
      "Authorization": `Bearer ${token}`,
      "X-Access-Token": token,
      "Content-Type": "application/json",
    },
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Attendance fetch failed (${res.status}): ${text.slice(0, 200)}`);
  }

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Attendance endpoint returned non-JSON. First 200 chars: ${text.slice(0, 200)}`);
  }

  const list =
    ((data?.data as Record<string, unknown>)?.list as unknown[]) ??
    (data?.data as unknown[]) ??
    (data?.records as unknown[]) ??
    [];

  return (list as Record<string, unknown>[]).map((r) => {
    const eventTypeRaw = String(r.eventType ?? r.checkType ?? r.type ?? "").toLowerCase();
    let eventType: NormalizedRecord["eventType"] = "unknown";
    if (eventTypeRaw.includes("in"))  eventType = "checkIn";
    else if (eventTypeRaw.includes("out")) eventType = "checkOut";

    return {
      employeeNo:   String(r.employeeNo ?? r.employeeNoString ?? r.personId ?? ""),
      personName:   String(r.personName ?? r.name ?? "Unknown"),
      transTime:    String(r.transTime ?? r.time ?? r.checkInTime ?? ""),
      eventType,
      checkOutTime: (r.checkOutTime as string | null) ?? null,
    };
  });
}

// ── Edge function entry point ──────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return fail("Method not allowed. Use POST.", 405);

  try {
    const body = (await req.json()) as Partial<AttendanceRequest>;
    const { action, deviceSerial, startTime, endTime } = body;

    if (action !== "getAttendance") return fail(`Unknown action: ${action ?? "(none)"}`);
    if (!deviceSerial || !startTime || !endTime) {
      return fail("deviceSerial, startTime and endTime are required");
    }

    // ── 1. Try to load a per-device api_key from the DB ──────────────────
    let token: string | null = null;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const { data: deviceRow } = await supabase
      .from("attendance_devices")
      .select("api_key")
      .eq("device_serial", deviceSerial)
      .maybeSingle();

    if (deviceRow?.api_key) {
      // Device has its own API key — use it directly as a bearer token.
      // This handles Hik-Connect OpenAPI long-lived keys and any devices
      // provisioned with a dedicated account.
      token = deviceRow.api_key;
      console.log(`[hik-attendance] Using per-device api_key for ${deviceSerial}`);
    } else {
      // ── 2. Fall back to global env-var credentials ───────────────────
      const email    = Deno.env.get("HIK_CONNECT_EMAIL");
      const password = Deno.env.get("HIK_CONNECT_PASSWORD");
      if (!email || !password) {
        return fail(
          `No api_key stored for device ${deviceSerial} and HIK_CONNECT_EMAIL / ` +
          `HIK_CONNECT_PASSWORD secrets are not configured. ` +
          `Set the api_key on the device in Devices & Settings, or configure the global secrets.`,
        );
      }
      token = await loginToHikConnect(email, password);
      console.log(`[hik-attendance] Using global credentials for ${deviceSerial}`);
    }

    const data = await fetchAttendance(token, deviceSerial, startTime, endTime);
    return json({ success: true, data });

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("hik-attendance error:", message);
    return fail(message);
  }
});
