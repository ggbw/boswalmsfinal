# Installing Backup & Restore — step by step

Follow this once. It takes about fifteen minutes and gets the Backup page
working. The full design and operations manual is
[`BACKUP_AND_RESTORE.md`](./BACKUP_AND_RESTORE.md); this is only the install.

**Project:** `gmdbrgjxdeztgzvqsaaj` · **What you need:** a Supabase account with
access to that project.

---

## Before anything: find out what is already in place

```bash
npm run check:backup
```

Read-only — it writes nothing, uploads nothing, and triggers no workflow. In one
screen it answers the questions that otherwise take an afternoon:

* **Which `BACKUP_REPORT_SECRET` does the deployed function actually accept?**
  It tries every value in the repo against the live function and names the file
  holding the right one. This matters more than it sounds: with the wrong value
  in GitHub Secrets the nightly job runs to completion, uploads to Drive, gets a
  403 on the way back, and reports nothing — so the Backup page insists no
  backup has ever run while Drive quietly fills up. There is no way to tell that
  apart from "it never ran" by looking at the app.
* Are the four edge functions deployed? (An undeployed function reaches the
  browser as a *CORS error*, never a 404 — §4.5.)
* Is the migration applied, does `backup_runs.kind` allow `files` yet, do the
  storage buckets exist, will the failure alert be accepted by
  `hr_notifications`?
* Has a `cloud` run *ever* happened?
* Everything it cannot see from here — the GitHub repository secrets — listed
  with who has to set each one.

It exits non-zero on anything blocking, so it is also usable as a smoke test
after a change.

---

## Why the first attempt failed

Worth thirty seconds, because it explains what you saw:

```
PGRST205  Could not find the table 'public.backup_runs' in the schema cache
PGRST202  Could not find the function public.backup_health …
```

The dashboard SQL editor runs a whole script **as one transaction**. The
migration's last section creates a storage bucket and a policy on
`storage.objects` — and `storage.objects` is owned by `supabase_storage_admin`,
not by the role the editor runs as. On many projects that final statement fails
with `42501: must be owner of table objects`, **and the failure rolls back
everything above it**. The table and all six functions disappear. The editor
does report the error, but if it scrolled past, the result looks like the
migration ran.

That section is now wrapped so it can fail without taking the rest with it. Use
**Route A** below and you will see any error printed in your terminal, in full,
with no scrolling.

---

## Route A — one command (recommended)

### Step 1 · Get a Personal Access Token

1. Open <https://supabase.com/dashboard/account/tokens>
2. **Generate new token** → name it `boswa-migrations` → **Generate**
3. Copy it. It starts with `sbp_` and is shown **once**.

> This is a full-account credential. Do not paste it into a file, a commit, or
> a chat window. It only needs to live in your terminal for the next five
> minutes; delete the token from that page afterwards if you prefer.

### Step 2 · Put it in your terminal

**PowerShell** (the default terminal in VS Code on Windows):

```powershell
$env:SUPABASE_ACCESS_TOKEN = "sbp_paste_yours_here"
```

**git bash / macOS / Linux:**

```bash
export SUPABASE_ACCESS_TOKEN=sbp_paste_yours_here
```

It lasts until you close that terminal. If you open a new one, set it again.

### Step 3 · Apply the migration

From the project root (`e:\project\boswalmsfinal`):

```bash
node scripts/apply-migration.mjs supabase/migrations/20260824120000_backup_and_restore.sql
```

**What success looks like:**

```
Project: gmdbrgjxdeztgzvqsaaj
Applying supabase/migrations/20260824120000_backup_and_restore.sql (17,412 characters)…
Applied without error.
Waiting 3s for the API schema cache to reload…

Checking what is actually in the database:

[  OK  ] backup_* functions
[  OK  ] backup_runs table
[  OK  ] row-level security on backup_runs
[  OK  ] db-backups storage bucket

Done. The database side is in place.
```

**What failure looks like** — and this is the point of using the script:

```
The database REFUSED this migration (HTTP 400):

  must be owner of table objects

Nothing was applied — the whole file runs as one transaction, so a single
failing statement rolls back everything before it.
```

You get the actual Postgres message. Take it to §4 below.

If you see `[ SKIP ] db-backups storage bucket`, that is fine — see §4.3.

### Step 4 · Deploy the edge functions

Same token as Step 2 — no `supabase login`, no Docker:

```powershell
node scripts/deploy-functions.mjs
```

It deploys every function in `supabase/functions/`, then asks each one over the
wire whether it actually answers:

```
[  OK  ] backup-report
[  OK  ] db-backup
[  OK  ] db-restore
…
All 17 function(s) are live.
```

`node scripts/deploy-functions.mjs --check` verifies without deploying.
`node scripts/deploy-functions.mjs db-backup db-restore backup-report` does
just those three.

> **✅ Done on 25 August 2026.** All 17 functions are deployed and ACTIVE.
> Before that, the project had **none** — `ingest-attendance` (the Hikvision
> sync the VPS calls every five minutes), `hr-create-user`, `create-user` and
> `reset-password` were all returning `NOT_FOUND`, so those features had been
> silently down.
>
> Two things are still outstanding, because both need a value only you have:
>
> | Secret | Needed by | Until it is set |
> |---|---|---|
> | `HIK_SYNC_SECRET` | `ingest-attendance` | Attendance still does **not** ingest — the function answers 500. Copy the value from `/opt/hik-sync-boswa/.env` on the VPS. |
> | `BACKUP_REPORT_SECRET` | `backup-report` | Only the nightly Google Drive job needs it. Set it during §6. |
>
> ```powershell
> npx supabase secrets set HIK_SYNC_SECRET=... --project-ref gmdbrgjxdeztgzvqsaaj
> ```
>
> Then confirm on the VPS: `tail -40 /var/log/hik-api-boswa.log`.

The equivalent raw CLI command, if you prefer it:

```powershell
npx supabase functions deploy --project-ref gmdbrgjxdeztgzvqsaaj --use-api
```

Then check the dashboard under **Edge Functions** — `backup-report` should show
**JWT verification: disabled** (cron on the VPS has no user session; a shared
secret stands in).

### Step 5 · Look at the page

1. Reload the LMS at `http://localhost:8080` — a hard reload, Ctrl+Shift+R.
2. Sign in as **super_admin**.
3. **Management → Backup & Restore.**

You should see the green *"Cloud backup is running"* / *"Last successful cloud
backup: never"* banner and four tabs. The yellow *"Backup is not installed"*
panel is gone.

> Seeing the yellow panel still? Press **Check again** on it. The API caches the
> schema for up to a minute. If it persists past that, go to §4.

### Step 6 · Prove it works

1. **Backup now → Back up to USB.** Choose any folder for this first test.
2. Wait for the green panel: row count, size, SHA-256.
3. **Check a backup file** → pick the file you just wrote → *"This file is a
   complete backup"*.
4. **History** tab → one green `success` row.

That is the local backup feature finished and verified. The Google Drive half
is [`BACKUP_AND_RESTORE.md` §6](./BACKUP_AND_RESTORE.md) and happens on the VPS.

---

## Route B — the dashboard, if you cannot use a token

Works, but you have to read the output carefully.

1. **Supabase → SQL Editor → New query.**
2. Open `supabase/migrations/20260824120000_backup_and_restore.sql` in VS Code.
   **Ctrl+A, Ctrl+C** — all of it. It is one file and must go in one paste.
3. Click into the editor, **Ctrl+A, Ctrl+V** to replace whatever is there.
4. **Click somewhere to deselect.** If any text is selected, the editor runs
   *only the selection* — a classic way to apply half a migration.
5. **Run** (Ctrl+Enter).
6. **Read the result panel.** Scroll it.
   * `Success. No rows returned` → good.
   * Any red error → **nothing was applied.** Note the message, go to §4.
   * Yellow `WARNING: Could not create the db-backups bucket …` → fine, and
     expected on some projects. §4.3.
7. Verify — new query, run this, expect six names:

```sql
SELECT proname FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND (proname LIKE 'backup%' OR proname = 'record_backup_run')
 ORDER BY proname;
```

```
backup_clear_table
backup_health
backup_row_counts
backup_table_columns
backup_table_order
record_backup_run
```

**Fewer than six names means it did not apply**, whatever the editor said.

8. Then Step 4, 5 and 6 of Route A. (Step 4 needs the token regardless — or
   run `npx supabase login` once instead.)

---

## 4 · When something fails

Re-check the state at any time without changing anything:

```bash
node scripts/apply-migration.mjs --check
```

### 4.1 `must be owner of table objects` (42501)

The storage policy. Already wrapped so it warns instead of failing — **if you
are seeing this as a hard error, you are running an older copy of the file.**
Re-copy `supabase/migrations/20260824120000_backup_and_restore.sql` from the
repo and run it again.

### 4.2 `function public.has_role(uuid, app_role) does not exist`

The migration depends on `has_role`, which comes from
`20260305072400_*.sql`. If that is missing, this project is not the Boswa
database. Check `VITE_SUPABASE_PROJECT_ID` in `.env` matches the project you
are pasting into.

### 4.3 `[ SKIP ] db-backups storage bucket`

Not a problem. Everything works except the **Nightly cloud backups** tab, which
needs somewhere to mirror the VPS's dumps. Make it by hand:

**Storage → New bucket** → name `db-backups` → **Public: OFF** → Create.

Then, if you want the tab as well as the bucket, add the read policy from
**Storage → db-backups → Policies → New policy → For full customization**:

* Policy name: `db-backups admin read`
* Allowed operation: **SELECT**
* Target roles: `authenticated`
* USING expression:

```sql
bucket_id = 'db-backups'
AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
```

### 4.4 Migration applied, page still shows the yellow panel

The API's schema cache. In order:

1. Press **Check again** on the panel.
2. Wait a minute and reload the page.
3. SQL Editor: `NOTIFY pgrst, 'reload schema';`
4. **Settings → General → Restart project** (about 30 seconds of downtime).

### 4.5 A "CORS error" in the browser console

**Almost always means the function is not deployed.** It is not a header
problem.

When a function slug does not exist, Supabase's gateway answers the browser's
preflight itself — and its reply allows only
`authorization, x-client-info, apikey`. It does **not** allow `content-type`,
which supabase-js sends on every call. So the browser rejects the preflight and
reports:

```
Access to fetch at '.../functions/v1/db-backup' from origin 'http://localhost:8080'
has been blocked by CORS policy: Request header field content-type is not allowed…
```

The 404 underneath is never shown. Prove it from a terminal, where CORS is not
enforced:

```bash
curl -i -X OPTIONS https://gmdbrgjxdeztgzvqsaaj.supabase.co/functions/v1/db-backup   -H 'Origin: http://localhost:8080' -H 'Access-Control-Request-Method: POST'
```

* `HTTP/1.1 404` + `{"code":"NOT_FOUND","message":"Requested function was not found"}`
  → not deployed. Do Step 4.
* `HTTP/1.1 204` → deployed; the problem is something else.

Or just run the checker, which does this for all three:

```bash
node scripts/apply-migration.mjs --check
```

> **⚠ Check the other functions too.** See the warning in Step 4: on
> 25 August 2026 all 17 edge functions on this project returned `NOT_FOUND`,
> several of them production ones. `node scripts/deploy-functions.mjs --check`
> lists the current state of every function in one go.

### 4.5b Deployed, but still refused

`npx supabase functions list --project-ref gmdbrgjxdeztgzvqsaaj` should show
all three. If a function is listed and still fails:

* **401 with no body** — the JWT expired. Sign out and in again. The gateway
  rejects an expired token before the function runs, and that reply has no CORS
  headers either, so it also surfaces as a CORS error.
* **500 immediately** — the function crashed at boot. Check its logs under
  Edge Functions → *name* → Logs.

### 4.6 `Only an administrator may take a database backup`

The signed-in account has no `admin` or `super_admin` row:

```sql
SELECT p.email, r.role
  FROM profiles p LEFT JOIN user_roles r ON r.user_id = p.user_id
 WHERE p.email = 'superAdmin@boswa.ac.bw';
```

### 4.7 Menu item missing entirely

`Backup & Restore` sits under **Management**, for `admin` and `super_admin`
only. If the whole LMS looks stale, the dev server did not pick up the new
files — stop it and `npm run dev` again.

---

## 5 · What "done" looks like

- [ ] `node scripts/apply-migration.mjs --check` → all OK (bucket may be SKIP)
- [ ] The same command's function probe shows `[ OK ]` for all three
- [ ] Backup & Restore page opens with a green banner, no yellow panel
- [ ] A test backup writes a file and the checksum panel appears
- [ ] "Check a backup file" on that file passes
- [ ] History shows one `success` row

Then continue with [`BACKUP_AND_RESTORE.md` §6](./BACKUP_AND_RESTORE.md) for the
nightly Google Drive job on the VPS.
