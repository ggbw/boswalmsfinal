# Boswa — Hikvision Attendance Integration Setup

Mirrors the proven Dunlop process. Data path:

```
Devices → Hik-Connect cloud (boswabwcloud@gmail.com) → VPS agent (hik-api-sync.mjs)
        → ingest-attendance edge function → Supabase → Dashboard
```

The dashboard reads **only** from Supabase (`attendance_records`, grouped by `device_serial`).
It never calls a device or Hik-Connect directly. The appKey/appSecret live **only** on the
VPS in `accounts.json`; the edge function is authenticated by a shared `HIK_SYNC_SECRET`.

Boswa shares the same Contabo box as Dunlop but runs in its **own folder**
(`/opt/hik-sync-boswa`) with its own secret, so the two customers never collide.

## Boswa specifics

| Item | Value |
|---|---|
| Supabase project ref | `flplvvybmzqapklcftbq` |
| Ingest function URL | `https://flplvvybmzqapklcftbq.supabase.co/functions/v1/ingest-attendance` |
| Hik-Connect OpenAPI base | `https://ieu.hikcentralconnect.com` |
| Hik-Connect account | `boswabwcloud@gmail.com` (single account) |
| VPS | Contabo `176.126.87.102` (shared with Dunlop) |
| VPS sync folder | `/opt/hik-sync-boswa/` (separate from Dunlop's `/opt/hik-sync`) |
| VPS log file | `/var/log/hik-api-boswa.log` |
| Repo copy of agent | `scripts/vps/hik-api-sync.mjs` (BASE_DIR set to `/opt/hik-sync-boswa`) |

## Backend status (already in place)

- `ingest-attendance` function: present, byte-identical to the proven Dunlop version.
- DB schema + unique index on `(device_serial, employee_id, punch_at)`: migrations applied.
- Dashboard pages (Live, Raw Punches) read the resulting rows.

Remaining work is standing up the Boswa VPS folder + its secret.

## Setup steps

### 1. Set the edge-function secret
Supabase → project `flplvvybmzqapklcftbq` → Edge Functions → Secrets:
add `HIK_SYNC_SECRET` (use the value generated during setup — same string goes in the
VPS `.env`). Confirm `ingest-attendance` is deployed.
(`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` are auto-injected.)

### 2. Provision the Boswa VPS folder
SSH to the Contabo box, then:
```bash
mkdir -p /opt/hik-sync-boswa
# copy scripts/vps/hik-api-sync.mjs → /opt/hik-sync-boswa/hik-api-sync.mjs
```

### 3. Configure (chmod 600 both files)
- `/opt/hik-sync-boswa/.env` — from `scripts/vps/.env.example`; set `HIK_SYNC_SECRET`
  to the SAME value as step 1.
- `/opt/hik-sync-boswa/accounts.json` — from `scripts/vps/accounts.example.json`;
  the single `"boswa"` entry with the appKey/appSecret for `boswabwcloud@gmail.com`.

### 4. Verify (in order)
```bash
NODE=/root/.nvm/versions/node/v20.20.2/bin/node   # same node as Dunlop
cd /opt/hik-sync-boswa
$NODE hik-api-sync.mjs --list-devices          # serials + online status
$NODE hik-api-sync.mjs --dry-run --today       # fetch + map, don't post
$NODE hik-api-sync.mjs --today                 # live sync of today
$NODE hik-api-sync.mjs 2026-06-01 2026-06-30   # backfill a range (safe to re-run; dedups)
```
Use the SHORT `GF...` serial Hik-Connect reports punches under, not the long
`DS-K1T804AMF...` model string, or the device tab stays at 0 records.

### 5. Cron (separate lines from Dunlop's — note the boswa folder + log)
```cron
*/5 6-20 * * * /root/.nvm/versions/node/v20.20.2/bin/node /opt/hik-sync-boswa/hik-api-sync.mjs --today --quiet >> /var/log/hik-api-boswa.log 2>&1
30 9 * * *     /root/.nvm/versions/node/v20.20.2/bin/node /opt/hik-sync-boswa/hik-api-sync.mjs >> /var/log/hik-api-boswa.log 2>&1
```

### 6. Employee mapping (optional, for payroll linkage)
The dashboard shows names straight from Hik-Connect (`personCode` → `employee_id`,
plus first/last name per punch). To link punches to Boswa LMS employees for payroll,
set `employees.biometric_id` = the person's `personCode`. Not required for the
attendance dashboard to display names.

## Notes carried over from Dunlop

- Set each device's timezone to GMT+02:00 on the LCD.
- Records with no `personCode` are skipped; `--dry-run` names who needs an ID set.
- A Hik-Connect account caps at 100 persons. If Boswa exceeds that later, add a
  second account as another `accounts.json` entry — no code change.
- The `sync_runs` "Last sync" indicator on the Live page stays hidden — this agent
  doesn't post run metadata. Harmless.
