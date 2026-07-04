# Boswa — Hikvision Attendance System
## Customer Reference Handover

**Customer:** Boswa
**Maintained by:** Automate Africa
**Document version:** 1.0 (04 July 2026)
**Status:** Production — 1 device live on 1 Hik-Connect account, live OpenAPI capture

---

## 1. System overview

Boswa uses a Hikvision biometric terminal (face + card + fingerprint) that captures
punches **live** via the Hik-Connect **OpenAPI**. A VPS agent polls every 5 minutes and
writes into a Supabase database, shown on a React dashboard.

```
Device → Hik-Connect cloud (per account) → VPS agent (Contabo) → ingest-attendance edge function → Supabase → Dashboard
```

The dashboard pulls **only** from Supabase; it never calls a device or Hik-Connect
directly. Boswa runs the same proven agent as Dunlop, on the same VPS, but in its **own
isolated folder** (`/opt/hik-sync-boswa`) with its own secret, logs and token cache — the
two customers never share state.

---

## 2. Account architecture

**A Hik-Connect account caps at 100 registered persons.** Boswa is currently within that
limit on a single account. If headcount ever exceeds 100, split across additional accounts
(each with its own OpenAPI key/secret) and add one `accounts.json` entry per account — no
code change (see §10).

**Current account:**

| Config name | Hik-Connect login | Role | Devices |
|---|---|---|---|
| `boswa` | `boswabwcloud@gmail.com` | Primary account | Boswa (`FZ0594881`) |

The dashboard groups by `device_serial` (unique per device), so if more accounts/devices
are added later, person-ID reuse across accounts never collides.

---

## 3. Current devices (as of 04 July 2026)

| Branch | Device Name | Serial (short form) | Account | Status |
|---|---|---|---|---|
| Boswa | Boswa | `FZ0594881` | boswa | Live |

> The dashboard tab name follows the device name from its account — the ingest function
> overwrites `device_name` on every sync. To rename the tab, rename the device in
> Hik-Connect.

**Serial format reminder:** Always use the SHORT serial Hik-Connect reports punches under
(here `FZ0594881`, visible in the OpenAPI device list and the Transaction/Attendance tab),
NOT the long `DS-K1T...` model string on the Device page. A serial mismatch shows a
0-record tab forever.

---

## 4. Key URLs and identifiers

| Item | Value |
|---|---|
| Dashboard | Boswa LMS → HR → Attendance (Live Dashboard / Raw Punches / Report) |
| Supabase project ref | `flplvvybmzqapklcftbq` |
| Supabase URL | `https://flplvvybmzqapklcftbq.supabase.co` |
| Edge Function (ingest) | `ingest-attendance` |
| Ingest function URL | `https://flplvvybmzqapklcftbq.supabase.co/functions/v1/ingest-attendance` |
| Hik-Connect OpenAPI base | `https://ieu.hikcentralconnect.com` |
| VPS | `176.126.87.102` (Contabo, host `vmi2982250`) — shared with Dunlop |
| VPS sync folder | `/opt/hik-sync-boswa/` (Dunlop is `/opt/hik-sync`) |
| VPS sync script | `/opt/hik-sync-boswa/hik-api-sync.mjs` |
| VPS node binary | `/root/.nvm/versions/node/v20.20.2/bin/node` |
| VPS log file | `/var/log/hik-api-boswa.log` |
| Repo copy of sync script | `scripts/vps/hik-api-sync.mjs` (BASE_DIR = `/opt/hik-sync-boswa`) |
| Repo runbook | `docs/hikvision-attendance-setup.md` |

---

## 5. Credentials — where they live (never store values here)

| Credential | Where it's stored | How to access |
|---|---|---|
| Hik-Connect account password | Password manager | Project owner |
| OpenAPI API Key + Secret (`boswa`) | VPS `/opt/hik-sync-boswa/accounts.json` (chmod 600) | SSH to VPS |
| `HIK_SYNC_SECRET` (pre-shared) | VPS `/opt/hik-sync-boswa/.env` + Supabase Edge Function secret | Both must match |
| `LOVABLE_FUNCTION_URL`, `TZ_OFFSET` | VPS `/opt/hik-sync-boswa/.env` | SSH to VPS |
| Supabase service role key | Supabase → Edge Functions → Secrets (auto-injected) | Supabase admins |
| VPS SSH access | Project owner | Owner only |

Do not paste credential values in this document, in chat, or in screenshots.

---

## 6. VPS file layout (`/opt/hik-sync-boswa/`)

| File | Purpose |
|---|---|
| `hik-api-sync.mjs` | The sync agent (BASE_DIR pinned to this folder) |
| `.env` | Config: `LOVABLE_FUNCTION_URL`, `HIK_SYNC_SECRET`, `TZ_OFFSET=+02:00` |
| `accounts.json` | `[{ name, apiKey, apiSecret, enabled }]` — the `boswa` account (chmod 600) |
| `.hik-token-boswa.json` | Cached OpenAPI token (~7-day life) |
| `.hik-devices-boswa.json` | Cached device list (1-hour life) |
| `.hik-api-sync.lock` | Run lock (auto-released on exit) |

`accounts.json` shape (values redacted):
```json
[
  { "name": "boswa", "apiKey": "<key>", "apiSecret": "<secret>", "enabled": true }
]
```
JSON string values MUST be double-quoted, or the agent reports
`No enabled accounts found` and syncs nothing.

---

## 7. Cron schedule on VPS

Boswa's lines (Dunlop's separate lines for `/opt/hik-sync` are left untouched):
```cron
# Every 5 min during working hours: sync today's records
*/5 6-20 * * * /root/.nvm/versions/node/v20.20.2/bin/node /opt/hik-sync-boswa/hik-api-sync.mjs --today --quiet >> /var/log/hik-api-boswa.log 2>&1

# Daily 7-day backfill at 09:30 (catches anything the 5-min sync missed)
30 9 * * *     /root/.nvm/versions/node/v20.20.2/bin/node /opt/hik-sync-boswa/hik-api-sync.mjs >> /var/log/hik-api-boswa.log 2>&1
```
Optional parity with Dunlop — daily token-cache reset (belt-and-suspenders; the agent
already self-heals token errors in code):
```cron
0 5 * * * rm -f /opt/hik-sync-boswa/.hik-token-boswa.json
```
Verify with:
```bash
crontab -l | grep hik-sync-boswa
```

---

## 8. Common operations

Set the node path once per session:
```bash
NODE=/root/.nvm/versions/node/v20.20.2/bin/node
cd /opt/hik-sync-boswa
```

| Task | Command |
|---|---|
| List devices | `$NODE hik-api-sync.mjs --list-devices` |
| Sync today | `$NODE hik-api-sync.mjs --today` |
| Sync a single day | `$NODE hik-api-sync.mjs 2026-07-03` |
| Backfill a date range | `$NODE hik-api-sync.mjs 2026-06-01 2026-06-30` |
| Bypass device cache | add `--force-device-refresh` |
| Preview without posting | add `--dry-run` |

Re-running any range is safe — the ingest dedups on
`(device_serial, employee_id, punch_at)`.

---

## 9. Adding a NEW DEVICE (existing `boswa` account)

1. Physically install; set device timezone on the LCD to GMT+02:00; note the short serial.
2. Add it to the `boswabwcloud@gmail.com` account (must have room under the 100-person cap);
   wait for online status.
3. In Hik-Connect, grant access / assign departments.
4. Refresh the device cache so the agent discovers it:
   ```bash
   rm -f /opt/hik-sync-boswa/.hik-devices-boswa.json
   $NODE hik-api-sync.mjs --list-devices     # confirm the serial appears
   ```
5. Backfill its history (see §11), then verify on the dashboard within ~5 minutes.

You do **not** need to insert a row into Supabase — the ingest function auto-registers any
device the agent sends punches for.

---

## 10. Adding a NEW ACCOUNT (when the account hits the 100-person cap)

1. Create a new Hik-Connect account; enrol the overflow people and add their device(s).
2. In that account, generate an **OpenAPI API Key + Secret**.
3. Append one block to `/opt/hik-sync-boswa/accounts.json`:
   ```json
   { "name": "boswa-two", "apiKey": "<key>", "apiSecret": "<secret>", "enabled": true }
   ```
4. Verify and backfill:
   ```bash
   $NODE hik-api-sync.mjs --list-devices --account=boswa-two
   $NODE hik-api-sync.mjs --account=boswa-two <start-date> <end-date>
   ```
The 5-min cron now includes the new account automatically — no new folders or cron lines.

---

## 11. Backfilling history

```bash
$NODE hik-api-sync.mjs <start-date> <end-date>
```
Dedups on `(device_serial, employee_id, punch_at)`, so it's safe to re-run.
This API path writes **second** precision with `data_source='hik-openapi'`.

---

## 12. Troubleshooting playbook (in order of likelihood)

1. **Device shows 0 / not syncing** — is the serial listed?
   ```bash
   $NODE hik-api-sync.mjs --list-devices
   ```
   - Not listed → device is offline, on a different account, or its key is wrong.
   - Listed but no data → likely no punches (check the Hik-Connect Transaction/Attendance
     tab), or a mapping skip (run `--dry-run` and read the "skip reason" lines, e.g.
     `missing personCode — <name>` = that person needs a Person ID set in Hik-Connect).
2. **VPS log:** `tail -40 /var/log/hik-api-boswa.log` — is the latest run healthy?
3. **`No enabled accounts found`** → `accounts.json` is invalid JSON (unquoted values) or
   `enabled` is false. Validate:
   ```bash
   $NODE -e "console.log(JSON.parse(require('fs').readFileSync('/opt/hik-sync-boswa/accounts.json','utf8')).length + ' account(s) OK')"
   ```
4. **`Server misconfiguration` (HTTP 500) from ingest** → `HIK_SYNC_SECRET` not set on the
   Supabase function. **`Unauthorized` (HTTP 401)** → the secret is set but doesn't match the
   VPS `.env`. Fix so both sides are identical.
5. **HTTP 404 from ingest** → `ingest-attendance` not deployed to `flplvvybmzqapklcftbq`.
6. **Hik-Connect portal → Attendance/Transaction tab** → is Hik-Connect itself receiving
   punches?
7. **Supabase SQL:**
   ```sql
   SELECT punch_date, COUNT(*), MAX(imported_at) AS last_import
   FROM attendance_records
   WHERE punch_date >= CURRENT_DATE - INTERVAL '3 days'
   GROUP BY punch_date ORDER BY punch_date DESC;
   ```

---

## 13. Setup / event history

| Date | What |
|---|---|
| 04 Jul 2026 | Boswa integration stood up: agent deployed to `/opt/hik-sync-boswa`, account `boswa` authenticated, device `FZ0594881` discovered, first sync (2 records for 02–03 Jul) succeeded, dedup verified, cron installed. |

Known Dunlop failure modes to watch for (same codebase, so the same fixes apply):
- Missing `personCode` silently drops a person's punches — `--dry-run` names who needs an ID.
- A token can be invalidated before its 7-day expiry (`TOKEN_NOT_FOUND {OPEN000006}`); the
  agent self-heals by clearing the cache and retrying once.
- Always use the short serial, never the long model string.
- After a frontend deploy, verify any new migration actually ran against the live DB.

---

## 14. Timezone note

The OpenAPI device list reports a `timeZone` code (Boswa shows `tz=46`). This is only the
device's configured zone label — the agent always converts from the UTC `recordTime` field
using a fixed +02:00 (Botswana, no DST), so the `tz` code does **not** affect stored punch
times. Confirmed correct at setup: `recordTime 2026-07-03T03:56:51Z` → stored
`05:56:51+02:00`, matching the portal. No action unless punch times look shifted, in which
case check the device clock on-site.

---

## 15. Outstanding / optional items

- **Rotate secrets:** the `boswa` OpenAPI key/secret and `HIK_SYNC_SECRET` were entered
  during a support session. Rotate when convenient — update the VPS `accounts.json` /
  `.env` and the matching Supabase Edge Function secret together so they stay in sync; run
  `history -c` on the VPS.
- **Token-reset parity line** (§7) — optional; the agent already self-heals.
- **Employee mapping:** set `employees.biometric_id` = each person's `personCode` (e.g.
  `0007`) only if you want punches linked to Boswa LMS employees for payroll. The
  attendance dashboard already shows names from Hik-Connect without it.
- **`sync_runs` table:** not created for Boswa, so the Live Dashboard "Last sync" indicator
  stays hidden (harmless). Add the table + `runMetadata` posting later if you want it.

---

## 16. Customer contact + handover

- **Primary customer contact:** [to fill in]
- **Boswa Hik-Connect administrator(s):** [who enrols people / manages the account]
- **Dashboard access:** [Boswa LMS URL + staff accounts]

The integration is operated end-to-end by Automate Africa; the customer interacts only with
the dashboard and (optionally) Hik-Connect for enrolment.

---

## 17. Maintenance

Update this document whenever:
- A device is added/removed (update §3).
- A new Hik-Connect account is created for headcount overflow (update §2 and `accounts.json`).
- A new failure mode is hit (add to §13).
- Credentials are rotated.

---

## End of Boswa reference (v1.0)
