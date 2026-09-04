-- ============================================================================
-- New role: accountant
-- ============================================================================
-- Payroll and contracts are being taken away from HR and given to a dedicated
-- Accountant role, alongside admin and super_admin. HR keeps every other HR
-- function: employees, leave, loans, documents, attendance and departments.
--
-- RUN THIS FILE ON ITS OWN, AND FIRST.
--
-- Postgres will not let a newly added enum value be USED in the same
-- transaction that added it. The policies that reference 'accountant' are
-- therefore in a separate file, 20260821160000, which must be run afterwards
-- as a separate statement. Running them together fails with
-- "unsafe use of new value of enum type".
--
-- Safe to re-run: IF NOT EXISTS makes a second run a no-op.
-- ============================================================================

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'accountant';


-- ── Verify ──────────────────────────────────────────────────────────────────
-- Expect 'accountant' in the list. Once it appears, run 20260821160000.
SELECT string_agg(e.enumlabel, ', ' ORDER BY e.enumsortorder) AS app_role_values
  FROM pg_enum e
  JOIN pg_type t ON t.oid = e.enumtypid
 WHERE t.typname = 'app_role';
