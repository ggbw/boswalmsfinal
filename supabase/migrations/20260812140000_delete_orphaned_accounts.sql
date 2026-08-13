-- ============================================================================
-- Delete 11 accounts with no profile
-- ============================================================================
-- IRREVERSIBLE. These auth accounts are removed along with anything that
-- cascades from them — including, for four of them, their application record.
--
-- All 11 share the same defect: no row in `profiles`. App.tsx checks
-- `if (!user || !profile) return <LoginScreen/>` before it works out what kind
-- of user someone is, so every one of them can authenticate and is then bounced
-- back to the login screen with no message. None of them can use the system as
-- it stands.
--
-- SEVEN abandoned signups — no profile, no role, no application:
--   kgosimotlhbane2001@gmail.com   kgosimotlhbane@gmail.com
--   kgosimotlhbane2@gmail.com      kgosimotlhabane@gmail.com
--   kg@gmail.com                   yayamadile@gmail.com
--   yamadile@gmail.com
-- The near-identical spellings suggest repeated attempts at one signup.
--
-- FOUR with an application attached — deleting these removes the application:
--   samuel@gmail.com     ymadile@gmail.com
--   boisiphera@gmail.com jkeabilwe@gmail.com
--
-- Confirmed for deletion by the user after the consequence was raised twice.
--
-- WORTH KNOWING: "Boisi Phera" also exists as a STAFF account holding the hoa
-- role. Only the gmail applicant account is deleted here; the staff account is
-- matched by neither name nor address in the list below and is untouched.
--
-- Accounts are matched by EXPLICIT EMAIL rather than by "has no profile", so
-- this cannot widen its own scope if another account loses its profile later.
--
-- Idempotent: once the accounts are gone the statements match nothing.
-- ============================================================================


-- ── Record what is about to go ──────────────────────────────────────────────
-- Read this output before scrolling on. It is the only record of what existed.
SELECT u.email,
       u.created_at::date                                             AS signed_up,
       coalesce(a.name, '—')                                          AS applicant_name,
       coalesce(app.status, 'no application')                         AS application_status,
       CASE WHEN a.user_id IS NULL THEN 'abandoned signup'
            ELSE 'HAS APPLICATION — will be deleted with the account' END AS note
  FROM auth.users u
  LEFT JOIN public.applicants    a   ON a.user_id      = u.id
  LEFT JOIN public.applications  app ON app.applicant_id = a.id
 WHERE lower(u.email) IN (
   'kgosimotlhbane2001@gmail.com','kgosimotlhbane@gmail.com','kgosimotlhbane2@gmail.com',
   'kgosimotlhabane@gmail.com','kg@gmail.com','yayamadile@gmail.com','yamadile@gmail.com',
   'samuel@gmail.com','ymadile@gmail.com','boisiphera@gmail.com','jkeabilwe@gmail.com'
 )
 ORDER BY note DESC, u.created_at;


-- ── Delete ──────────────────────────────────────────────────────────────────
DO $$
DECLARE
  targets uuid[];
  n int;
BEGIN
  SELECT array_agg(u.id) INTO targets
    FROM auth.users u
   WHERE lower(u.email) IN (
     'kgosimotlhbane2001@gmail.com','kgosimotlhbane@gmail.com','kgosimotlhbane2@gmail.com',
     'kgosimotlhabane@gmail.com','kg@gmail.com','yayamadile@gmail.com','yamadile@gmail.com',
     'samuel@gmail.com','ymadile@gmail.com','boisiphera@gmail.com','jkeabilwe@gmail.com'
   )
     -- Belt and braces: never touch an account that has a profile. If one of
     -- these addresses is ever reused by a real user, this skips it.
     AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = u.id);

  IF targets IS NULL THEN
    RAISE NOTICE 'nothing to delete — these accounts are already gone';
    RETURN;
  END IF;

  n := array_length(targets, 1);

  -- Applications reference applicants, so they go first.
  DELETE FROM public.applications
   WHERE applicant_id IN (SELECT id FROM public.applicants WHERE user_id = ANY(targets));
  DELETE FROM public.applicants WHERE user_id = ANY(targets);
  DELETE FROM public.user_roles WHERE user_id = ANY(targets);
  DELETE FROM auth.users        WHERE id      = ANY(targets);

  RAISE NOTICE 'deleted % orphaned account(s)', n;
END $$;


-- ── Verify ──────────────────────────────────────────────────────────────────
-- Expect 0 remaining, and no account left anywhere without a profile.
SELECT
  (SELECT count(*) FROM auth.users u
    WHERE lower(u.email) IN (
      'kgosimotlhbane2001@gmail.com','kgosimotlhbane@gmail.com','kgosimotlhbane2@gmail.com',
      'kgosimotlhabane@gmail.com','kg@gmail.com','yayamadile@gmail.com','yamadile@gmail.com',
      'samuel@gmail.com','ymadile@gmail.com','boisiphera@gmail.com','jkeabilwe@gmail.com'
    ))                                                                   AS targets_remaining,
  (SELECT count(*) FROM auth.users u
    LEFT JOIN public.profiles p ON p.user_id = u.id
   WHERE p.user_id IS NULL)                                              AS accounts_still_without_profile,
  (SELECT count(*) FROM auth.users)                                      AS total_accounts;
