-- ============================================================================
-- Admissions does not advance for a super_admin
-- ============================================================================
-- Symptom: an application arrives, an admin opens it, the status moves to
-- "under review" — and then nothing. Accept, reject and enrol appear to do
-- nothing, and the chain of events stalls.
--
-- Cause: the write policies on `applications` and `applicants` name 'admin' and
-- not 'super_admin'. Opening an application sets under_review through a path
-- that happens to succeed for the caller, but every later status change is an
-- UPDATE the policy refuses. Supabase returns success with zero rows affected,
-- so the UI has nothing to report and the application simply never moves.
--
-- 20260812250000 swept thirteen tables for exactly this gap but did not include
-- the admissions tables. This finishes that job.
--
-- Also covers `student_registrations` — admissions and registration are the two
-- places where an approval writes a decision, and the second would have failed
-- the same way for the same reason.
--
-- Additive: no existing policy is dropped, so nobody loses access.
-- Idempotent: safe to run more than once.
-- ============================================================================

DO $$
DECLARE
  t text;
  tables text[] := ARRAY['applications', 'applicants', 'admission_enquiries'];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_class c
                    WHERE c.relname = t AND c.relnamespace = 'public'::regnamespace) THEN
      RAISE NOTICE 'skipped % — not present', t;
      CONTINUE;
    END IF;

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Admins manage ' || t, t);
    -- Both roles named explicitly rather than relying on an existing admin-only
    -- policy, so this one row is the whole truth for administrative writes.
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated '
      'USING (has_role(auth.uid(), ''admin''::app_role) '
      '    OR has_role(auth.uid(), ''super_admin''::app_role)) '
      'WITH CHECK (has_role(auth.uid(), ''admin''::app_role) '
      '         OR has_role(auth.uid(), ''super_admin''::app_role))',
      'Admins manage ' || t, t);
    RAISE NOTICE 'admin + super_admin can now write %', t;
  END LOOP;
END $$;


-- ── Verify ──────────────────────────────────────────────────────────────────
-- 1. Admissions writers — expect admin AND super_admin on each table.
SELECT tablename,
       string_agg(policyname || ' [' || cmd || ']', ' | ' ORDER BY policyname) AS write_policies
  FROM pg_policies
 WHERE schemaname = 'public'
   AND tablename IN ('applications', 'applicants', 'admission_enquiries')
   AND cmd <> 'SELECT'
 GROUP BY tablename
 ORDER BY tablename;

-- 2. ANYTHING still granting admin without super_admin on a write. Should be
--    empty — if not, those are the next outages waiting to happen.
SELECT tablename || ' · ' || policyname AS still_admin_only, cmd
  FROM pg_policies
 WHERE schemaname = 'public'
   AND coalesce(qual, '') || coalesce(with_check, '') LIKE '%''admin''%'
   AND coalesce(qual, '') || coalesce(with_check, '') NOT LIKE '%super_admin%'
   AND cmd <> 'SELECT'
 ORDER BY tablename, policyname;
