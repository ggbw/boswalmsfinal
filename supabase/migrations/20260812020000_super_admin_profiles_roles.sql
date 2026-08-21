-- ============================================================================
-- Give super_admin the same access to profiles and user_roles that admin has
-- ============================================================================
-- The policies on these two tables were written on 2026-03-05, before the
-- `super_admin` role existed, and were never backfilled:
--
--   user_roles SELECT : "Admins can view all roles" | "Users can view their own role"
--   profiles   SELECT : admin | hod | hoy | lecturer | self
--
-- So a signed-in super_admin could read exactly one row from user_roles — their
-- own. LecturersPage builds its list by reading profiles + user_roles and
-- keeping anyone whose role is lecturer/hod/hoy; with a role map containing only
-- the current user, every other profile fails the filter and the page renders
-- empty. The same applies to the "assign lecturer" dropdown in Classes and to
-- User Management, which are both listed for super_admin in ROLE_PAGES.
--
-- The write policies have the identical gap, so a super_admin also could not
-- edit a user, delete a user, or change anyone's role — those actions failed
-- silently against RLS.
--
-- This is the same fix already applied one table at a time in
-- 20260708000000_student_photos_super_admin_policy and
-- 20260708010000_school_config_super_admin_policy.
--
-- Purely additive: no existing policy is removed, so nobody loses access.
--
-- has_role() is SECURITY DEFINER and therefore bypasses RLS, so a policy on
-- user_roles that calls it does not recurse. The existing admin policy relies
-- on exactly the same property.
--
-- Idempotent: safe to run more than once.
-- ============================================================================


-- ── user_roles ──────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Super admins can view all roles"   ON public.user_roles;
DROP POLICY IF EXISTS "Super admins can manage all roles" ON public.user_roles;

CREATE POLICY "Super admins can view all roles"
  ON public.user_roles FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'super_admin'::app_role));

CREATE POLICY "Super admins can manage all roles"
  ON public.user_roles FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'super_admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'super_admin'::app_role));


-- ── profiles ────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Super admins can view all profiles"   ON public.profiles;
DROP POLICY IF EXISTS "Super admins can manage all profiles" ON public.profiles;

CREATE POLICY "Super admins can view all profiles"
  ON public.profiles FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'super_admin'::app_role));

CREATE POLICY "Super admins can manage all profiles"
  ON public.profiles FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'super_admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'super_admin'::app_role));


-- Confirm: each list should now include the super_admin policies.
SELECT tablename,
       string_agg(policyname || ' [' || cmd || ']', ' | ' ORDER BY policyname) AS policies
  FROM pg_policies
 WHERE schemaname = 'public' AND tablename IN ('profiles', 'user_roles')
 GROUP BY tablename;
