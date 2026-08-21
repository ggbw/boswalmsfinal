-- ============================================================================
-- HOA can be offered exam and assignment creation, but cannot actually do it
-- ============================================================================
-- Symptom: a Head of Academics creates an exam, sees "Exam created!", and the
-- exam is not there.
--
-- Cause: two lists that disagree.
--
--   The UI  — canManageAcademics() in src/lib/scope.ts resolves to
--             admin, super_admin, hoa. ExamsPage additionally treats
--             lecturer/hod/hoa as teaching staff. So HOA gets the button.
--
--   The DB  — 20260812050000 granted writes to admin, super_admin, hod and
--             lecturer. HOA was never added.
--
-- PostgREST returns success with zero rows changed when RLS refuses a write,
-- so nothing reported a problem. The client fix (adding .select() and checking
-- the row count) makes the refusal visible; this makes the refusal stop
-- happening, because HOA is Head of Academics and setting assessments is the
-- job.
--
-- Additive and idempotent: no existing policy is dropped.
-- ============================================================================

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['exams', 'assignments', 'assessment_marks', 'module_outcomes'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_class c
                    WHERE c.relname = t AND c.relnamespace = 'public'::regnamespace) THEN
      RAISE NOTICE 'skipped % — not present', t;
      CONTINUE;
    END IF;

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'HOA manages ' || t, t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated '
      'USING (has_role(auth.uid(), ''hoa''::app_role)) '
      'WITH CHECK (has_role(auth.uid(), ''hoa''::app_role))',
      'HOA manages ' || t, t);
    RAISE NOTICE 'HOA may now write %', t;
  END LOOP;
END $$;


-- ── Verify ──────────────────────────────────────────────────────────────────
-- Every role the UI offers assessment controls to should appear here for each
-- table. Expect admin, super_admin, hod, lecturer AND hoa.
SELECT tablename,
       string_agg(DISTINCT r.role, ', ' ORDER BY r.role) AS roles_that_may_write
  FROM pg_policies p
  CROSS JOIN LATERAL (
    SELECT unnest(ARRAY['admin','super_admin','hod','hoa','lecturer']) AS role
  ) r
 WHERE p.schemaname = 'public'
   AND p.tablename IN ('exams','assignments','assessment_marks','module_outcomes')
   AND p.cmd <> 'SELECT'
   AND coalesce(p.qual,'') || coalesce(p.with_check,'') LIKE '%''' || r.role || '''%'
 GROUP BY tablename
 ORDER BY tablename;
