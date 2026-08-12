-- ============================================================================
-- Require a password change for every account except admin / super_admin
-- ============================================================================
-- Live check on 2026-08-12 found:
--   • must_change_password = true on ZERO of 151 profiles (never set by anything
--     on the LMS side — only the HR functions ever set it)
--   • 138 accounts had never changed their password since creation, i.e. were
--     still on the shared BoswaStudent2026! / BoswaStaff2026! published in the
--     repository
--
-- Setting the flag makes ForcePasswordChange (mounted in AppLayout) show a
-- blocking screen at the user's next sign-in. Their current password keeps
-- working until they set a new one — nobody is locked out, they are interrupted.
--
-- Admins and super_admins are excluded so administrators cannot all be
-- interrupted at the same moment.
--
-- This is the one-off catch-up for existing accounts. Going forward:
--   • create-user / provision-student-accounts / seed-faculty issue a unique
--     password per account and set this flag themselves
--   • User Management → "Require Password Change" repeats this for a chosen
--     group, via the force-password-change edge function
--
-- TELL PEOPLE BEFORE RUNNING THIS. To anyone not expecting it, an unexplained
-- "you must change your password" screen looks like the system has locked them out.
-- ============================================================================

UPDATE public.profiles p
   SET must_change_password = true
 WHERE NOT EXISTS (
         SELECT 1 FROM public.user_roles r
          WHERE r.user_id = p.user_id
            AND r.role IN ('admin'::app_role, 'super_admin'::app_role)
       );

-- Confirm the split before anyone signs in again.
SELECT
  count(*) FILTER (WHERE must_change_password)                   AS will_be_prompted,
  count(*) FILTER (WHERE must_change_password IS NOT TRUE)       AS not_prompted_should_be_admins_only,
  count(*)                                                       AS total_profiles
FROM public.profiles;
