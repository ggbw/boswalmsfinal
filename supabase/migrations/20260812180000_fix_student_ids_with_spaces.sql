-- ============================================================================
-- Two student IDs contain stray spaces
-- ============================================================================
--   Joy Uqueio                 'BCI2024D 43'   (space where a hyphen belongs)
--   Amantle A Mimi Motlogelwa  'BCI2025C- 15'  (hyphen followed by a space)
--
-- Why this matters more than it looks: assessment_marks is keyed on the student
-- NUMBER as text, not on students.id. So the ID on the student record and the ID
-- on every mark must match character for character, spaces included. Anything
-- that trims or normalises on one side and not the other and the student's marks
-- stop matching their record — the same silent mismatch that made the entire
-- legacy `marks` table invisible to the app.
--
-- Amantle has 36 marks keyed on the spaced version. Correcting her student
-- record alone would orphan every one of them, so both are updated together in
-- one transaction. Joy has none, so hers is a straight rename.
--
-- profiles.student_id is updated too — it is how a signed-in student is matched
-- to their record, and how my_student_number() resolves ownership for the
-- assessment_marks policies.
--
-- The UNIQUE constraint on students.student_id is live (students_student_id_key),
-- so a collision would fail loudly rather than silently merge two students. The
-- check below makes that an explicit, readable error instead.
--
-- Idempotent: once the IDs are corrected the loop matches nothing.
-- ============================================================================

DO $$
DECLARE
  fixes text[][] := ARRAY[
    ARRAY['BCI2024D 43',  'BCI2024D-43'],
    ARRAY['BCI2025C- 15', 'BCI2025C-15']
  ];
  f        text[];
  n_marks  int;
  n_prof   int;
BEGIN
  FOREACH f SLICE 1 IN ARRAY fixes LOOP
    IF NOT EXISTS (SELECT 1 FROM public.students WHERE student_id = f[1]) THEN
      RAISE NOTICE 'already corrected or not present: %', f[1];
      CONTINUE;
    END IF;

    IF EXISTS (SELECT 1 FROM public.students WHERE student_id = f[2]) THEN
      RAISE EXCEPTION 'Cannot rename % to % — that ID is already in use by another student', f[1], f[2];
    END IF;

    -- Marks and profile first, then the student record. No foreign key ties
    -- them, so nothing enforces this ordering — it is done so that if the
    -- transaction were ever interrupted, the student record is the last thing
    -- to change rather than the first.
    UPDATE public.assessment_marks SET student_id = f[2] WHERE student_id = f[1];
    GET DIAGNOSTICS n_marks = ROW_COUNT;

    UPDATE public.profiles SET student_id = f[2] WHERE student_id = f[1];
    GET DIAGNOSTICS n_prof = ROW_COUNT;

    UPDATE public.students SET student_id = f[2] WHERE student_id = f[1];

    RAISE NOTICE '% → %  (% marks, % profile row(s) moved)', f[1], f[2], n_marks, n_prof;
  END LOOP;
END $$;


-- ── Verify ──────────────────────────────────────────────────────────────────
-- Expect: no IDs containing whitespace anywhere, and Amantle still holding her
-- 36 marks under the corrected ID.
SELECT 'students with whitespace in their ID' AS item,
       coalesce(string_agg(student_id || ' (' || name || ')', ', '), 'none') AS result
  FROM public.students WHERE student_id ~ '\s'
UNION ALL
SELECT 'profiles with whitespace in student_id',
       coalesce(string_agg(student_id, ', '), 'none')
  FROM public.profiles WHERE student_id ~ '\s'
UNION ALL
SELECT 'assessment_marks with whitespace in student_id',
       coalesce(count(*)::text, '0')
  FROM public.assessment_marks WHERE student_id ~ '\s'
UNION ALL
SELECT 'marks now under the corrected IDs',
       coalesce(string_agg(x.student_id || ' = ' || x.n::text, ', '), 'none')
  FROM (SELECT student_id, count(*) AS n FROM public.assessment_marks
         WHERE student_id IN ('BCI2024D-43', 'BCI2025C-15')
         GROUP BY student_id) x
UNION ALL
SELECT 'orphaned marks (no matching student)',
       count(*)::text
  FROM public.assessment_marks am
 WHERE NOT EXISTS (SELECT 1 FROM public.students s WHERE s.student_id = am.student_id);
