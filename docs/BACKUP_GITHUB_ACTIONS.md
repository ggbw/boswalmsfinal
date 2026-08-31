# Google Drive automatic backup, via GitHub Actions

The nightly backup with no server to maintain. Same `pg_dump`, same artifact,
same Drive folders, same restore procedure as the VPS route — only the thing
holding the cron differs.

**Repo:** `ggbw/boswalmsfinal` · **Project:** `gmdbrgjxdeztgzvqsaaj` ·
**Time needed:** about 20 minutes, most of it waiting

> **Pick one route, not both.** `scripts/vps/*` and these workflows do the same
> job. Running both means two dumps a night and two rows in History. If you
> later move to the VPS, disable these two workflows in the Actions tab.

---

## What you are setting up

```
GitHub Actions (02:15 UTC nightly)
   └─ pg_dump ──► gpg ──► rclone ──► Google Drive/BoswaLMS-Backups/daily
                                └──► Supabase Storage (db-backups, 7 days)
        └─► backup-report ──► backup_runs ──► the LMS Backup page turns green

GitHub Actions (Sunday 03:30 UTC)
   └─ downloads the newest dump BACK OUT of Drive
      └─ restores into a throwaway PostgreSQL 17
         └─ compares all 66 row counts ──► "Last verified restore"
```

Already done and verified — nothing to do here:

- ✅ migration applied, `backup_runs` + 6 functions live
- ✅ all 17 edge functions deployed
- ✅ `db-backups` storage bucket exists
- ✅ `BACKUP_REPORT_SECRET` generated, set on Supabase, tested

---

## Step 1 · Authorise Google Drive (only you can do this)

rclone talks to Drive with an OAuth refresh token. Getting one needs a real
browser signed in as the account the backups will live in. Two minutes.

> ### ⚠️ Which account — read before you sign in
>
> | | Account | Status |
> |---|---|---|
> | **Testing now** | `agentbwfive@gmail.com` | Chosen 26 Aug 2026 |
> | **Production** | `boswabwcloud@gmail.com` | **Must be switched before handover** |
>
> A dedicated agent account is a better testing choice than a personal one —
> nothing else lives in it, so a stray backup cannot end up mixed in with
> someone's private files.
>
> It is still **not** where these backups should finally live. The school's
> entire database — every student ID number, every payslip — would be sitting
> in an account Boswa does not control. If that account is closed or the
> working relationship ends, their disaster recovery goes with it. That reads
> badly in an audit and worse in a real incident.
>
> **Switching is not just a settings change** — it means redoing this whole
> step signed in as the school account and replacing the `RCLONE_CONFIG`
> secret. Budget ten minutes, and see *Switching accounts* at the foot of this
> document.
>
> **Note on verification:** Claude's Google Drive connector is bound to
> `arora119@gmail.com`. It cannot see `agentbwfive@gmail.com`, so uploads there
> have to be checked with `rclone ls` or in a browser. To keep them checkable
> from Claude, share the `BoswaLMS-Backups` folder from `agentbwfive` to
> `arora119@gmail.com` — ownership stays put and the files become visible.

**The Claude Google Drive connector cannot do this job.** It is an OAuth
session bound to a conversation, so that Claude can read and write Drive while
someone is talking to it. The backup runs at 02:15 with no human and no
session attached; there is no way for a GitHub runner to authenticate through
it. That is precisely what the rclone refresh token below is for. The
connector is still useful for *verifying* that a backup landed — but only for
the account it is connected to.

### 1a. Install rclone on your Windows machine

Download from <https://rclone.org/downloads/> (the Windows AMD64 zip), unzip,
and open a terminal in that folder. Or with winget:

```powershell
winget install Rclone.Rclone
```

### 1b. Create the remote

```powershell
rclone config
```

Answer:

| Prompt | Answer |
|---|---|
| `n/s/q` | `n` — New remote |
| `name` | **`gdrive`** (exactly — the workflows expect it) |
| `Storage` | `drive` |
| `client_id` | *(blank, press Enter)* |
| `client_secret` | *(blank)* |
| `scope` | `1` — full access |
| `service_account_file` | *(blank)* |
| `Edit advanced config?` | `n` |
| `Use web browser to automatically authenticate?` | **`y`** |

A browser opens. Sign in as the account from the table above — for now
**`agentbwfive@gmail.com`** — then **Allow**.

> On Windows this usually works directly. If it says it cannot open a browser,
> answer `n` instead and it prints an `rclone authorize "drive" "…"` command to
> run on any machine that has one; paste the resulting token back.

Finish with: `Configure this as a Shared Drive (Team Drive)?` → `n`,
`Keep this "gdrive" remote?` → `y`, then `q` to quit.

### 1c. Create the folders and confirm

```powershell
rclone mkdir gdrive:BoswaLMS-Backups/daily
rclone mkdir gdrive:BoswaLMS-Backups/monthly
rclone lsd gdrive:BoswaLMS-Backups
```

Expect `daily` and `monthly`. `rclone mkdir` is idempotent, so re-running it is
harmless.

Steady-state disk use is small — roughly 30 daily plus 12 monthly copies of a
~6 MB dump, so about **250 MB**. Comfortable inside a free 15 GB account
unless it is already near full.

### 1d. Print the config — this becomes a GitHub secret

```powershell
rclone config file        # tells you where it is
type "C:\Users\<you>\AppData\Roaming\rclone\rclone.conf"
```

Copy the **whole file**, including the `[gdrive]` line:

```ini
[gdrive]
type = drive
scope = drive
token = {"access_token":"ya29...","refresh_token":"1//0e...","expiry":"..."}
team_drive =
```

> That `refresh_token` is a long-lived credential for the whole Drive of that
> account. It is about to live in GitHub Secrets, which is the right place for
> it — encrypted, never printed in logs, not readable by collaborators. It can
> be revoked any time at <https://myaccount.google.com/permissions>.

---

## Step 0 · The workflows must be on `main`

Nothing in this document works until `.github/workflows/` is **committed and
pushed to the default branch**. GitHub cannot run — or be asked to run — a
workflow it has never seen. A file that exists only on a laptop, or only on a
feature branch, produces:

* no scheduled runs at all, silently; and
* a bare **404** from the *Run backup now* button, which reads like a broken
  token rather than a missing file.

Check `git ls-files .github/workflows` locally, then confirm on github.com that
you can see `db-backup.yml` on `main`.

> **A scheduled workflow is disabled automatically after 60 days without any
> activity in the repository.** `supabase-keepalive.yml` pushes a stamp file to
> prevent that. If backups stop for no visible reason, look here first.

---

## Step 2 · Add the repository secrets

**GitHub → `ggbw/boswalmsfinal` → Settings → Secrets and variables → Actions →
New repository secret.** Names must match exactly.

### For the nightly database backup

| Secret | Value | Where it comes from |
|---|---|---|
| `PGURI` | `postgresql://postgres.gmdbrgjxdeztgzvqsaaj:PASSWORD@aws-1-eu-west-1.pooler.supabase.com:5432/postgres` | Supabase → **Connect** → **Session pooler**. Copy it from there rather than typing — the hostname varies. Substitute the real password. |
| `SUPABASE_URL` | `https://gmdbrgjxdeztgzvqsaaj.supabase.co` | — |
| `BACKUP_REPORT_SECRET` | the 64-char hex value | **Run `npm run check:backup`** — it asks the deployed function which value it actually accepts and names the file holding it. Do not guess: the repo has held two different values, and the wrong one means the job runs, uploads to Drive, gets a 403 on the way back, and reports nothing. |
| `RCLONE_REMOTE` | `gdrive:BoswaLMS-Backups` | — |
| `RCLONE_CONFIG` | the whole `rclone.conf` from step 1d | — |
| `GPG_PASSPHRASE` | a long passphrase, **or leave the secret unset** | You choose — see below |
| `DRIVE_FOLDER_URL` | *optional* — the folder's URL from your browser's address bar | Only used to put a working link on the Backup page. If rclone reports the folder's Drive id the link is built from that instead, and if neither is available the page shows the remote as plain text rather than inventing a URL. |

### For the weekly file backup

**Supabase → Project Settings → Storage → S3 access keys → New access key.**
The secret is shown **once**.

| Secret | Value |
|---|---|
| `SUPABASE_S3_ACCESS_KEY_ID` | from that page |
| `SUPABASE_S3_SECRET_ACCESS_KEY` | from that page — copy it immediately |
| `SUPABASE_S3_REGION` | **`eu-west-1`** for this project — confirmed against the Management API. Shown on the same page as the keys. The region is part of the S3 signature, so a wrong value fails with `SignatureDoesNotMatch`, which reads like bad keys rather than a bad region. |

These are *storage* credentials: they cannot read a table, bypass RLS, read
`auth.users`, or call a function. They can read and write every bucket, which is
why `scripts/vps/files-backup.mjs` keeps a bucket allowlist and only ever syncs
outwards. See `BACKUP_AND_RESTORE.md` §11.1.

### For the "Run backup now" button

This one is **not** a repository secret — it goes on the edge function, because
the browser must never hold it.

**GitHub → Settings → Developer settings → Personal access tokens →
Fine-grained tokens → Generate new token.** Resource owner `ggbw`, repository
access **Only select repositories → `boswalmsfinal`**, repository permission
**Actions: Read and write**. Shortest expiry you are willing to renew.

Then **Supabase → Edge Functions → Secrets**, or:

```bash
npx supabase secrets set GITHUB_DISPATCH_TOKEN=github_pat_… --project-ref gmdbrgjxdeztgzvqsaaj
npx supabase functions deploy backup-trigger --project-ref gmdbrgjxdeztgzvqsaaj
```

`GITHUB_REPO` and `GITHUB_REF` are optional and default to `ggbw/boswalmsfinal`
and `main`.

⚠️ **A fine-grained token expires.** When it does, the button starts answering
401 and nothing else changes — the scheduled backups keep running, so there is
no other symptom. The function reads GitHub's
`github-authentication-token-expiration` header and returns the date; put a
calendar reminder in for a week before it.

### About `PGURI`

Use the **Session pooler** string, not `db.gmdbrgjxdeztgzvqsaaj.supabase.co` —
the direct host is IPv6-only and GitHub runners are IPv4.

If nobody has the database password: **Settings → Database → Reset database
password**. This does *not* affect the app, which authenticates with API keys.

### About `GPG_PASSPHRASE`

Setting it encrypts every dump with AES-256 before it leaves the runner.
**Recommended.** The dump holds every student's ID number and every payslip,
and it is about to sit in a Google account protected by one password.

⚠️ **Put the passphrase in your password manager before you set it here.** If
it is lost, every backup is unopenable. There is no recovery.

Leave the secret unset to upload unencrypted — the workflow handles both.

---

## Step 3 · Run it by hand

**Actions → Nightly database backup → Run workflow → Run workflow.**

Watch the log. A healthy run:

```
pg_dump 17.6 → server 17
Counting rows…
66 tables, 41283 rows
Dumping…
boswa-db-2026-08-26.dump.gpg — 6.4 MB, sha256 9f4390f8d30c2dd9…
Uploading to gdrive:BoswaLMS-Backups/daily…
Mirrored boswa-db-2026-08-26.dump.gpg into Supabase Storage
Drive now holds 1 daily and 0 monthly file(s)
Done.
```

`Skipping the Storage mirror: … exceeds the 45 MB limit` is **not** a failure.
The backup is in Drive; only the convenience copy the Backup page can put on a
USB stick was skipped, and the page now says exactly that instead of reporting
no backups.

### Verify in three independent places

1. **Google Drive** — `BoswaLMS-Backups/daily` has a `.dump(.gpg)` **and** a
   `.counts.json`.
2. **LMS → Backup & Restore → History** — a green `success` row, kind *Google
   Drive*, with size, rows and checksum.
3. **The banner turns green** — *"Cloud backup is running — Last successful
   cloud backup: just now."*

The third is the real end-to-end proof: the runner reached `backup-report`,
which wrote `backup_runs`, which the page read.

The **Nightly cloud backups** tab should now show the run as healthy, list what
is really in Google Drive, and offer the mirrored file with a *Save to USB*
button.

---

## Step 3a · The "Run backup now" button

Once `GITHUB_DISPATCH_TOKEN` is set and `backup-trigger` is deployed, an
administrator can start a run from **Backup & Restore → Nightly cloud
backups → Run backup now**, without a GitHub account.

The page then watches `backup_runs` for a row it has not seen before —
`workflow_dispatch` answers 204 with an empty body, so there is no run id to
follow — and narrates *waiting for the runner* → *running* → the result. After
eight minutes it says so plainly rather than spinning forever; the run is
unaffected and the History tab will show how it ended.

What the failures mean:

| What you see | Cause |
|---|---|
| *"…or `db-backup.yml` is not on the `main` branch"* | GitHub's 404. Almost always step 0 — the workflow is not pushed. |
| *"GITHUB_DISPATCH_TOKEN is not set on this function"* | The function secret is missing. Start the run from the Actions tab meanwhile. |
| *"GitHub rejected the token (401)"* | The fine-grained PAT expired. Issue a new one. |
| *"A backup started 4 minute(s) ago and is still running"* | The guard, working. Starting another would only queue behind it. |

---

## Step 4 · Run the restore drill

**Actions → Weekly restore drill → Run workflow.**

```
Newest backup in Drive: boswa-db-2026-08-26.dump.gpg (6.4 MB)
Decrypted.
Creating restore_test_boswa_20260826…
Supabase shim applied.
Restoring…
PASS — 66 tables, 41283 rows, all counts match.
```

**PASS is the point of the whole exercise.** Then check the LMS banner shows
*"Last verified restore: just now."*

After this, the workflows run on their own — 02:15 UTC nightly, 02:45 UTC Sunday
(files), 03:30 UTC Sunday (restore drill). Nothing further to do.

---

## Step 4a · Run the file backup

**Actions → Weekly file backup → Run workflow.** Needs the three
`SUPABASE_S3_*` secrets and the `files` migration
(`node scripts/apply-migration.mjs supabase/migrations/20260827120000_backup_runs_files_kind.sql`)
— **apply the migration first**, or `record_backup_run` rejects the new kind and
the run reports itself failed.

```
Copying 5 bucket(s) to gdrive:BoswaLMS-Backups/files…
  student-photos: 412 object(s), 48.8 MB →  gdrive:BoswaLMS-Backups/files/student-photos
  applicant-docs: 96 object(s), 71.2 MB →  …
  timetables: source lists 0 objects — skipping (a sync would empty the copy in Drive)
508 object(s) across 4 bucket(s); 1 skipped: timetables
Done.
```

Then **prove the restore**, because nothing else does:

1. Note a file under `files/student-photos/` in Drive.
2. Delete that photo in the app, re-run the workflow.
3. Confirm it is now under `files/_replaced/<today>/student-photos/` — **moved
   aside, not destroyed.**
4. `rclone copy` it back and confirm it reappears in the app.

---

## Step 5 · Prove failure is visible

Do this once. A backup system that cannot report failure is worse than none,
because it manufactures confidence.

1. Edit the `PGURI` secret — change one character of the password.
2. **Actions → Nightly database backup → Run workflow.**
3. Confirm all four:
   * the run goes **red**;
   * the LMS History tab shows a `failed` row with the reason;
   * the **Nightly cloud backups** tab shows a red panel quoting that reason;
   * **every administrator gets a notification in the bell** — this is the one
     that reaches someone who never opens the Backup page.
4. Fail it a *second* time without reading the notification. There must be **no
   duplicate** — an unread alert suppresses another for 24 hours. Mark it read,
   fail again, and a fresh one appears.
5. **Put the password back** and re-run to confirm green.

The banner turns red only once the newest success is over 36 hours old — that
is deliberate, so a job that runs at 02:15 is not reported as overdue at 09:00.
The `failed` row in History appears immediately.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| `pg_dump: server version 17.6; pg_dump version 16.x` | The PGDG install step failed — read its log |
| `no pg_hba.conf entry` / connection refused | `PGURI` uses the direct host, not the Session pooler |
| `backup-report … → 403` | `BACKUP_REPORT_SECRET` differs from the value on Supabase |
| `RCLONE_CONFIG secret is empty` | Step 2 — the secret name must match exactly |
| `couldn't find root directory ID` / `token expired` | The Drive token was revoked. Redo step 1 |
| `Storage mirror failed` but Drive fine | Dump exceeds 50 MB, Supabase's upload cap. Harmless — Drive is the real backup |
| Nothing in History, run otherwise green | `SUPABASE_URL` wrong |
| Restore drill FAIL, one table short | **Genuine.** Investigate before trusting the backup |

Workflow logs are under the Actions tab and kept 90 days. Secrets are masked in
them automatically.

---

## What this does not back up

Unchanged from the VPS route — see
[`BACKUP_AND_RESTORE.md` §11](./BACKUP_AND_RESTORE.md):

- **Storage objects** — student photos, notes, assignment files, contract PDFs
- **Login passwords** (`auth.users`) — recreated on recovery, §8.3 step 5

## Switching accounts — do this before handover

The backups currently go to `agentbwfive@gmail.com`, which was chosen for
testing. Moving them to the school's account:

1. Sign out of rclone's stored token, or use a second remote name:
   ```powershell
   rclone config delete gdrive
   ```
2. Redo **step 1**, signing in as `boswabwcloud@gmail.com`.
3. Create the folders on the new account (step 1c).
4. Replace the **`RCLONE_CONFIG`** repository secret with the new
   `rclone.conf`. Nothing else changes — `RCLONE_REMOTE` stays
   `gdrive:BoswaLMS-Backups`.
5. **Actions → Nightly database backup → Run workflow**, and confirm the file
   appears in the new account's Drive.
6. Optionally share the folder to `arora119@gmail.com` so uploads stay
   verifiable from Claude's Drive connector.
7. Copy the historical dumps across if you want to keep them:
   ```powershell
   rclone copy old-gdrive:BoswaLMS-Backups gdrive:BoswaLMS-Backups
   ```
8. Delete the folder from the testing account once the new one is verified —
   it holds real student data and should not linger.

Update the table in step 1 when this is done, so the next person knows.

## Switching to the VPS later

Nothing to rewrite. `scripts/vps/db-backup.mjs` is the same file these
workflows run; it reads its configuration from `/opt/db-backup-boswa/.env`
when that file exists and from the environment when it does not. Follow
[`BACKUP_AND_RESTORE.md` §6](./BACKUP_AND_RESTORE.md), then disable these two
workflows in the Actions tab so you are not backing up twice.
