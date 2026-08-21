-- ============================================================================
-- Policies that grant 'admin' but forgot 'super_admin'
-- ============================================================================
-- Symptom: "Timetable uploaded, but the notification could not be sent."
--
-- The notifications write policy, from the original 2026-03-05 schema, is:
--
--   CREATE POLICY "Admins can manage notifications" ON public.notifications
--     FOR ALL USING (has_role(auth.uid(), 'admin'));
--
-- `super_admin` did not exist when that was written, so a super_admin's insert
-- is refused. The timetable upload succeeds and the notification silently does
-- not — which is why the toast says exactly that.
--
-- This is the SAME gap already fixed piecemeal in profiles, user_roles,
-- school_config and student-photos storage, and in nine UI gates. Fixing one
-- more policy on its own would leave the rest to surface one outage at a time,
-- so this sweeps: every policy naming 'admin' without 'super_admin' is listed
-- at the end, and the ones the app actually writes to are fixed here.
--
-- Additive — no existing policy is dropped, so nobody loses access.
-- Idempotent: safe to run more than once.
-- ============================================================================

-- ── notifications: the one that surfaced ────────────────────────────────────
DROP POLICY IF EXISTS "Super admins manage notifications" ON public.notifications;
CREATE POLICY "Super admins manage notifications"
  ON public.notifications FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'super_admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'super_admin'::app_role));

-- ── The other tables the app writes to from admin screens ───────────────────
-- Each already has an "Admins can manage …" policy that omits super_admin.
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'classes','modules','module_classes','departments','programmes',
    'rooms','terms','public_holidays','students','exams','marks',
    'student_modules','school_config'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    -- Skip anything that isn't there (schema drift is normal in this database).
    IF NOT EXISTS (SELECT 1 FROM pg_class c
                    WHERE c.relname = t AND c.relnamespace = 'public'::regnamespace) THEN
      RAISE NOTICE 'skipped % — table not present', t;
      CONTINUE;
    END IF;

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Super admins manage ' || t, t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated '
      'USING (has_role(auth.uid(), ''super_admin''::app_role)) '
      'WITH CHECK (has_role(auth.uid(), ''super_admin''::app_role))',
      'Super admins manage ' || t, t);
    RAISE NOTICE 'super_admin granted on %', t;
  END LOOP;
END $$;


-- ── Verify ──────────────────────────────────────────────────────────────────
-- 1. Anything still naming admin without super_admin. Review each: some may be
--    deliberate, but after this sweep most should be gone.
SELECT 'still admin-only' AS check,
       tablename || ' · ' || policyname AS policy,
       cmd
  FROM pg_policies
 WHERE schemaname = 'public'
   AND coalesce(qual, '') || coalesce(with_check, '') LIKE '%''admin''%'
   AND coalesce(qual, '') || coalesce(with_check, '') NOT LIKE '%super_admin%'
   AND cmd <> 'SELECT'
 ORDER BY tablename, policyname;

-- 2. Confirm the notification path specifically.
SELECT 'notifications writers' AS check,
       string_agg(policyname || ' [' || cmd || ']', ' | ' ORDER BY policyname) AS policies
  FROM pg_policies
 WHERE schemaname = 'public' AND tablename = 'notifications' AND cmd <> 'SELECT';
