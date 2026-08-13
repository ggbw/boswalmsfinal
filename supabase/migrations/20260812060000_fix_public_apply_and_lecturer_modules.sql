-- ============================================================================
-- 1. Restore the public application form  2. Stop anonymous writes to
--    lecturer_modules
-- ============================================================================
-- Run this ahead of the wider RLS work. Both are live problems.
--
-- ── 1. REGRESSION introduced by 20260812000000_close_open_data ───────────────
-- That migration enabled RLS on programme_modules and gave it a SELECT policy
-- scoped TO authenticated. But PublicApplyPage — the anonymous /apply form —
-- reads programmes, programme_modules and modules at page load, before the
-- applicant has an account:
--
--   src/pages/PublicApplyPage.tsx:36-38
--     supabase.from("programmes").select("*")
--     supabase.from("programme_modules").select("programme_id,module_id,year,semester")
--     supabase.from("modules").select("id,name")
--
-- RLS was OFF on programme_modules before, so anon could read it. Now it cannot,
-- and the programme/module lists on the public form come back empty.
--
-- This is exactly why classes, modules, programmes and module_classes each
-- carry a deliberate TO public SELECT policy. programme_modules was the one
-- table in that set without one, and it needed the same treatment rather than
-- an authenticated-only policy.
--
-- Curriculum structure is a course catalogue, not personal data — the same
-- information a prospectus publishes. Reads only; writes stay admin-only.
--
-- ── 2. lecturer_modules is world-writable ───────────────────────────────────
-- From 20260416000000_schema_fixes.sql:
--
--   CREATE POLICY "Allow all for authenticated" ON lecturer_modules
--     FOR ALL USING (true);
--
-- Despite the name there is no TO clause, and a policy without one applies to
-- PUBLIC — which includes anon. So every lecturer-to-module assignment (105
-- rows) can be read, inserted, updated and DELETED by anyone holding the
-- publishable key, with no login. Wiping that table would strip every lecturer
-- of their classes, students, attendance registers and assignments at once.
--
-- Replaced with: authenticated may read (the app loads it for every role);
-- only admin/super_admin may write, matching Classes → Assign lecturers, which
-- is the only screen that changes it and is already admin-gated.
--
-- Idempotent: safe to run more than once.
-- ============================================================================


-- ── 1. programme_modules: let the public apply form read it again ───────────
DROP POLICY IF EXISTS "Public read programme_modules" ON public.programme_modules;

CREATE POLICY "Public read programme_modules"
  ON public.programme_modules FOR SELECT TO public
  USING (true);


-- ── 2. lecturer_modules: close anonymous access ─────────────────────────────
-- Drop by ROLE, not by name. The migration file calls this policy "Allow all
-- for authenticated" but the live database has it as "Allow all" — so a
-- DROP POLICY IF EXISTS on the documented name matched nothing and failed
-- silently, leaving the table world-writable. Anything on this table granted to
-- `public` goes, whatever it is called.
DO $$
DECLARE pol text;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'lecturer_modules'
       AND 'public' = ANY(roles)
  LOOP
    EXECUTE format('DROP POLICY %I ON public.lecturer_modules', pol);
    RAISE NOTICE 'dropped public-facing policy % on lecturer_modules', pol;
  END LOOP;
END $$;

DROP POLICY IF EXISTS "Authenticated read lecturer_modules" ON public.lecturer_modules;
DROP POLICY IF EXISTS "Admins manage lecturer_modules"      ON public.lecturer_modules;

CREATE POLICY "Authenticated read lecturer_modules"
  ON public.lecturer_modules FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Admins manage lecturer_modules"
  ON public.lecturer_modules FOR ALL TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'super_admin'::app_role)
  )
  WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'super_admin'::app_role)
  );


-- ── Verify ──────────────────────────────────────────────────────────────────
-- Expect programme_modules to list a public SELECT policy, and lecturer_modules
-- to have NO policy granted to `public` at all.
SELECT tablename,
       string_agg(policyname || ' {' || cmd || ' → ' || array_to_string(roles, '+') || '}',
                  ' | ' ORDER BY policyname) AS policies
  FROM pg_policies
 WHERE schemaname = 'public'
   AND tablename IN ('programme_modules', 'lecturer_modules')
 GROUP BY tablename;
