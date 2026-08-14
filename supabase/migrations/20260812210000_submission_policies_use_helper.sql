-- ============================================================================
-- Students could be unable to submit their own work
-- ============================================================================
-- The two submission policies from 20260812040000 read profiles.student_ref
-- directly:
--
--   (storage.foldername(name))[3] IN (
--     SELECT p.student_ref FROM public.profiles p WHERE p.user_id = auth.uid()
--   )
--
-- profiles carries TWO links to a student — student_ref (students.id) and
-- student_id (the human number) — and older rows may have only one. A student
-- whose profile holds only student_id resolves to NOTHING here, which means:
--
--   • they cannot UPLOAD a submission — the WITH CHECK fails, so the file is
--     refused and the assignment cannot be handed in
--   • they cannot READ their own submitted file back
--
-- Both fail as a permissions error mid-deadline, with nothing on screen
-- explaining why.
--
-- my_student_ref() already resolves from either link — it prefers student_ref
-- and falls back to looking the student up by number. Using it here makes these
-- policies behave the same way the marks, attendance and submission-row policies
-- already do, so a student either owns their data everywhere or nowhere.
--
-- Policies only. No data is touched.
-- Idempotent: safe to run more than once.
-- ============================================================================

DROP POLICY IF EXISTS "Read submissions"   ON storage.objects;
DROP POLICY IF EXISTS "Students submit work" ON storage.objects;

-- Staff see every submission; a student sees only their own.
CREATE POLICY "Read submissions"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'assignment-files'
    AND (storage.foldername(name))[1] = 'submissions'
    AND (
      is_school_staff(auth.uid())
      OR (storage.foldername(name))[3] = my_student_ref(auth.uid())
    )
  );

-- A student may upload only into their own submission folder.
CREATE POLICY "Students submit work"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'assignment-files'
    AND (storage.foldername(name))[1] = 'submissions'
    AND (storage.foldername(name))[3] = my_student_ref(auth.uid())
  );


-- ── Verify ──────────────────────────────────────────────────────────────────
-- `students_who_could_not_submit` is how many student accounts the OLD policies
-- would have refused: a profile with no student_ref, which the fallback now
-- resolves. `still_unresolvable` must be 0 — those students cannot submit,
-- cannot see their marks, and need their profile linking.
SELECT
  (SELECT count(*) FROM pg_policies
    WHERE schemaname='storage' AND tablename='objects'
      AND policyname IN ('Read submissions','Students submit work'))                AS policies_rebuilt,
  (SELECT count(*) FROM public.profiles p
     JOIN public.user_roles r ON r.user_id = p.user_id AND r.role = 'student'::app_role
    WHERE nullif(trim(p.student_ref), '') IS NULL)                                  AS students_who_could_not_submit,
  (SELECT count(*) FROM public.profiles p
     JOIN public.user_roles r ON r.user_id = p.user_id AND r.role = 'student'::app_role
    WHERE public.my_student_ref(p.user_id) IS NULL)                                 AS still_unresolvable;
