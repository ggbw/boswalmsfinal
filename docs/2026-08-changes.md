# Boswa CIB SMS — changes, week of 12 August 2026

What began as an investigation into ten reported faults became a substantial
repair and extension of the system. This is the record of what was found, what
was changed, and what remains.

Every claim below was checked against the live database rather than inferred
from the code, because the two turned out to disagree repeatedly.

---

## 1. The ten reported issues

| # | Reported | What was actually true |
|---|---|---|
| 1 | No downloadable attendance | **Attendance had never saved a single row.** Four independent causes. Export added afterwards. |
| 2 | Students not seeing assignments | Confirmed — four separate causes, including attachments that could never be opened |
| 3 | Lecturers not seeing assignments | Confirmed — one line of code filtered by *who created* an assignment rather than who teaches it |
| 4 | Some users cannot log in | Confirmed — 15 accounts could authenticate and were then bounced to the login screen |
| 5 | Unique passwords / forced change | **Neither was in place.** 138 accounts shared two passwords published in this repository |
| 6 | Lecturers see all students | Confirmed, and enforced nowhere — the database granted every lecturer every student record |
| 7 | Can one lecturer teach many modules? | **Yes — this already worked correctly.** No change needed |
| 8 | Random day-to-day inconsistency | Not random. Failures were silent, so a failed query and an empty table looked identical |
| 9 | Does the timetable create modules? | **No.** But an unfiltered dropdown made it appear so |
| 10 | Accepted file types and sizes | Answered, then enforced |

### 1.1 Attendance — the largest single fault

`public.attendance` contained **zero rows**. Not "few" — none, ever. Four
independent causes, each sufficient on its own:

1. The app sent a `session` value; the column did not exist, so PostgREST
   rejected every write.
2. `attendance_student_id_fkey` requires `students.id`, but the register wrote
   the human student number.
3. `UNIQUE (student_id, class_id, date)` permitted one register per student per
   day, so start and end registers could never coexist.
4. `attendance_module_id_fkey` could never be satisfied by the "whole class"
   option, which needs a value no module can match.

Root cause of (1) and (3): migration `20260706000000` was **committed but never
applied**. It also contained a type error (`name[] = text[]`) that would have
made it fail if anyone had tried — which is very likely why it was abandoned.

**Fixed.** Registers now save, both start and end, per module or whole class,
with a CSV export on the summary report.

### 1.2 Passwords

Every student shared `BoswaStudent2026!`; every staff member shared
`BoswaStaff2026!`. Both are hardcoded in this repository, and student emails are
derived from student numbers — so both halves of the credential were guessable.

`must_change_password` was set on **zero** of 151 profiles. The forced-change
screen existed and worked; nothing had ever set the flag.

**Fixed.** Every account-creation path now issues a unique password and sets the
flag. 150 existing accounts were flagged to change at next sign-in.

> Note: setting the flag does not change a password. Until someone signs in,
> theirs is still the shared one. Administrators were deliberately excluded from
> the forced change.

---

## 2. Found without being asked

These were not in the brief. Several were more serious than the reported faults.

| Finding | Severity |
|---|---|
| `lecturer_modules` was **readable and writable without logging in** — a policy with no `TO` clause defaults to `PUBLIC`. Wiping it would have stripped every lecturer of their classes, students and registers | Critical |
| Three tables had **RLS switched off entirely**, including `employee_leave_balances` — named staff leave balances, readable by anyone with the publishable key | High |
| `assessment_marks` **write policies allowed any signed-in user** — a student could award themselves marks in the table reports actually use | High |
| `seed-faculty` had **no caller check at all** — any signed-in user, including a student, could create staff accounts | High |
| Deleting a user removed their profile and role but **left the login working** — the source of the 15 orphaned accounts, and it would have kept recurring | High |
| The legacy `marks` table was **invisible to seven screens** — keyed by record id, filtered by student number | Medium |
| Progression approval **always failed** — it checked a table that always returned nothing, so nobody could be promoted | Medium |
| `student-photos` was a **public bucket** — every student photograph fetchable by URL with no login | Medium |
| Nine pages excluded **`super_admin`** from actions, including assigning lecturers to modules | Medium |
| Two student IDs contained **stray spaces**; one had 36 marks attached to the spaced version | Medium |
| Two staff had **duplicate accounts**; one was created by a repair earlier in the same week | Medium |

---

## 3. What changed

### 3.1 Security and access

- Closed unauthenticated read access on three tables and the `module-notes` bucket
- Closed anonymous **write** access to `lecturer_modules`
- Scoped personal data: students now read only their own marks, attendance,
  submissions and module enrolments; admissions data is staff-only
- `student-photos` made private, with the app moved to signed URLs
- Assignment attachments and submissions moved out of the database into a
  private bucket
- `super_admin` granted the access it had always been assumed to have

**Deliberately not done:** per-lecturer scoping is *not* enforced in the
database. Staff see all student records at the database level and are scoped in
the app. Encoding "this lecturer, these classes" into a policy is where screens
break; this can be tightened later against real usage.

**Left open by instruction:** the HR side. `attendance_records`,
`attendance_devices` and `attendance_settings` remain readable by every
signed-in account, students included.

### 3.2 Data integrity

- Attendance now records, keyed correctly, with start/end and per-module registers
- Student IDs with spaces corrected — including moving 36 marks in the same
  transaction so none were orphaned
- Student ID generation made collision-free; IDs normalised on save
- 4 orphaned staff accounts repaired, 2 duplicates merged, 11 abandoned accounts
  removed
- Every account now has exactly one profile and one role: **153 / 153 / 153**

### 3.3 Marks

The system had two marks tables. `assessment_marks` (3,200+ rows) is the real
one. The legacy `marks` table (20 rows) was keyed by record id while every
screen filtered by student number, so it matched nothing.

All seven affected screens were moved to `assessment_marks`, reusing the
weighting already proven in Reports and Transcripts rather than writing a second
implementation. **`marks` now has no readers anywhere in the app.**

> The table itself was left in place. All 20 rows are duplicated in
> `assessment_marks`, so it can be dropped whenever convenient — deliberately,
> not as a side effect.

### 3.4 Diagnosis

Every query result was previously read as `(res.data || [])`, so a failed query
and an empty table were indistinguishable — to users and to anyone
investigating. This is the single biggest reason these faults looked random.

Failures are now surfaced in a banner naming the table and the error. It caught
two real problems within minutes during this week's work.

The tables that outgrow the 1,000-row response cap are now paged in a stable
order. Attendance alone will add roughly 1,400 rows a week.

---

## 4. New features

### 4.1 Timetable as an uploaded document

Replaces the slot-by-slot builder. An admin uploads a Word or Excel timetable;
everyone views it rendered read-only and can download the original; only an
admin can upload or delete. A notification is broadcast on upload, and previous
versions stay browsable.

Excel is rendered as a real table honouring merged cells, built from cell values
rather than injected HTML. Word is converted and sanitised.

> The old `timetable` table and its 65 slot rows were **not** dropped. Nothing
> reads them, but deleting a year of scheduling data as a side effect of a
> feature swap would be irreversible.

### 4.2 Principal and Deputy Principal

Two read-only, whole-school roles. The Principal sees admissions and operational
health; the Deputy's remit is academic.

### 4.3 Role-specific dashboards

| Role | Answers |
|---|---|
| Student | What do I need to do, and how am I doing? |
| Lecturer | What is waiting on me? |
| HOD | How is my department doing, and what needs chasing? |
| Principal / Deputy | How is the school doing? |

Figures come from database aggregates rather than filtering arrays in the
browser — one small request per dashboard, and the cost stays flat as data
grows.

### 4.4 Supplementaries, retakes and registration

```
Module result = coursework + practical + final exam

  ≥50%                        → passed
  <50% and a final exam <45%  → supplementary (resit the exam only)
  <50% and finals ≥45%        → retake (failed on coursework)

Supplementary pass mark 50%, recorded as 50% however high the score.
Retake = the module in full, with whichever class is running it.
No limit on retake attempts.

End of semester: up to 2 unpassed modules → progress, carrying them.
                 3 or more               → discontinued.
```

Progression is **automatic** — nobody approves it. The moment every module a
student took has a settled outcome and no supplementary is outstanding, they are
told they have passed and invited to register. An admin then approves the
**registration**, which is what enrols them and moves their year and semester.

A retaking student stays in their own cohort and sits the module with another
class. The enrolment records which class, so the module's assessments resolve
correctly.

Outcomes are **stored, not recomputed**. They are decisions with consequences,
and a late mark correction should be visible as a change rather than silently
un-failing someone already told to retake.

### 4.5 Smaller additions

- Attendance CSV export
- Collapsible sidebar, remembered between sessions
- Upload file-type and size limits, enforced by the storage buckets rather than
  only in the browser
- Timetable module dropdown filtered to the class's own modules
- User Management rebuilt as one row per person, with Delete split into
  "Remove login" and "Delete student record" — previously one label for two very
  different actions
- `delete-user` function, so deleting a user removes their login

---

## 5. Migrations

Twenty, all applied. In order:

| File | Purpose |
|---|---|
| `…000000_close_open_data` | RLS on three exposed tables; `module-notes` bucket made private |
| `…010000_require_password_change` | Forced password change for 150 non-admin accounts |
| `…020000_super_admin_profiles_roles` | `super_admin` could read only its own role row |
| `…030000_attendance_allow_whole_class_register` | The `session` column, key fixes, unique index |
| `…040000_assignment_files_to_storage` | Path columns and a private bucket for coursework |
| `…050000_assignment_write_roles` | super_admin / HOD / HOA could not create or grade |
| `…060000_fix_public_apply_and_lecturer_modules` | Restored the public apply form; closed anonymous writes |
| `…070000_scope_personal_data` | Students see their own marks and attendance only |
| `…080000_close_student_photos_bucket` | Student photographs made private |
| `…090000_timetable_documents` | Uploaded-timetable table, bucket and policies |
| `…110000_repair_orphaned_staff_accounts` | Four staff who could authenticate but never log in |
| `…120000_rename_hoy_to_hoa` | `hoy` → `hoa` throughout |
| `…130000_merge_duplicate_staff_accounts` | Two duplicates merged, module assignments preserved |
| `…140000_delete_orphaned_accounts` | 11 accounts with no profile |
| `…150000_fix_hoy_in_function_bodies` | A function body still naming the renamed enum value |
| `…160000_add_principal_roles` | The two new roles |
| `…170000_dashboard_stats` | Dashboard aggregate functions and oversight read access |
| `…180000_fix_student_ids_with_spaces` | Two IDs corrected; 36 marks moved with one of them |
| `…190000_registration_supp_retake` | Registration, registration modules, module outcomes |
| `…200000_student_modules_class` | Which class a student takes a module with |

`20260812070000_close_lecturer_modules_public_write` is superseded by `060000`
and need not be run.

---

## 6. Lessons that will recur

**Migration files do not reflect this database.** `20260706000000` was committed
and never applied. Columns have been added by hand. Always inspect the live
schema before writing a migration.

**`DROP POLICY IF EXISTS "name"` fails silently on a wrong name**, and the names
here do not match the files. `lecturer_modules` carried a policy called
"Allow all" where the file said "Allow all for authenticated" — so the drop
matched nothing and the table stayed world-writable. Drop by role or column set.

**A policy with no `TO` clause applies to `PUBLIC`, not authenticated.**

**Renaming an enum value is transparent to policies but not to function
bodies** — those are stored as text and re-parsed, so a literal inside one keeps
referring to a label that no longer exists.

**`assessment_marks` is keyed on a human-typed student number**, not a record
id. That is the root of three separate faults this week. Worth revisiting.

---

## 7. Outstanding

### Needs doing in the app

- Link **Escoffiers** and **Soyers** to their modules — 26 students currently see
  no assignments or notes
- Assign modules to the **6 teaching staff who have none** — they see no
  classes, no students, and cannot take a register
- **Provision the 6 active students with no login**
- Assign the **Principal** role
- Confirm whether **three Heads of Academics** is intended

### Untested

Nothing from this week has been used in anger. Worth confirming in order:

1. A student's marks matching Reports — everything else reads through that path
2. Taking and saving an attendance register
3. Each dashboard with a real account
4. The registration flow end to end with **one** student before anyone else

### Open questions

- Should Principal and Deputy reach **Modules** and **Module Mapping**? They can
  navigate there directly, though it is not in their menu
- The legacy **`marks`** table can be dropped once a full term has run
- **HR tables** remain readable by every account, students included — excluded
  from this work by instruction
- Attendance is still bulk-loaded into the browser. Paging fixed correctness;
  loading a year of registers on every page load is still the wrong shape
