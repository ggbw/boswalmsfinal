# UAT on the live instance: snapshot and wipe

UAT runs on the live database, boswa-live (the client's Supabase project). The live data stays. Everything UAT does to the LMS academic tables is undone at go-live. HR and payroll stay live throughout and are never touched.

Every script is pasted into the Supabase SQL editor for boswa-live (or run with psql).

The snapshot was taken on 16 Oct 2026 at 07:56 UTC. The UAT test cohort — `UAT Class`, students `UAT-01`…`UAT-10` and the `uat.*@uat.boswa.ac.bw` logins — was created after it, so the wipe removes it. The banner shown during UAT is switched off by setting `VITE_UAT_MODE` to `"false"` in `.env`.

| Step | Script | When | Changes data? |
|---|---|---|---|
| 1 | `01_take_snapshot.sql` | Once, just before UAT starts | No. It copies the data into a private `uat_snapshot` schema |
| 1b | `05_protect_hr_data.sql` | Once, any time before step 3 | No. It replaces two functions so the wipe can never change HR or payroll |
| 2 | `02_check_uat_changes.sql` | Any time; always before step 3 | No |
| 3 | `03_wipe_uat_data.sql` | Once, at go-live | Yes: LMS tables only, plus UAT logins |
| 4 | `04_drop_snapshot.sql` | About two weeks after go-live | Drops the snapshot copy |

## What gets wiped

- **LMS tables (29):** they're put back exactly as they were at the snapshot. Rows UAT added are deleted. Live rows UAT edited or deleted are restored. The list is in `uat_snapshot._lms_tables`.
- **Login accounts created after the snapshot:** deleted, unless they're linked to an employee record or hold an HR or payroll role (`employee`, `hr`, `accountant`). Any other real account can be kept with `keep_emails`.
- **UAT accounts that HR or payroll rows point at** (for example, a UAT login that approved a leave or created a payslip) are kept with sign-in blocked, not deleted. Deleting them would make Postgres blank or delete those HR rows. This needs `05_protect_hr_data.sql`.
- **Files uploaded to LMS buckets:** listed by `uat_snapshot.new_files()`. Storage doesn't allow deleting files through SQL, so these are removed by hand.

## What is never touched

Employees, contracts, payslips, pay components, loans, advances, leave, staff attendance (`attendance_records` and the Hikvision device), workflows, HR notifications and settings.

Existing users' `profiles` and `user_roles` are reported but never changed.

**Enforced, not just intended** (after `05`): the wipe locks every non-LMS table, fingerprints it, and checks it again at the end. If a single HR, payroll or settings row would change, the whole wipe rolls back. Only `profiles`/`user_roles` (the UAT accounts' own rows) and `audit_logs` are exempt.

Anything done in HR or payroll during UAT is real and stays, including what UAT logins do there. Testers should not use the HR and payroll screens.

## Changes made because of UAT are live and are kept

We'll fix things based on what UAT finds. Those fixes belong to the live system, and the wipe must never undo them.

**Code is never rolled back.** That covers the app code (GitHub and Lovable), edge functions, RLS policies, database functions, triggers and table structure, including new tables and columns. The wipe only puts table rows back.

A migration can also change LMS data. The snapshot needs to know about that, or the wipe would undo it. After every migration that touches an LMS table, run whichever of these applies, **before testers use the change**:

| The migration… | Run straight after it |
|---|---|
| adds an LMS table | `select uat_snapshot.track_new_table('exam_attendance', 185);` (rows the migration seeds are kept) |
| adds columns to LMS tables, or backfills them | `select * from uat_snapshot.after_migration();` |
| fixes live LMS rows, or seeds config/reference rows | `select uat_snapshot.keep_live_rows('exams', 'p.mark = 0');` (`p` is the live row; the condition picks the rows to keep as they are now) |
| deletes live LMS rows | run the same `DELETE` against `uat_snapshot.<table>` as well |

`uat_snapshot.diff()` flags any new table or column that wasn't recorded, so the dry run before go-live catches anything missed.

## Rules for the UAT period

- From the moment step 1 runs, **nothing real may be entered in the LMS**. Any real entry is wiped at go-live.
- **New LMS tables:** when a migration adds a new LMS table during UAT, run `select uat_snapshot.track_new_table('<table>', <order>);` right after it. Otherwise its UAT rows survive the wipe. `diff()` flags any untracked table.
- **Uploads:** don't replace a real student's photo or document. A replaced file can't be restored, so test uploads on UAT students only.
- **Announcements:** live students can see UAT announcements, so start every title with "UAT TEST".

## Safety

- `restore()` runs as one statement. If any step fails, or the final check finds a single row that differs from the snapshot, everything rolls back.
- It refuses to run without the phrase `'WIPE UAT DATA'`.
- Step 1 refuses to run a second time, so the snapshot can't be overwritten with UAT data.
