-- ============================================================================
-- Four staff accounts that could authenticate but never log in
-- ============================================================================
-- These auth accounts exist with no `profiles` row and no `user_roles` row.
-- App.tsx checks `if (!user || !profile) return <LoginScreen/>` BEFORE it works
-- out what kind of user someone is, so they signed in successfully and were
-- returned to the login screen with no message — indistinguishable from a wrong
-- password. This is the concrete cause behind "some users are not able to login".
--
--   malcom@boswa.ac.bw            created 2026-03-05   HOA
--   bonang@boswa.ac.bw            created 2026-03-05   HOD
--   tshepang@boswa.ac.bw          created 2026-03-05   Lecturer
--   gomolemommolawa@boswa.ac.bw   created 2026-04-17   Lecturer, Academics
--
-- The first three come from the seed-faculty list. That function created the
-- auth user, then wrote the profile and role WITHOUT CHECKING EITHER RESULT —
-- so when those writes failed it still reported "created". Fixed in the
-- function since; this repairs the accounts it left behind.
--
-- Note bonang is the HOD. The live role distribution showed hod=0, which is why:
-- the school's only Head of Department has never been able to sign in.
--
-- must_change_password is set to true. 20260812010000 flagged 149 accounts, but
-- it worked from `profiles` and these four had no row to flag — so without this
-- they would be the only staff still on the shared BoswaStaff2026! password with
-- nothing prompting them to change it.
--
-- Idempotent: safe to run more than once. Existing rows are updated, not
-- duplicated, and no password is touched.
-- ============================================================================

WITH staff(email, full_name, role_name, dept, code) AS (
  VALUES
    ('malcom@boswa.ac.bw',          'Malcom',            'hoy',      'Admin & Operations',    NULL),
    ('bonang@boswa.ac.bw',          'Bonang Keabetswe',  'hod',      'Culinary & Hospitality', NULL),
    ('tshepang@boswa.ac.bw',        'Tshepang Utlwang',  'lecturer', 'Culinary & Hospitality', '007'),
    ('gomolemommolawa@boswa.ac.bw', 'Gomolemo Mmolawa',  'lecturer', 'Academics',              NULL)
),
targets AS (
  SELECT u.id AS user_id, s.*
    FROM staff s
    JOIN auth.users u ON lower(u.email) = lower(s.email)
),
-- 1. The missing profile
ins_profile AS (
  INSERT INTO public.profiles (user_id, name, email, dept, code, must_change_password)
  SELECT t.user_id, t.full_name, t.email, t.dept, t.code, true
    FROM targets t
  ON CONFLICT (user_id) DO UPDATE
    SET name  = EXCLUDED.name,
        email = EXCLUDED.email,
        dept  = COALESCE(public.profiles.dept, EXCLUDED.dept),
        code  = COALESCE(public.profiles.code, EXCLUDED.code)
  RETURNING user_id
),
-- 2. The missing role. user_roles is UNIQUE(user_id, role) — not unique on
--    user_id alone — so clear any existing rows first to guarantee exactly one.
--    Two roles makes useAuth's .single() throw, which drops the person into the
--    applicant portal: a different flavour of "I can't log in".
del_roles AS (
  DELETE FROM public.user_roles
   WHERE user_id IN (SELECT user_id FROM targets)
  RETURNING user_id
),
ins_role AS (
  INSERT INTO public.user_roles (user_id, role)
  SELECT t.user_id, t.role_name::app_role FROM targets t
  RETURNING user_id
)
SELECT count(*) AS accounts_repaired FROM ins_role;


-- ── Verify ──────────────────────────────────────────────────────────────────
-- Expect four rows, each with a profile, exactly one role, and prompted = true.
SELECT u.email,
       p.name,
       coalesce((SELECT string_agg(r.role::text, '+') FROM public.user_roles r
                  WHERE r.user_id = u.id), 'STILL NO ROLE')        AS roles,
       coalesce(p.dept, '—')                                       AS dept,
       p.must_change_password                                      AS will_be_prompted
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.user_id = u.id
 WHERE lower(u.email) IN ('malcom@boswa.ac.bw','bonang@boswa.ac.bw',
                          'tshepang@boswa.ac.bw','gomolemommolawa@boswa.ac.bw')
 ORDER BY u.email;
