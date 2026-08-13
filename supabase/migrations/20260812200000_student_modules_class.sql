-- ============================================================================
-- Record WHICH class a student takes a module with
-- ============================================================================
-- A student retaking a module stays in their own cohort but sits that module
-- with whichever class is running it. So "which class is this student attending
-- for this module" is no longer always "their own class" — and nothing recorded
-- the difference.
--
-- The consequence today is not limited to retakes. Mark computation resolves a
-- module's assessments as:
--
--   db.exams.filter(e => e.classId === student.classId && e.moduleId === …)
--
-- so ANY module a student takes outside their own class finds zero assessments
-- and reads as unmarked. That already affects the per-student overrides in
-- student_modules, which is a live bug rather than one this feature introduces.
--
-- Fix: the enrolment carries the class. Resolution becomes "the enrolment's
-- class if set, otherwise the student's own class" — one rule covering ordinary
-- modules, per-student overrides and retakes identically.
--
-- NULLABLE on purpose. Existing rows keep exactly today's behaviour (fall back
-- to the student's class), so this changes nothing until a row is written with a
-- class — which only the registration-approval step does.
--
-- Idempotent: safe to run more than once.
-- ============================================================================

ALTER TABLE public.student_modules
  ADD COLUMN IF NOT EXISTS class_id TEXT REFERENCES public.classes(id);

COMMENT ON COLUMN public.student_modules.class_id IS
  'Class whose offering of this module the student attends. NULL means their own class. Set for retakes, where the student sits the module with a different cohort.';

-- The mark path looks up a student''s enrolments on every render.
CREATE INDEX IF NOT EXISTS student_modules_student_idx
  ON public.student_modules (student_id);


-- ── Verify ──────────────────────────────────────────────────────────────────
-- Expect the column present, and every existing row still NULL (unchanged).
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema='public' AND table_name='student_modules' AND column_name='class_id') = 1 AS column_added,
  (SELECT count(*) FROM public.student_modules)                       AS enrolment_rows,
  (SELECT count(*) FROM public.student_modules WHERE class_id IS NOT NULL) AS rows_with_a_class;
