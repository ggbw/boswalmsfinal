-- ============================================================================
-- Rename the app_role value 'hoy' to 'hoa'
-- ============================================================================
-- The role has always been Head of ACADEMICS — the UI labels it "HOA — Head of
-- Academics" — but the enum value was 'hoy', a leftover from when it meant Head
-- of Year. Nothing called 'hoy' should remain.
--
-- ALTER TYPE ... RENAME VALUE changes the label in place. Enum columns store an
-- internal identifier rather than the text, so:
--   • the two accounts holding this role keep it — no rows are rewritten
--   • every existing RLS policy written as has_role(uid, 'hoy'::app_role) keeps
--     working, and now reads as 'hoa'
--   • no table is scanned and no data is copied
--
-- The matching code change renames 'hoy' → 'hoa' across 21 files. Deploy that
-- together with this: the frontend compares role strings, so if only one side
-- moves, the two HOA accounts lose access to every page gated on their role.
-- (`Nthoyapelo` contains the letters "hoy" and is deliberately untouched — the
-- rename was applied on word boundaries.)
--
-- Idempotent: the guard makes a second run a no-op rather than an error.
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = 'app_role' AND e.enumlabel = 'hoy'
  ) THEN
    ALTER TYPE public.app_role RENAME VALUE 'hoy' TO 'hoa';
    RAISE NOTICE 'app_role: hoy renamed to hoa';
  ELSE
    RAISE NOTICE 'app_role: no hoy value present — nothing to do';
  END IF;
END $$;


-- ── Verify ──────────────────────────────────────────────────────────────────
-- Expect the enum to list hoa and not hoy, and the accounts to have carried over.
SELECT
  (SELECT string_agg(e.enumlabel, ', ' ORDER BY e.enumsortorder)
     FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'app_role')                                      AS app_role_values,
  (SELECT count(*) FROM public.user_roles WHERE role = 'hoa'::app_role) AS accounts_with_hoa,
  (SELECT coalesce(string_agg(p.name, ', '), 'none')
     FROM public.user_roles r JOIN public.profiles p ON p.user_id = r.user_id
    WHERE r.role = 'hoa'::app_role)                                     AS who;
