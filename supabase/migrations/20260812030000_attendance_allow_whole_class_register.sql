-- ============================================================================
-- Make the class register writable
-- ============================================================================
-- Live inspection on 2026-08-12 (public.attendance, 0 rows):
--
--   columns      id, student_id, class_id, date, status, module_id
--                → NO `session` column; module_id nullable with no default
--   constraints  attendance_pkey (id)
--                attendance_student_id_fkey  → students(id)
--                attendance_class_id_fkey    → classes(id)
--                attendance_module_id_fkey   → modules(id)
--                attendance_student_class_date_key      UNIQUE (student_id, class_id, date)
--                attendance_student_id_class_id_date_key UNIQUE (student_id, class_id, date)
--
-- That is the ORIGINAL 2026-03-05 schema plus a module_id column added by hand
-- through the dashboard. Migration 20260706000000_attendance_start_end_sessions
-- was written but NEVER APPLIED to this database, so the live table is three
-- revisions behind the code. This migration therefore does that work too — it
-- supersedes 20260706000000, which remains idempotent and harmless if it is
-- ever run afterwards.
--
-- FOUR separate reasons no register has ever saved:
--
--   1. The app sends a `session` value; the column does not exist, so PostgREST
--      rejects the whole write.
--   2. attendance_student_id_fkey references students(id) while the app wrote
--      s.studentId (the human number). Confirmed empirically: `marks` sits under
--      the same FK and stores record keys — 20/20 match students.id, 0 match
--      students.student_id. FIXED IN THE APP; the FK is correct and is kept.
--   3. UNIQUE (student_id, class_id, date) permits one register per student per
--      day, so start + end could never coexist, and neither could two modules on
--      the same day. Present twice, under two names.
--   4. attendance_module_id_fkey → modules(id), while the register's
--      "— Whole class (no module) —" option needs a value no module can match.
--
-- Why module_id becomes NOT NULL DEFAULT '' rather than staying nullable:
--   Postgres treats NULLs as distinct in a unique index, so two whole-class
--   registers for the same student/class/date/session would not collide and
--   duplicates would slip through. Avoiding that with a nullable column needs an
--   expression index on COALESCE(module_id,''), and PostgREST's on_conflict can
--   only name plain columns — so the app's atomic upsert could no longer target
--   it. An empty-string sentinel keeps the index on plain columns and the upsert
--   atomic. That in turn makes the module FK unsatisfiable, which is why it goes.
--
-- The student_id and class_id foreign keys are LEFT IN PLACE. Those are correct
-- and the app now satisfies them.
--
-- The table is empty, so nothing is converted and nothing can be lost.
--
-- Idempotent: safe to run more than once.
-- ============================================================================


-- ── 1. The missing `session` column ─────────────────────────────────────────
-- 'start' = register taken at the beginning of the lesson (Present/Absent/Late)
-- 'end'   = register taken at the end of the lesson      (Present/Absent)
ALTER TABLE public.attendance
  ADD COLUMN IF NOT EXISTS session TEXT NOT NULL DEFAULT 'start';


-- ── 2. module_id: '' means whole-class, so it must not be NULL ───────────────
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS module_id TEXT;
UPDATE public.attendance SET module_id = '' WHERE module_id IS NULL;  -- 0 rows today
ALTER TABLE public.attendance ALTER COLUMN module_id SET DEFAULT '';
ALTER TABLE public.attendance ALTER COLUMN module_id SET NOT NULL;


-- ── 3. The module FK cannot coexist with the '' sentinel ────────────────────
ALTER TABLE public.attendance DROP CONSTRAINT IF EXISTS attendance_module_id_fkey;


-- ── 4. Retire the one-register-per-day uniqueness ───────────────────────────
-- Two constraints enforce the same thing under different names, and there may be
-- bare indexes too. Match on the exact column set rather than by name, so this
-- works whatever the drift has produced.
DO $$
DECLARE
  con text;
  idx text;
BEGIN
  -- UNIQUE/PK constraints on exactly (student_id, class_id, date)
  FOR con IN
    SELECT c.conname
      FROM pg_constraint c
     WHERE c.conrelid = 'public.attendance'::regclass
       AND c.contype IN ('u', 'p')
       AND (SELECT array_agg(a.attname::text ORDER BY a.attname)
              FROM unnest(c.conkey) k
              JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k)
           = ARRAY['class_id', 'date', 'student_id']
  LOOP
    EXECUTE format('ALTER TABLE public.attendance DROP CONSTRAINT %I', con);
    RAISE NOTICE 'dropped constraint %', con;
  END LOOP;

  -- Standalone unique indexes on the same columns, with no backing constraint
  FOR idx IN
    SELECT i.indexrelid::regclass::text
      FROM pg_index i
     WHERE i.indrelid = 'public.attendance'::regclass
       AND i.indisunique
       AND NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conindid = i.indexrelid)
       AND (SELECT array_agg(a.attname::text ORDER BY a.attname)
              FROM unnest(i.indkey) k
              JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k)
           = ARRAY['class_id', 'date', 'student_id']
  LOOP
    EXECUTE format('DROP INDEX %s', idx);
    RAISE NOTICE 'dropped index %', idx;
  END LOOP;
END $$;


-- ── 5. One row per student, class, module, date AND register ────────────────
-- Plain columns only, so the app's upsert can target it via on_conflict.
CREATE UNIQUE INDEX IF NOT EXISTS attendance_unique_register
  ON public.attendance (student_id, class_id, module_id, date, session);


-- ── 6. The summary report filters by class and date range ───────────────────
-- Attendance will be the fastest-growing table here (~140 students × 2 registers
-- × 5 days ≈ 1,400 rows a week).
CREATE INDEX IF NOT EXISTS attendance_class_date_idx
  ON public.attendance (class_id, date);


-- ── Verify ──────────────────────────────────────────────────────────────────
-- Expect: has_session = true
--         module_id_not_null = true
--         foreign_keys = attendance_class_id_fkey, attendance_student_id_fkey
--         unique_indexes = attendance_unique_register   (the date-only ones gone)
SELECT
  (SELECT count(*) > 0 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='attendance' AND column_name='session')   AS has_session,
  (SELECT is_nullable = 'NO' FROM information_schema.columns
    WHERE table_schema='public' AND table_name='attendance' AND column_name='module_id') AS module_id_not_null,
  (SELECT coalesce(string_agg(conname, ', ' ORDER BY conname), 'none')
     FROM pg_constraint
    WHERE conrelid='public.attendance'::regclass AND contype='f')                        AS foreign_keys,
  (SELECT coalesce(string_agg(indexrelid::regclass::text, ', ' ORDER BY indexrelid::regclass::text), 'none')
     FROM pg_index
    WHERE indrelid='public.attendance'::regclass AND indisunique)                        AS unique_indexes,
  (SELECT count(*) FROM public.attendance)                                               AS rows_today;
