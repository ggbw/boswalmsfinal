-- ============================================================================
-- Actually close anonymous write access to lecturer_modules
-- ============================================================================
-- 20260812060000 tried to drop this policy by the name the migration file gives
-- it — "Allow all for authenticated" (20260416000000_schema_fixes.sql). The live
-- policy is named "Allow all". The DROP matched nothing, and the table stayed
-- open:
--
--   lecturer_modules | Allow all {ALL → public}
--
-- A policy granted to `public` covers anon, so all 105 lecturer-to-module
-- assignments remain readable, insertable, updatable and DELETABLE by anyone
-- holding the publishable key, with no login. Emptying that table would strip
-- every lecturer of their classes, students, registers and assignments at once.
--
-- So: drop whatever is actually there, discovered from the catalog, rather than
-- guessing at names. The live schema has diverged from these files repeatedly —
-- module_id added by hand, 20260706 never applied, this policy renamed — so
-- name-based DROPs cannot be trusted here.
--
-- The replacement policies from 20260812060000 (authenticated read, admin write)
-- are already in place and are left alone.
--
-- No data is touched: policies only.
-- Idempotent: safe to run more than once.
-- ============================================================================

DO $$
DECLARE
  pol text;
  n   int := 0;
BEGIN
  FOR pol IN
    SELECT policyname
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'lecturer_modules'
       AND 'public'   = ANY(roles)      -- anything anon can use
  LOOP
    EXECUTE format('DROP POLICY %I ON public.lecturer_modules', pol);
    RAISE NOTICE 'dropped public-granted policy: %', pol;
    n := n + 1;
  END LOOP;

  IF n = 0 THEN
    RAISE NOTICE 'nothing to drop — lecturer_modules already closed to anon';
  END IF;
END $$;


-- Make sure the intended policies exist, in case the loop above removed the only
-- ones present (a table with RLS on and no policies denies everything).
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
-- Expect exactly two policies, both → authenticated, and none → public.
SELECT string_agg(policyname || ' {' || cmd || ' → ' || array_to_string(roles, '+') || '}',
                  ' | ' ORDER BY policyname)                       AS policies,
       count(*) FILTER (WHERE 'public' = ANY(roles))               AS still_open_to_anon
  FROM pg_policies
 WHERE schemaname = 'public' AND tablename = 'lecturer_modules';
