-- ============================================================================
-- Merge two duplicate staff accounts created on 2026-04-17
-- ============================================================================
-- Two people have a second login created on 17 April under a longer-form email,
-- alongside the short address they had been using since 10 April:
--
--   KEEP  bathusi@boswa.ac.bw            10 Apr  lecturer  24 modules
--   DROP  bathusimothankane@boswa.ac.bw  17 Apr  lecturer   1 module
--
--   KEEP  gomolemo@boswa.ac.bw           10 Apr  hoa       18 modules
--   DROP  gomolemommolawa@boswa.ac.bw    17 Apr  lecturer   0 modules
--
-- The Gomolemo duplicate is the account 20260812110000 repaired. It looked like
-- a locked-out member of staff — no profile, no role — but she already had a
-- working account under a different address, so repairing it produced a second
-- login rather than fixing a lockout. Removing it here.
--
-- A check for other accounts created that day found only these two, so this is
-- the whole cleanup, not a sample of a larger batch.
--
-- Bathusi's duplicate holds ONE module assignment. That is moved to the surviving
-- account before deletion — dropping it would leave a module with no lecturer,
-- and possibly one nobody else covers.
--
-- Note the duplicate profile also carried a STALE EMAIL: its profiles.email said
-- bathusi@boswa.ac.bw while the actual login was bathusimothankane@boswa.ac.bw.
-- That is why the two accounts looked identical at first glance — always compare
-- auth.users.email, not profiles.email.
--
-- Gomolemo's ROLE on the surviving account is deliberately NOT changed here.
-- It is hoa, and that account has 18 modules and a history of use; the "she is a
-- lecturer" instruction described the duplicate. Change it separately once
-- confirmed — see the note at the end.
--
-- Idempotent: safe to run more than once. Once the accounts are gone the
-- statements match nothing.
-- ============================================================================

DO $$
DECLARE
  keep_bathusi  uuid;
  drop_bathusi  uuid;
  drop_gomolemo uuid;
  moved         int := 0;
BEGIN
  SELECT id INTO keep_bathusi  FROM auth.users WHERE lower(email) = 'bathusi@boswa.ac.bw';
  SELECT id INTO drop_bathusi  FROM auth.users WHERE lower(email) = 'bathusimothankane@boswa.ac.bw';
  SELECT id INTO drop_gomolemo FROM auth.users WHERE lower(email) = 'gomolemommolawa@boswa.ac.bw';

  -- ── Bathusi: move the module assignment across ───────────────────────────
  IF drop_bathusi IS NOT NULL AND keep_bathusi IS NOT NULL THEN
    -- lecturer_modules is UNIQUE (lecturer_id, module_id, class_id), so drop any
    -- row the surviving account already covers rather than colliding on update.
    DELETE FROM public.lecturer_modules dup
     WHERE dup.lecturer_id = drop_bathusi::text
       AND EXISTS (
         SELECT 1 FROM public.lecturer_modules keep
          WHERE keep.lecturer_id = keep_bathusi::text
            AND keep.module_id   = dup.module_id
            AND keep.class_id    = dup.class_id
       );

    UPDATE public.lecturer_modules
       SET lecturer_id = keep_bathusi::text
     WHERE lecturer_id = drop_bathusi::text;
    GET DIAGNOSTICS moved = ROW_COUNT;
    RAISE NOTICE 'moved % module assignment(s) to bathusi@boswa.ac.bw', moved;
  END IF;

  -- ── Remove both duplicates ───────────────────────────────────────────────
  -- Children first, then the auth account. The FKs cascade, but being explicit
  -- makes the intent clear and keeps this readable if a cascade is ever dropped.
  IF drop_bathusi IS NOT NULL THEN
    DELETE FROM public.user_roles WHERE user_id = drop_bathusi;
    DELETE FROM public.profiles   WHERE user_id = drop_bathusi;
    DELETE FROM auth.users        WHERE id      = drop_bathusi;
    RAISE NOTICE 'removed duplicate account bathusimothankane@boswa.ac.bw';
  END IF;

  IF drop_gomolemo IS NOT NULL THEN
    DELETE FROM public.user_roles WHERE user_id = drop_gomolemo;
    DELETE FROM public.profiles   WHERE user_id = drop_gomolemo;
    DELETE FROM auth.users        WHERE id      = drop_gomolemo;
    RAISE NOTICE 'removed duplicate account gomolemommolawa@boswa.ac.bw';
  END IF;
END $$;


-- ── Verify ──────────────────────────────────────────────────────────────────
-- Expect one row each: Bathusi with 25 modules, Gomolemo with 18.
SELECT p.name, u.email, coalesce(p.dept, '—') AS dept,
       coalesce((SELECT string_agg(r.role::text, '+') FROM public.user_roles r
                  WHERE r.user_id = u.id), 'no role')                            AS roles,
       (SELECT count(*) FROM public.lecturer_modules lm
         WHERE lm.lecturer_id = u.id::text)                                      AS modules
  FROM auth.users u
  JOIN public.profiles p ON p.user_id = u.id
 WHERE lower(trim(p.name)) IN ('bathusi motlhankane', 'gomolemo mmolawa')
 ORDER BY p.name;

-- Nobody should hold two accounts any more.
SELECT coalesce(string_agg(name, ', '), 'none — no duplicates remain') AS people_with_multiple_accounts
  FROM (SELECT p.name FROM public.profiles p
         GROUP BY p.name HAVING count(*) > 1) d;

-- If Gomolemo should be a lecturer rather than Head of Academics, run:
--   UPDATE public.user_roles SET role = 'lecturer'::app_role
--    WHERE user_id = (SELECT id FROM auth.users WHERE lower(email) = 'gomolemo@boswa.ac.bw');
