# Boswa LMS — Backup & Restore

**Maintained by:** Automate Africa
**Document version:** 1.0 (24 August 2026)
**Applies to:** Supabase project `gmdbrgjxdeztgzvqsaaj`, VPS `176.126.87.102`

---

## 1. What was built, and why there are two of them

Two features, deliberately different, because they answer different disasters.

| | **Local backup (USB)** | **Cloud backup (Google Drive)** |
|---|---|---|
| Triggered by | An admin, clicking a button | cron, 02:15 every night |
| Produces | `boswa-backup-2026-08-24-1830.ndjson.gz` | `boswa-db-2026-08-24.dump` (+ counts sidecar) |
| Contains | Every **row** of every table | Every row **and the schema** — tables, types, constraints, indexes, functions, RLS policies, sequences |
| Restores into | A database whose tables already exist | An empty PostgreSQL / a fresh Supabase project |
| Lives | On a stick, in someone's hand | Google Drive, 30 daily + 12 monthly |
| Answers | "Someone deleted the 2025 intake." "Show the auditor an offline copy." "The internet is out and we need the data." | "The Supabase project is gone." "The account was closed." "We are moving provider." |

Neither is sufficient alone. The USB snapshot cannot rebuild a database from
nothing; the nightly dump is not in the building when the internet is down.
**Both are wired to the same history table**, so the Backup page shows one
honest answer to "how old is our newest good copy".

### The thing that makes it a backup system rather than a backup script

Every night the job reports its outcome — success *or* failure — into
`backup_runs`. The Backup page turns **red** when the newest successful cloud
backup is more than 36 hours old. Once a week, a second job downloads the
newest dump **back out of Google Drive**, restores it into a scratch database,
and compares the row count of all 66 tables against the counts recorded when
the dump was taken. That is what puts *"Last verified restore"* on the page.

A cron job that fails silently is worse than no cron job: it manufactures
confidence. This one cannot fail silently.

---

## 2. Architecture

```
                    ┌──────────────────── ONE-CLICK, ON DEMAND ────────────────────┐
                    │                                                              │
   Admin's browser ──► db-backup (edge fn, service role) ──► NDJSON stream ──► gzip ──► USB stick
        │                        │                                                       │
        │                        └── opens a backup_runs row                             │
        └── closes it 'success' once the bytes are on disk, with the SHA-256 ◄───────────┘


                    ┌──────────────────── NIGHTLY, AUTOMATIC ──────────────────────┐
                    │                                                              │
   cron 02:15 ──► db-backup.mjs ──► pg_dump ──► gpg ──► rclone ──► Google Drive/daily
      (VPS)            │                                     └────► Supabase Storage (db-backups, 7 days)
                       └──► backup-report (edge fn, shared secret) ──► backup_runs

   cron Sun 03:30 ──► db-restore-test.mjs ──► rclone (download) ──► scratch Postgres on the VPS
                              └──► compares 66 row counts ──► backup-report ──► backup_runs

                                          ▼
                              LMS ▸ Backup & Restore page
                        "Last successful cloud backup: 7 hours ago"
```

**The VPS never holds the Supabase service role key.** It holds a shared secret
that can do exactly three things through `backup-report`: open a history row,
get a ten-minute upload URL for one named object, close the history row. Same
pattern as the existing `ingest-attendance` function.

---

## 3. What is in the repository

| File | Purpose |
|---|---|
| `supabase/migrations/20260824120000_backup_and_restore.sql` | `backup_runs`, `backup_table_order()`, `backup_row_counts()`, `backup_table_columns()`, `backup_clear_table()`, `record_backup_run()`, `backup_health()`, the private `db-backups` bucket |
| `supabase/functions/db-backup/index.ts` | Streams the whole database as NDJSON. Admin + super_admin. |
| `supabase/functions/db-restore/index.ts` | Inspect / clear / apply / finish. **super_admin only.** |
| `supabase/functions/backup-report/index.ts` | The VPS's only door in. Shared secret, `verify_jwt = false`. |
| `src/lib/backup.ts` | Browser half: stream to disk, verify, restore, history. |
| `src/lib/sha256.ts` | Incremental SHA-256 (WebCrypto cannot hash a stream). |
| `src/test/sha256.test.ts` | FIPS 180-4 vectors + chunk-boundary cases. |
| `src/pages/BackupPage.tsx` | The four-tab UI. |
| `scripts/vps/db-backup.mjs` | Nightly pg_dump → Drive. |
| `scripts/vps/db-restore-test.mjs` | Weekly restore-and-verify. |
| `scripts/vps/db-backup.env.example` | Template for `/opt/db-backup-boswa/.env`. |
| `scripts/apply-migration.mjs` | Applies one SQL file via the Management API and verifies the result. Exists because the dashboard editor rolls a whole script back on one failed statement. |
| `scripts/deploy-functions.mjs` | Deploys the edge functions and then probes each one. Exists because an undeployed function reaches the browser as a CORS error, not a 404. |
| `docs/BACKUP_INSTALL.md` | The install checklist, with every failure mode. |
| `docs/BACKUP_GITHUB_ACTIONS.md` | The serverless alternative to the VPS for the nightly job. |
| `.github/workflows/db-backup.yml` | Nightly pg_dump to Drive, on GitHub's runners. |
| `.github/workflows/db-restore-test.yml` | Weekly restore drill against a throwaway PostgreSQL 17 service container. |

Wiring: `src/components/AppLayout.tsx` (page map + `ROLE_PAGES`) and
`src/components/Sidebar.tsx` (Management → Backup & Restore).

---

## 4. Step 1 — Apply the migration

> **Installing for the first time?** Follow
> [`BACKUP_INSTALL.md`](./BACKUP_INSTALL.md) instead — it is the same steps with
> the failure modes spelled out, and it uses `scripts/apply-migration.mjs`,
> which prints the real Postgres error rather than letting the dashboard roll
> the migration back quietly. Come back here for how the thing works.

> ⚠️ `supabase/config.toml` warns against `supabase db push` on this project:
> the 72 existing migration files were never registered with the CLI, and a
> push would try to replay all of them against a populated database. **Apply
> this one migration by hand.**

1. Open **Supabase → SQL Editor → New query**.
2. Paste the whole of
   `supabase/migrations/20260824120000_backup_and_restore.sql`.
3. **Run**. It is idempotent (`CREATE OR REPLACE`, `IF NOT EXISTS`,
   `DROP POLICY IF EXISTS`), so re-running it is safe.
4. The last statement is `NOTIFY pgrst, 'reload schema';`. **This matters.**
   PostgREST serves the API from a cached picture of the schema, and until it
   reloads, every call to the new table and functions comes back as:

   ```json
   {"code":"PGRST205","message":"Could not find the table 'public.backup_runs' in the schema cache"}
   {"code":"PGRST202","message":"Could not find the function public.backup_health without parameters in the schema cache"}
   ```

   Those two errors mean **"the migration has not been applied, or the cache
   has not caught up yet"** — never a bug in the page. The NOTIFY makes the
   reload immediate; it also happens on its own within a minute, and on a
   project restart (Settings → General → Restart project).

5. Verify:

```sql
-- 66-ish tables, each with a primary key and a dependency depth
SELECT depth, count(*) FROM backup_table_order() GROUP BY depth ORDER BY depth;

-- exact counts, one row per table
SELECT * FROM backup_row_counts() ORDER BY exact_rows DESC LIMIT 10;

-- the health object the page reads
SELECT backup_health();

-- the private bucket
SELECT id, public FROM storage.buckets WHERE id = 'db-backups';
```

`backup_table_order()` returns nothing if you are not signed in as an admin —
that is the permission check inside it, not a failure. Run it from the SQL
editor (which is `service_role`) or as an admin session.

The migration ends with a commented-out block of exactly these checks, so they
can be pasted straight back into the SQL editor later without opening this
document.

**Until step 1 is done, the Backup page says so itself** — it probes for
`backup_runs` when it opens and shows a yellow "Backup is not installed on this
database yet" panel with both commands, rather than forwarding PostgREST's
wording to a toast.

---

## 5. Step 2 — Deploy the edge functions

```bash
node scripts/deploy-functions.mjs        # deploys all, then proves each answers
```

or the raw CLI, from the repo root with `SUPABASE_ACCESS_TOKEN` set or after
`npx supabase login`:

```bash
npx supabase functions deploy --project-ref gmdbrgjxdeztgzvqsaaj --use-api
```

`functions deploy` is safe on this project — it does not touch data. Do not add
`--prune`: it deletes functions present in the project but absent locally.

### 5.1 Set the shared secret

Generate one and put the *same* value in both places:

```bash
openssl rand -hex 32          # copy the output
```

* **Supabase → Edge Functions → Secrets** → add `BACKUP_REPORT_SECRET`
* `/opt/db-backup-boswa/.env` on the VPS → `BACKUP_REPORT_SECRET="…"` (§6.4)

Confirm `verify_jwt = false` took effect for `backup-report` only — the other
two must stay JWT-protected:

```bash
# should be 403 Forbidden (reached the function, wrong secret) — NOT 401
curl -s -o /dev/null -w '%{http_code}\n' \
  -X POST https://gmdbrgjxdeztgzvqsaaj.supabase.co/functions/v1/backup-report \
  -H 'content-type: application/json' -d '{"action":"start"}'
```

### 5.2 Smoke-test the USB path

1. Sign in to the LMS as **super_admin**.
2. **Management → Backup & Restore** appears in the sidebar. Open it.
3. **Backup now → Back up to USB**. Choose any folder for this first test.
4. You should see a progress bar, then a green panel with the row count, size
   and SHA-256.
5. **Check a backup file** → pick the file you just wrote → *"This file is a
   complete backup"*.
6. **History** tab shows one `success` row for kind *USB / local*.

If step 3 fails with *"The db-backup function could not be reached"*, the
function is not deployed. If it fails with *"Only an administrator…"*, the
signed-in account is missing the `admin`/`super_admin` role in `user_roles`.

---

## 6. Step 3 — The nightly Google Drive backup

> **Two ways to run this, pick one.** The VPS route is below. The serverless
> route — same script, same pg_dump, same artifact, no server to maintain — is
> [`BACKUP_GITHUB_ACTIONS.md`](./BACKUP_GITHUB_ACTIONS.md). Running both would
> produce two dumps a night and two rows in History.
>
> `scripts/vps/db-backup.mjs` reads its configuration from
> `/opt/db-backup-boswa/.env` when that file exists and from the environment
> when it does not, which is the only difference between the two.

All of this happens over SSH on the VPS, as root.

### 6.1 Prerequisites

```bash
ssh root@176.126.87.102
apt update
apt install -y gnupg curl
```

Node is already installed for the Hikvision agent:

```bash
NODE=/root/.nvm/versions/node/v20.20.2/bin/node
$NODE --version        # v20.20.2 — needs ≥ 18 for built-in fetch
```

### 6.2 PostgreSQL client — the version has to match

`pg_dump` refuses to dump a server newer than itself, with a message that reads
like a connection problem. Find the server version first:

```sql
-- Supabase SQL editor
SHOW server_version;      -- e.g. 15.8 or 17.4
```

Install the matching client (substitute `15` or `17`):

```bash
apt install -y postgresql-common
/usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y
apt install -y postgresql-client-17        # ← match the server's major version
pg_dump --version                          # must be ≥ the server major
```

The script checks this on every run and aborts with a plain-English message if
it drifts.

### 6.3 Connect rclone to Google Drive

Use the **school's own Google account** (e.g. the same one already used for
Hik-Connect). Do **not** use a service account: a consumer Google account gives
a service account no storage quota of its own, and uploads fail in a way that
looks like a permissions bug.

```bash
apt install -y rclone      # or: curl https://rclone.org/install.sh | bash
rclone version             # ≥ 1.60
```

`rclone config` needs a browser once. The VPS has none, so authorise on your
laptop and paste the token across:

```bash
# ── ON THE VPS ──
rclone config
#  n) New remote
#  name> gdrive
#  Storage> drive
#  client_id>            (blank — press Enter)
#  client_secret>        (blank)
#  scope> 1              (full access)
#  root_folder_id>       (blank)
#  service_account_file> (blank)
#  Edit advanced config? n
#  Use web browser to automatically authenticate? >>> n  <<<
#
# It prints a command like:
#     rclone authorize "drive" "eyJzY29wZSI6…"
```

```bash
# ── ON YOUR LAPTOP (with rclone installed and a browser) ──
rclone authorize "drive" "eyJzY29wZSI6…"     # paste the exact string it printed
# A browser opens → sign in as the school's Google account → Allow.
# rclone prints a long token block. Copy ALL of it, braces included.
```

Paste that token back at the VPS prompt, answer `n` to *"Configure this as a
Shared Drive?"*, `y` to keep it, `q` to quit. Then:

```bash
rclone mkdir gdrive:BoswaLMS-Backups/daily
rclone mkdir gdrive:BoswaLMS-Backups/monthly
rclone lsd gdrive:BoswaLMS-Backups        # should list daily/ and monthly/
```

> The token lives in `/root/.config/rclone/rclone.conf`. `chmod 600` it. It is
> a **full-Drive** credential for that Google account — treat it like a
> password, and revoke it at
> <https://myaccount.google.com/permissions> if the VPS is ever compromised.

### 6.4 Install the scripts

```bash
mkdir -p /opt/db-backup-boswa/work
cd /opt/db-backup-boswa

# Copy from the repo (scp from your machine, or paste with `cat > file`)
#   scripts/vps/db-backup.mjs
#   scripts/vps/db-restore-test.mjs
#   scripts/vps/db-backup.env.example  →  .env

chmod 600 .env
nano .env
```

Fill in `.env` — every field is explained in the file itself. The two that
need looking up:

* **`PGURI`** — Supabase → **Connect** → **Session pooler**. Use the *pooler*
  string (`aws-0-….pooler.supabase.com:5432`), not `db.<ref>.supabase.co`:
  direct connections are IPv6-only and this VPS is IPv4. If nobody has the
  database password, reset it under Settings → Database (this does **not**
  affect the app, which uses API keys).
* **`LOCAL_PGURI`** — a superuser connection to the VPS's *own* Postgres, used
  only by the restore test:

```bash
apt install -y postgresql-17          # the server, not just the client
sudo -u postgres psql -c "ALTER USER postgres PASSWORD 'a-long-local-password'"
# then in .env:
# LOCAL_PGURI="postgresql://postgres:a-long-local-password@localhost:5432/postgres"
```

### 6.5 Decide about encryption

Setting `GPG_PASSPHRASE` encrypts every dump with AES-256 before it leaves the
VPS. **Recommended.** The dump contains every student's ID number, every
employee's salary and every payslip, and it is about to sit in a consumer
Google account protected by one password.

The cost is real and must be accepted deliberately: **if the passphrase is
lost, the backups are lost.** Store it in the password manager *before* setting
it here, and confirm someone other than the person who set it can retrieve it.
The weekly restore test decrypts with this passphrase, so the day it stops
working, the page says so.

### 6.6 First run, by hand

```bash
NODE=/root/.nvm/versions/node/v20.20.2/bin/node
cd /opt/db-backup-boswa

$NODE db-backup.mjs --dry-run      # dumps and counts; uploads nothing
$NODE db-backup.mjs                # the real thing
```

Expected output:

```
[…] pg_dump 17 → server 17
[…] Counting rows…
[…] 66 tables, 41283 rows
[…] Dumping…
[…] boswa-db-2026-08-24.dump.gpg — 6.4 MB, sha256 9f4390f8d30c2dd9…
[…] Uploading to gdrive:BoswaLMS-Backups/daily…
[…] Mirrored boswa-db-2026-08-24.dump.gpg into Supabase Storage
[…] Done.
```

Then check all three places:

```bash
rclone ls gdrive:BoswaLMS-Backups/daily
```

* LMS → Backup & Restore → **History**: a green `success` row, kind *Google Drive*.
* LMS → Backup & Restore → **Nightly cloud backups**: the file is listed.

### 6.7 Cron

Boswa's Hikvision lines already live in this crontab; add these below them.
`crontab -e`:

```cron
# ── Database backups (Boswa LMS) ──────────────────────────────────────────
# Nightly full dump → Google Drive. 02:15, after the 5-minute attendance
# sync has stopped for the night and before anyone is in.
15 2 * * *   /root/.nvm/versions/node/v20.20.2/bin/node /opt/db-backup-boswa/db-backup.mjs >> /var/log/db-backup-boswa.log 2>&1

# Weekly restore drill. Sunday 03:30 — downloads the newest dump back OUT of
# Drive, restores it into a scratch database, compares every row count.
30 3 * * 0   /root/.nvm/versions/node/v20.20.2/bin/node /opt/db-backup-boswa/db-restore-test.mjs >> /var/log/db-backup-boswa.log 2>&1
```

Verify and rotate the log:

```bash
crontab -l | grep db-backup

cat > /etc/logrotate.d/db-backup-boswa <<'EOF'
/var/log/db-backup-boswa.log {
    weekly
    rotate 12
    compress
    missingok
    notifempty
}
EOF
```

---

## 7. Day-to-day: taking a USB backup

For the person at the school. Worth printing and taping inside the office
cupboard.

1. Plug the USB stick in.
2. Open the LMS → **Backup & Restore**.
3. Look at the banner at the top. Green means the automatic nightly backup is
   working. **Red means it is not — tell Automate Africa.**
4. Click **Back up to USB**.
5. When Windows asks where to save, choose the **USB stick**, keep the
   suggested file name, Save.
6. Wait for the green panel. It shows how many rows were saved.
7. Click **Choose a file to check**, pick the file **on the stick**, and
   confirm it says *"This file is a complete backup"*.
8. Take the stick off site.

**Chrome or Edge** is required for step 5 to write straight to the stick. In
Firefox or Safari the file goes to Downloads and must be copied across by hand
— the page says so before it starts.

The audit-trail tables are excluded by default; tick the box only if the copy
is for an auditor who asked for it.

---

## 8. Restoring

### 8.1 From a USB file, into the live database

Use for: *someone deleted records that should not have been deleted.*

**super_admin only.** The page walks it:

1. **Backup & Restore → Backup now → Back up to USB.** Do this first, every
   time. It is what you fall back to if this restore turns out to be the wrong
   file.
2. **Restore** tab → **Choose a backup file**.
3. Read the inspection table: for every table it shows rows now vs rows in the
   file, and flags tables that no longer exist, tables that are never cleared,
   and tables with no primary key.
4. Choose how:
   * **Merge** — adds missing rows and overwrites matching ones by primary key.
     Rows created since the backup survive. This is what you want for
     "restore the deleted 2025 intake".
   * **Replace** — empties each table first. Returns the database to exactly
     the state in the file; **anything entered since the backup is lost.**
5. Type `RESTORE` and click.

Guarantees worth knowing:

* Rows go back **parents before children**, using the dependency depth recorded
  in the file, so foreign keys are never violated mid-restore.
* Every batch is an **upsert on the primary key**, so an interrupted restore
  can simply be run again.
* Columns that no longer exist in the schema are **dropped and reported**, not
  fatal — the six-months-later case is exactly the case that matters.
* `audit_logs`, `user_sessions`, `backup_runs` and `user_roles` are **never
  cleared**, even by Replace. A restore that erased the record of itself, or
  that locked everyone out because the backup predates a role change, is not
  recoverable by the person running it.
* The restore writes a **critical** entry to the audit trail naming the file,
  the strategy and the row counts.

### 8.2 The weekly automated restore test

Runs itself. To run it now:

```bash
cd /opt/db-backup-boswa
/root/.nvm/versions/node/v20.20.2/bin/node db-restore-test.mjs
```

```
[…] Newest backup in Drive: boswa-db-2026-08-24.dump.gpg (6.4 MB)
[…] Decrypted.
[…] Creating restore_test_boswa_20260824…
[…] Supabase shim applied.
[…] Restoring…
[…] PASS — 66 tables, 41283 rows, all counts match.
```

It downloads **from Google Drive**, not from local disk — the copy in Drive is
the one a real recovery would use, so it is the one that gets tested. A broken
upload is caught here.

`--keep` leaves the scratch database in place to poke at;
`--file /path/to.dump` tests a specific file instead of the newest.

A scratch PostgreSQL is not Supabase, so the script first lays down a small
shim: the `auth` schema, stub `auth.uid()` / `auth.role()` / `auth.jwt()`, and
the `anon` / `authenticated` / `service_role` roles the dump's RLS policies and
grants refer to. `pg_restore` may report a handful of warnings about things the
scratch server does not carry; **the verdict is the row-count comparison, not
pg_restore's exit code** — a dump of an empty database also exits 0. The
warning count is recorded alongside the result.

### 8.3 Full disaster recovery — the Supabase project is gone

Rehearse this once, with the client watching, before you need it.

1. **Get the dump.** Google Drive → `BoswaLMS-Backups/daily` (or `monthly/`),
   newest `.dump` or `.dump.gpg`. Decrypt if needed:
   ```bash
   gpg --output boswa-db.dump --decrypt boswa-db-2026-08-24.dump.gpg
   ```
2. **Create a new Supabase project.** Note its ref and database password.
3. **Restore the public schema:**
   ```bash
   pg_restore --dbname "postgresql://postgres.<newref>:<pw>@aws-0-<region>.pooler.supabase.com:5432/postgres" \
              --no-owner --no-privileges --no-comments \
              boswa-db.dump
   ```
   Expect warnings about roles and extensions the new project defines
   differently; they are not fatal.
4. **Recreate the storage buckets** — `applicant-docs`, `student-photos`,
   `module-notes`, `timetable-documents`, `db-backups` and the HR document
   bucket. **Their contents are not in this dump** (see §11).
5. **Recreate the login accounts.** `auth.users` is not in a `public`-only
   dump. Use `supabase/functions/hr-create-user` / `create-user`, or the
   Supabase dashboard, and issue new passwords. `profiles` and `user_roles`
   came back with the restore, so roles and names are already correct — the
   accounts need re-linking by `user_id`.
6. **Re-deploy the edge functions** and re-add their secrets
   (`HIK_SYNC_SECRET`, `BACKUP_REPORT_SECRET`).
7. **Point the app at the new project:** `.env` → `VITE_SUPABASE_URL`,
   `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID`. Rebuild and
   redeploy.
8. **Point the VPS at the new project:** `/opt/hik-sync-boswa/.env` and
   `/opt/db-backup-boswa/.env`.
9. **Prove it:** sign in, open the Backup page, take a USB backup, and run
   `db-backup.mjs` by hand.

Realistic recovery time from a cold start: **two to three hours**, most of it
step 5.

---

## 9. Monitoring and troubleshooting

**The one thing to look at:** the banner on the Backup page. Red = the newest
successful cloud backup is over 36 hours old.

```bash
tail -40 /var/log/db-backup-boswa.log
```

| Symptom | Cause | Fix |
|---|---|---|
| `PGRST205 Could not find the table 'public.backup_runs'` | The migration has not been applied | §4. The page shows this as a yellow setup panel |
| `PGRST202 Could not find the function public.backup_health` | Same — or the schema cache has not reloaded since it was | Run `NOTIFY pgrst, 'reload schema';`, wait a few seconds, press **Check again** |
| Migration applied, errors persist past a minute | The SQL ran against a different project, or it errored partway | Re-run the verification queries at the foot of the migration; check the SQL editor's output for a failed statement |
| *"The db-backup function is not deployed"* | §5 was skipped | `supabase functions deploy db-backup --project-ref gmdbrgjxdeztgzvqsaaj` |
| Banner red, no rows in History for days | cron not running, or the VPS is down | `crontab -l \| grep db-backup`; `systemctl status cron` |
| `pg_dump is version 15 but the server is 17` | Supabase upgraded Postgres | §6.2 — install the matching `postgresql-client-NN` |
| `backup-report … → 403` | Secret mismatch | The value in `.env` and the `BACKUP_REPORT_SECRET` function secret must be identical |
| `no pg_hba.conf entry` / connection refused | Using the direct `db.<ref>.supabase.co` host on an IPv4-only VPS | Switch `PGURI` to the **Session pooler** string |
| `Another backup is already running (pid …)` | Previous run still going, or a stale lock | Wait; if the pid is dead the script clears it automatically |
| Storage mirror skipped, Drive fine | Dump exceeds `MIRROR_MAX_MB` (Supabase caps uploads at 50 MB) | Raise the project's storage file-size limit, or accept it — the Drive copy is the real backup |
| Restore test FAIL, one table short | Genuine — investigate before trusting the backup | `db-restore-test.mjs --keep`, then inspect the scratch database |
| History row stuck on `running` | A backup started and never finished | Expected signal, not a bug. Look at the log for that night |
| Browser: *"The backup ended early and is incomplete"* | Network dropped mid-stream | Delete the partial file and retry. It is never reported as success |

The Audit Trail page (`Management → Audit Trail`) records every backup taken,
every nightly dump copied to a stick, and every restore, with the actor's name
and IP.

---

## 10. Security

* The USB file and the nightly dump both contain **every student's and
  employee's personal data**. Treat a backup stick like the paper file it
  replaces: locked drawer, named custodian, and destroyed when superseded.
* The USB backup is **not encrypted** — it is meant to be readable without any
  of our software, which is half its value. Encryption is what a locked drawer
  is for.
* The nightly dump **is** encrypted if `GPG_PASSPHRASE` is set. Set it (§6.5).
* Taking a backup is `admin` + `super_admin`. Restoring is **`super_admin`
  only**, enforced in the edge function, not just in the menu.
* That is checked in three independent places, because a single check is a
  single thing to get wrong:
  1. `ROLE_PAGES` in `src/components/AppLayout.tsx` refuses to render the page
     for anything but `admin` / `super_admin` — and the Sidebar no longer falls
     back to the admin menu for a role it does not recognise.
  2. `BackupPage` itself re-reads the role and shows a refusal instead of the
     tabs, so a direct `navigate()` from anywhere else cannot open it either.
     The Restore tab is separately narrowed to `super_admin`, so an `admin` is
     told why up front rather than after filling in the confirmation phrase.
  3. Every function behind the page — `backup_table_order()`,
     `backup_row_counts()`, `backup_table_columns()`, `backup_health()`,
     `record_backup_run()` — checks the role in SQL, and the two edge functions
     resolve the caller's roles from `user_roles` before writing a byte.
  Only the third is load-bearing. The first two exist so nobody is shown a
  door that will not open.
* The `db-backups` bucket is private with an admin-only read policy and **no
  write policy for any browser session** — the only writer is the VPS, through
  a signed URL minted per object. Nobody can plant a file that looks like a
  backup.
* The VPS holds the shared secret and the Postgres URI, never the service role
  key.
* Every backup, every save-to-USB and every restore is in the audit trail.

---

## 11. What is **not** in a backup

Say this out loud to the client; it is the part that surprises people.

| Not included | Where it is | What to do |
|---|---|---|
| ~~**Storage objects**~~ — student photos, module notes, assignment attachments, contract PDFs, applicant documents | Supabase Storage buckets | **Now covered.** A separate weekly job (`scripts/vps/files-backup.mjs`, `.github/workflows/db-files-backup.yml`) `rclone sync`s five buckets to `<remote>/files/`. See §11.1 |
| **Login passwords** (`auth.users`) | Supabase Auth, outside the `public` schema | Cannot be exported. On recovery, accounts are recreated and passwords reissued (§8.3 step 5) |
| **Edge function code and secrets** | This repo / Supabase dashboard | The repo is the backup. Secrets live in the password manager |
| **Realtime / cron config, dashboard settings** | Supabase project settings | Documented here and in `BOSWA_HANDOVER.md` |

If `DUMP_SCHEMAS="public,auth"` is accepted by the database role, the nightly
dump *does* capture `auth.users` — try it, check the log, and update this table
if it works.

### 11.1 The weekly file backup

Runs Sundays 02:45 UTC. Copies five buckets — `student-photos`,
`applicant-docs`, `employee-docs`, `assignment-files`, `timetables` — to
`<RCLONE_REMOTE>/files/<bucket>/`. `db-backups` is deliberately excluded: it
holds the mirrored dumps, which are already in Drive.

**What makes it a backup rather than a mirror.** `rclone sync` on its own is a
mirror, and a mirror faithfully reproduces an accidental deletion. The job runs
with `--backup-dir`, so an object deleted or overwritten in the app is *moved
aside* into `files/_replaced/<date>/<bucket>/` and stays recoverable for
`FILES_KEEP_DAYS` (90). Two further guards: `--max-delete 50` aborts rather than
propagating a mass deletion, and a bucket whose source listing comes back empty
is **skipped**, because rclone reports a bucket it could not list as containing
nothing — and "nothing" to a sync means "delete everything at the destination".

**Restoring one bucket:**

```bash
rclone copy "$RCLONE_REMOTE/files/student-photos" supastore:student-photos -v
```

…where `supastore:` is the S3 remote the script configures from environment
variables (see `rcloneEnv()` in `scripts/vps/files-backup.mjs`). To recover a
single file someone deleted, look under `files/_replaced/<date>/` first.

⚠️ **This restore path has been exercised by hand, not by an automated drill.**
The database has a weekly restore test that proves the dump actually restores;
files do not yet. Restore one real object by hand as part of acceptance, and see
§12 for the outstanding work.

**The credential, and what it can do.** The job authenticates to Supabase
Storage with S3 access keys, not the service role key. Those keys cannot read a
table, bypass RLS, read `auth.users`, or call a function — they are strictly
weaker than the credential `backup-report` exists to keep off the runner. They
are not nothing: today they can read **and write** every bucket in the project.
The mitigations are the bucket allowlist (never a denylist, so `db-backups`
cannot be swept in by accident), the read-only direction of the sync, and
`--max-delete`. This does widen the runner's blast radius from "the database,
read-only via `pg_dump`" to "storage, read-write", and that is a deliberate
trade for incremental sync — a nightly full re-upload of every photo stops being
viable long before anyone notices.

---

## 12. Acceptance checklist

Tick all of these before calling the feature delivered.

**Local backup**

- [ ] Migration applied; `SELECT backup_health();` returns an object
- [ ] Three functions deployed; `backup-report` returns 403 on a bad secret
- [ ] Backup & Restore appears for super_admin and admin, and **not** for
      hod/lecturer/student/employee — neither in the menu nor by navigating
      straight to the page
- [ ] Signed in as `admin`, the Restore tab explains that restoring is
      super_admin-only instead of showing the form
- [ ] One-click backup writes straight to a USB stick in Chrome/Edge
- [ ] The green panel's row count matches `SELECT sum(exact_rows) FROM backup_row_counts()` (minus the skipped audit tables)
- [ ] "Check a backup file", run against the file **on the stick**, passes
- [ ] The SHA-256 on the page matches `certutil -hashfile <file> SHA256`
- [ ] Unplugging the stick mid-backup produces an *incomplete* error, and the History row does **not** say success
- [ ] History shows the run

**Cloud backup**

- [ ] `npm run check:backup` reports no blocking problems
- [ ] `.github/workflows/db-backup.yml` is visible on `main` **on github.com** —
      not merely present locally. Nothing runs, and the *Run backup now* button
      404s, until it is pushed
- [ ] `db-backup.mjs --dry-run` succeeds
- [ ] A real run lands in `gdrive:BoswaLMS-Backups/daily` with its `.counts.json`
- [ ] The file is listed on the **Nightly cloud backups** tab and saves to USB
- [ ] History shows a green *Google Drive* row with size, rows and checksum
- [ ] Both cron lines are in `crontab -l`
- [ ] `db-restore-test.mjs` prints **PASS** and all counts match
- [ ] "Last verified restore" appears on the banner
- [ ] Deliberately break it — wrong secret in `.env`, run the script — and confirm a **failed** row appears and the banner explains itself. Then put the secret back.

**The Nightly tab tells the truth**

- [ ] Before any cloud run, the tab says **"No cloud backup has ever run on this
      database"** — not "No dumps here yet". These are different problems with
      different fixes
- [ ] Force the mirror to be skipped (`MIRROR_MAX_MB: '0'` for one manual run).
      The tab must say the dump **is in Google Drive but too large to mirror
      here**, and must **not** claim there are no backups. *This is the specific
      lie this work was done to fix — test it explicitly*
- [ ] After a failure, the tab shows the real `message` from the run, not a
      generic sentence
- [ ] The Drive section lists the same files, sizes and count as Google Drive
      itself, and says when the snapshot was taken

**Run backup now**

- [ ] Works as `admin` and as `super_admin`
- [ ] A `hod` cannot reach the page, and a direct call to `backup-trigger` with
      the **publishable key** returns 401 — that key is a valid JWT and is
      public, so the role check, not `verify_jwt`, is what protects this
- [ ] Double-clicking gives a readable 409, not a second queued run
- [ ] With `GITHUB_DISPATCH_TOKEN` unset, the button explains what to set and
      where, and the rest of the tab keeps working

**Failure alerts**

- [ ] A failed run puts a red notification in every administrator's bell
- [ ] A second failure while the first is **unread** produces no duplicate;
      after marking it read, the next failure alerts again
- [ ] `notified: N` appears in the runner's log for a failed run

**File backup**

- [ ] The `files` migration is applied **before** the first files run
- [ ] A run lands objects in `<remote>/files/<bucket>/` for each bucket
- [ ] `db-backups` is **not** among them
- [ ] Delete a test photo in the app, re-run, and confirm it was **moved into
      `files/_replaced/<date>/`, not destroyed**
- [ ] `rclone copy` one object back and confirm it reappears in the app —
      the restore path is otherwise untested

**Restore**

- [ ] On a **scratch Supabase project**, not production: restore a USB file with *Merge* and confirm row counts
- [ ] Delete a handful of rows there, restore the same file, confirm they return
- [ ] Confirm a non-super_admin gets *"Only a super administrator may restore"*
- [ ] Confirm the restore appears in the Audit Trail as **critical**

**Outstanding security work found on 25 August 2026 (not backup-related)**

- [ ] `hik-attendance` and `hikvision-attendance` had `verify_jwt = false` in
      `supabase/config.toml` while having no authentication of their own, so
      once deployed they were callable by anyone: they read attendance records
      and use the stored Hik-Connect credentials. Both are called only from the
      browser (`src/lib/hr/hikvisionService.ts`), which always sends a session
      JWT, so `verify_jwt` was switched on and both were redeployed —
      unauthenticated callers now get 401 and the app is unaffected.
      **This is a partial fix.** The publishable key is itself a valid JWT and
      is public, so any visitor to the site can still reach them. The complete
      fix is a role check inside each function, as `db-backup` does:
      resolve the caller with `auth.getUser(token)` and require `hr` /
      `super_admin` in `user_roles`. Until then, treat those two endpoints as
      readable by anyone who opens the site.
- [ ] `HIK_SYNC_SECRET` is not set on the project, so `ingest-attendance`
      answers 500 and the VPS attendance sync does not ingest. The value is in
      `/opt/hik-sync-boswa/.env`.

**Before handover**

- [ ] Google Drive backups currently go to `agentbwfive@gmail.com`, chosen for
      testing on 26 August 2026. Move them to the school's own account —
      see *Switching accounts* in
      [`BACKUP_GITHUB_ACTIONS.md`](./BACKUP_GITHUB_ACTIONS.md). Leaving a
      school's entire database in a contractor's personal Google Drive is not
      a defensible end state.

**Still to build (agree with the client whether it is in scope)**

- [x] ~~Storage-bucket backup (photos, notes, attachments)~~ — built, §11.1
- [x] ~~Alert on a failed nightly run, in addition to the banner~~ — every
      admin now gets a notification in the bell. Email/WhatsApp deliberately
      not built: it means a new provider, a new secret, and a new thing that
      can silently stop working.
- [ ] An automated restore drill for **files**, matching the weekly one for the
      database. Until then the file restore path is documented and hand-tested
      only, and this system's own position is that a backup nobody has read back
      is a guess.
- [ ] Off-VPS copy of the Drive backups (a second cloud, or a quarterly stick)
- [ ] Reconstruct the missing `hr_notifications` migration. The table exists in
      the live database but the file that created it is not in this repo, so a
      rebuild from migrations alone would be missing it — and the failure alert
      with it. `npm run check:backup` prints the live column definitions;
      capture them rather than guessing.

---

## 13. Change log

| Date | Version | Change |
|---|---|---|
| 24 Aug 2026 | 1.0 | Local USB backup, verification, restore; nightly pg_dump to Google Drive; weekly automated restore test; backup history and health banner |
| 27 Aug 2026 | 1.1 | The Nightly tab now reads `backup_runs` as well as the Storage mirror, so a dump that reached Drive but was too large to mirror is no longer reported as no backup at all; it distinguishes never-configured from failing, shows the real Google Drive contents, and offers **Run backup now** (`backup-trigger`). A failed run notifies every administrator. Weekly Storage-bucket backup added (§11.1), with a new `files` run kind. `npm run check:backup` diagnoses the whole install. |
