-- ============================================================================
-- Make the class register writable
-- ============================================================================
-- Live check on 2026-08-12: public.attendance has ZERO rows. Not "few" — none.
-- No register has ever saved. Two live foreign keys make every write the app
-- attempts fail:
--
--   1. attendance_student_id_fkey → students(id), while AttendancePage wrote
--      s.studentId (the human number, e.g. BCI2025D-52). Confirmed empirically:
--      `marks` sits under the same FK and stores record keys — 20/20 match
--      students.id, 0 match students.student_id.
--      → Fixed in the app: the register now writes students.id. No migration
--        needed for this half, and the FK is deliberately kept.
--
--   2. attendance_module_id_fkey → modules(id), while the register's
--      "— Whole class (no module) —" option writes module_id = ''.
--      → Fixed here. See below.
--
-- Why the module FK has to go rather than module_id becoming nullable:
--
--   The natural fix is module_id NULL for "no module", keeping the FK (an FK
--   permits NULL). But Postgres treats NULLs as distinct in a unique index, so
--   two whole-class registers for the same student/class/date/session would no
--   longer collide — duplicate rows would slip straight through. Avoiding that
--   needs an expression index on COALESCE(module_id,''), and PostgREST's
--   on_conflict parameter can only name plain columns, so the app's upsert
--   could no longer target it. The register would have to become a
--   delete-then-insert, losing atomicity, to satisfy a constraint that only
--   protects a column the app already validates against its own module list.
--
--   Keeping module_id NOT NULL DEFAULT '' and dropping the FK keeps the unique
--   index on plain columns, keeps the upsert atomic, and matches what
--   20260706000000_attendance_start_end_sessions.sql already documented ('' =
--   whole class). The FK was added to prod out-of-band and contradicts that.
--
-- The student_id and class_id foreign keys are LEFT IN PLACE. Those are correct
-- and the app now satisfies them.
--
-- No data migration: the table is empty, so there is nothing to convert.
--
-- Idempotent: safe to run more than once.
-- ============================================================================

ALTER TABLE public.attendance DROP CONSTRAINT IF EXISTS attendance_module_id_fkey;

-- Belt and braces: the register's uniqueness must be on plain columns for the
-- app's upsert (on_conflict) to target it. Recreate if absent.
CREATE UNIQUE INDEX IF NOT EXISTS attendance_unique_register
  ON public.attendance (student_id, class_id, module_id, date, session);

-- The summary report filters by class and date range; attendance is the fastest
-- growing table in the system (≈140 students × 2 registers × 5 days a week).
CREATE INDEX IF NOT EXISTS attendance_class_date_idx
  ON public.attendance (class_id, date);


-- Confirm: expect student_id + class_id FKs only, and no module FK.
SELECT
  (SELECT coalesce(string_agg(conname, ', '), 'none')
     FROM pg_constraint
    WHERE conrelid = 'public.attendance'::regclass AND contype = 'f')      AS foreign_keys,
  (SELECT coalesce(string_agg(indexrelid::regclass::text, ', '), 'none')
     FROM pg_index
    WHERE indrelid = 'public.attendance'::regclass)                        AS indexes,
  (SELECT count(*) FROM public.attendance)                                 AS rows_today;
