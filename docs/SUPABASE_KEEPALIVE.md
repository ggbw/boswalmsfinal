# Supabase keep-alive — stopping the project being paused

**Added:** 26 August 2026
**Script:** `scripts/keepalive.mjs`
**Workflow:** `.github/workflows/supabase-keepalive.yml`
**Database changes:** none. Nothing is written; every request is a read.

---

## 1. The problem

Supabase pauses **Free plan** projects that show low database activity over a
rolling **7-day** window. From the Supabase documentation:

> Typically a few user requests to the database each day over the previous week
> is enough to keep the project from being paused.

A school is precisely the user this catches. Term ends, nobody signs in for
three weeks, and the project is paused. The application is then down — not
broken, not slow, *down* — until somebody notices and presses **Resume**.

Two details make it worse than it first sounds:

* Supabase emails a warning about a week beforehand, and a confirmation once
  paused. Both go to the **project owner's** address. If that is a developer's
  personal account rather than the school's, nobody who cares will see either.
* A paused project can be restored with one click for **90 days**. After that
  it is a download-the-backup-and-restore-it job against a *new* project, with
  the connection string, the edge functions and the storage bucket all to
  redo.

The fix is to make sure the database is asked something every day.

---

## 2. What the script does

```bash
npm run keepalive
```

```
[2026-08-26 10:39:32] Keeping Supabase project gmdbrgjxdeztgzvqsaaj awake.
[2026-08-26 10:39:33]   classes            870ms  HTTP 200
[2026-08-26 10:39:34]   modules            323ms  HTTP 200
[2026-08-26 10:39:34]   departments        213ms  HTTP 200
[2026-08-26 10:39:34]   school_config      220ms  HTTP 200
[2026-08-26 10:39:34]   auth/health        189ms  HTTP 200
[2026-08-26 10:39:34] 5/5 requests answered; 4/4 were real database queries.
[2026-08-26 10:39:34] Project is awake. Activity recorded.
```

Four table reads and an auth health check. **Four rather than one**, because
Supabase counts "a few requests" and the exact threshold is not published — so
the cheap and correct thing is to exceed it comfortably. Eight queries a day
against the free quota is nothing.

### What counts as activity, and what only looks like it

This is the part worth understanding, because getting it wrong produces a job
that is green every day while the project drifts towards a pause anyway.

| Response | Query reached Postgres? | Counts? |
|---|---|---|
| `200` / `206` | yes | **yes** |
| `401` / `403` — RLS refused the rows | yes, the policy was evaluated | **yes** |
| `404` — table does not exist | **no**, PostgREST rejects it first | **no** |
| timeout / connection refused | no | **no** |

A `404` is the dangerous case: the request succeeds at the HTTP level, so a
naive `curl` in a cron job would report success forever while generating no
database activity at all. The script treats a 404 as a failure and says why:

```
nope_not_a_table   766ms  FAILED — table not found — this request never
                          reached Postgres, so it does NOT count as activity
```

### Secrets

**None.** It uses the publishable (anon) key, which already ships inside the
browser bundle and lives in the tracked `.env` for that reason. There is
nothing here worth putting in a secret store, and the script performs no write
of any kind.

---

## 3. Deploy it — pick ONE

Two paths, exactly as with the backups (`docs/BACKUP_AND_RESTORE.md`). Running
both is harmless but redundant.

### 3a. GitHub Actions — nothing to maintain

Already committed as `.github/workflows/supabase-keepalive.yml`. It runs at
**09:30 and 21:30 UTC** (11:30 and 23:30 in Botswana), twice rather than once
because GitHub's scheduler is best-effort and drops runs under load.

1. Push the branch.
2. **Actions** tab → *Supabase keep-alive* → **Run workflow** to prove it works
   now rather than tomorrow.
3. Confirm the run is green and the log shows `4/4 were real database queries`.

No secrets to configure. That is the whole setup.

> **You must read §4 if you use this path.** GitHub switches scheduled
> workflows off after 60 quiet days, which would disable this one during
> exactly the holiday it exists to cover.

### 3b. VPS cron — if you already run one

The VPS already runs the nightly backup, and **a machine you own has no 60-day
rule**, which makes this the more robust of the two.

```bash
cd /opt && git clone <repo> boswa-app     # or reuse an existing checkout
crontab -e
```

```cron
# Keep the Supabase project awake — twice daily.
30  9 * * *  cd /opt/boswa-app && /usr/bin/node scripts/keepalive.mjs >> /var/log/supabase-keepalive.log 2>&1
30 21 * * *  cd /opt/boswa-app && /usr/bin/node scripts/keepalive.mjs >> /var/log/supabase-keepalive.log 2>&1
```

Needs Node 18+ (for built-in `fetch`) and a `.env` in the checkout containing
`SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`. Both are already in the tracked
`.env`, so a plain clone is enough.

If you take this path, **disable the GitHub workflow** (Actions → *Supabase
keep-alive* → ⋯ → Disable workflow) so the run history stays meaningful.

---

## 4. The trap: GitHub disables the schedule after 60 days

GitHub disables a scheduled workflow when a repository has had **no activity
for 60 days**. Activity means a push, a release, a merged PR — not issues, not
stars.

For an ordinary cron job that is a mild annoyance. For this one it is fatal and
silent: the workflow whose entire purpose is surviving a long quiet period
would switch *itself* off during exactly that period, and the project would
pause a week later with nothing in any log explaining why.

The `keepalive-commit` job handles it. Once a day it checks how old the newest
commit is, and:

* **under 45 days** — does nothing at all. A repository being worked on
  normally never triggers this.
* **45 days or more** — writes the current time into `.github/keepalive-stamp`,
  commits it as `chore: keep scheduled workflows enabled [skip ci]`, and
  pushes. That push is the activity GitHub is looking for.

45 rather than 59 leaves a fortnight of margin for a run that GitHub skips.
Because the push itself resets the counter, a dormant repository gets about
eight of these commits a year — the price of the schedule still being alive
when term starts again.

The job is `needs: ping` and `if: github.event_name == 'schedule'`, so pressing
**Run workflow** to test a ping never commits to `main`. It is the only job
granted `contents: write`.

Nothing reads `.github/keepalive-stamp`. It exists only to be changed.

---

## 5. What this cannot do

**It cannot un-pause a paused project.** Once Supabase pauses a project the API
stops answering, so nothing the script sends arrives. Keep-alive is prevention
only.

If the project has already paused, the script says so rather than reporting a
vague network error:

```
NO database query succeeded — this run generated no activity.

  The project appears to be PAUSED or down.
  Keep-alive cannot resume a paused project — nothing it sends arrives.
  Go to https://supabase.com/dashboard/project/<ref> and press Resume.
  A paused project can only be restored for 90 days. After that it is
  a download-and-restore job, not a button.
```

A failed run exits non-zero, which turns the Actions run red and emails the
repository owner. **That is the entire alerting mechanism** — deliberately, so
there is no second thing to configure and keep working. If you would rather be
told another way, point a monitor at the workflow.

---

## 6. Does the nightly backup already cover this?

Partly, and not reliably enough to depend on.

`db-backup.yml` connects to the database every night, and a `pg_dump` is
certainly database activity. So while the backup is running, the project will
not pause.

That is not the same as being covered:

* The backup is one job. If it is disabled, fails, or has its secrets rotated,
  the keep-alive disappears with it — and the two failures look identical from
  the outside (a red Actions run), so the pause arrives as a surprise.
* `db-backup.yml` is scheduled, so it is subject to the same 60-day disable
  described in §4.
* A backup is a heavy job with a real failure surface — Drive tokens,
  `pg_dump` version drift, disk. A keep-alive should be the most boring thing
  in the repository, because it is the thing that keeps everything else
  reachable.

Keep both. They cost nothing and they fail independently, which is the point.

---

## 7. The permanent fix

Upgrade the project to the **Pro plan**. Paid projects are never paused for
inactivity, and none of this is needed.

Everything above exists because the project is on the Free plan. It is a
mitigation, not a guarantee: if the school's data matters enough to back up
nightly to Google Drive, it is worth asking whether it also warrants not being
one quiet fortnight away from an outage.

---

## 8. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Missing SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY` | no `.env` in the working directory, or the cron job did not `cd` first | use the `cd /opt/... && node ...` form in §3b |
| Every table `FAILED — table not found` | tables renamed | set `KEEPALIVE_TABLES=a,b,c`, or edit `DEFAULT_TABLES` |
| `The project appears to be PAUSED` | it is | dashboard → **Resume**; check the 90-day window |
| Workflow stopped running, no runs listed | GitHub disabled it after 60 quiet days | Actions → *Supabase keep-alive* → **Enable workflow**, then check §4 is working |
| `keepalive-commit` fails on `git push` | branch protection on `main` | allow `github-actions[bot]`, or use the VPS path in §3b |
| Runs are green but the project paused anyway | the pings were 404s, or ran less often than daily | check the log says `were real database queries`; confirm both schedules fire |

---

## 9. Verifying it

```bash
npm run keepalive                                    # expect: 4/4 real queries, exit 0
KEEPALIVE_TABLES=nope node scripts/keepalive.mjs     # expect: 404 warning, exit 1
SUPABASE_URL=https://nope.supabase.co npm run keepalive   # expect: "appears to be PAUSED", exit 1
```

All three were run against this project on 26 August 2026 and behave as
described. In the Supabase dashboard, **Reports → API Gateway** shows the
requests arriving twice a day; that is the ground truth that the schedule is
firing.
