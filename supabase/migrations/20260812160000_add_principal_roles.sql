-- ============================================================================
-- Add the principal and deputy_principal roles
-- ============================================================================
-- ⚠ RUN THIS FILE ON ITS OWN, and nothing else alongside it.
--
-- Postgres will not let a newly added enum value be USED in the same
-- transaction that added it — "unsafe use of new value of enum type". The
-- Lovable SQL editor wraps whatever you paste in a single transaction, so if
-- this file and a policy referencing 'principal' are run together, the whole
-- thing fails. Adding the values is therefore its own migration; everything
-- that uses them is in 20260812170000.
--
-- Spelling: principal (the person who runs the school), not principle (a rule).
--
-- Agreed scope — read-only across the whole school, no editing:
--   principal         everything, including admissions and operational health
--   deputy_principal  the academic side — attendance, marks, progression,
--                     at-risk students — without the admissions pipeline
--
-- Neither gets Configuration or User Management. That is deliberate: we spent
-- this whole effort narrowing who can change records, and an oversight role
-- does not need write access to do oversight.
--
-- IF NOT EXISTS makes a re-run a no-op rather than an error.
-- ============================================================================

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'principal';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'deputy_principal';


-- ── Verify ──────────────────────────────────────────────────────────────────
-- Expect both to appear in the list. Nobody holds them yet — assign through
-- User Management, or with:
--   UPDATE public.user_roles SET role = 'principal'::app_role
--    WHERE user_id = (SELECT id FROM auth.users WHERE lower(email) = '<their email>');
SELECT string_agg(e.enumlabel, ', ' ORDER BY e.enumsortorder) AS app_role_values
  FROM pg_enum e
  JOIN pg_type t ON t.oid = e.enumtypid
 WHERE t.typname = 'app_role';
