-- ============================================================================
-- Let every teaching role actually create and manage assignments
-- ============================================================================
-- The write policies on assignments and submissions were written on 2026-03-05,
-- when the only roles were admin / hod / hoy / lecturer / student, and they name
-- just TWO of them:
--
--   "Admins can manage assignments"    FOR ALL USING has_role(…, 'admin')
--   "Lecturers can manage assignments" FOR ALL USING has_role(…, 'lecturer')
--
-- So `super_admin`, `hod` and `hoy` (HOA) cannot insert, update or delete an
-- assignment — while the UI shows them Create, Delete and Marks buttons. The
-- action just fails. Same gap on submissions, which means those roles also
-- cannot grade.
--
-- Note the policies have USING but no WITH CHECK. For INSERT, Postgres falls
-- back to the USING expression when WITH CHECK is absent — which is why
-- lecturers CAN create today. Lecturers were never blocked by permissions; a
-- lecturer who cannot create an assignment has no rows in `lecturer_modules`,
-- so the module picker is empty and the form cannot be completed. That is a
-- data gap (6 of 12 teaching staff currently have none) and is fixed by
-- assigning them modules, not by widening these policies.
--
-- Both USING and WITH CHECK are spelled out here rather than relying on the
-- fallback, so INSERT and UPDATE are explicit.
--
-- Idempotent: safe to run more than once.
-- ============================================================================

-- The teaching roles the app already treats as able to run assessments:
-- AssignmentsPage gates its Create / Delete / Marks buttons on exactly this set.

-- ── assignments ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Teaching staff manage assignments" ON public.assignments;

CREATE POLICY "Teaching staff manage assignments"
  ON public.assignments FOR ALL TO authenticated
  USING (
    has_role(auth.uid(), 'super_admin'::app_role)
    OR has_role(auth.uid(), 'hod'::app_role)
    OR has_role(auth.uid(), 'hoy'::app_role)
  )
  WITH CHECK (
    has_role(auth.uid(), 'super_admin'::app_role)
    OR has_role(auth.uid(), 'hod'::app_role)
    OR has_role(auth.uid(), 'hoy'::app_role)
  );


-- ── submissions ─────────────────────────────────────────────────────────────
-- Needed for grading, and for the cascade when an assignment is deleted.
DROP POLICY IF EXISTS "Teaching staff manage submissions" ON public.submissions;

CREATE POLICY "Teaching staff manage submissions"
  ON public.submissions FOR ALL TO authenticated
  USING (
    has_role(auth.uid(), 'super_admin'::app_role)
    OR has_role(auth.uid(), 'hod'::app_role)
    OR has_role(auth.uid(), 'hoy'::app_role)
  )
  WITH CHECK (
    has_role(auth.uid(), 'super_admin'::app_role)
    OR has_role(auth.uid(), 'hod'::app_role)
    OR has_role(auth.uid(), 'hoy'::app_role)
  );


-- ── Verify ──────────────────────────────────────────────────────────────────
SELECT tablename,
       string_agg(policyname || ' [' || cmd || ']', ' | ' ORDER BY policyname) AS policies
  FROM pg_policies
 WHERE schemaname = 'public' AND tablename IN ('assignments', 'submissions')
 GROUP BY tablename;
