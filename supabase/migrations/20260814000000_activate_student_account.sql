-- ============================================================================
-- Enrolled applicants are stuck in the applicant portal
-- ============================================================================
-- Symptom: a student is enrolled and downloads their welcome letter. They sign
-- out, sign back in — and land on the applicant portal again, still an
-- applicant. Nothing in the UI reports a problem.
--
-- Cause: enrolment does
--
--     UPDATE user_roles SET role = 'student' WHERE user_id = ...
--
-- from the browser, as the admin. That statement is silent in BOTH of its
-- failure modes:
--
--   • RLS refuses the write → PostgREST returns success, zero rows changed.
--     This is the same silent-refusal pattern that stalled admissions and
--     swallowed timetable notifications.
--   • The applicant has no user_roles row at all — the signup INSERT in
--     PublicApplyPage is also unchecked — so the UPDATE matches nothing.
--     An UPDATE that matches nothing is not an error.
--
-- Either way the role stays 'applicant', AuthGate routes them back to the
-- portal, and the only visible evidence is a student saying "it still shows my
-- application".
--
-- Fix: one SECURITY DEFINER function that does the whole conversion as a unit
-- and REPORTS WHAT IT DID. It serves two callers:
--
--   • the admin enrolling someone            → activate_student_account(uid)
--   • the enrolled applicant activating       → activate_student_account()
--
-- Self-activation is safe because the precondition is checked HERE, against the
-- database, not asserted by the browser: the caller must already have an
-- application in status 'enrolled'. A user cannot grant themselves a role by
-- calling this; they can only claim one that admissions already decided.
-- 'student' is also the least-privileged role, so the blast radius of the
-- self-serve path is a user reaching the account they were already given.
--
-- Idempotent: running it on an already-active student re-links and returns ok.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.activate_student_account(p_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid          uuid;
  is_self      boolean;
  v_applicant  record;
  v_app_status text;
  v_student    record;
  v_prof       record;
BEGIN
  uid     := coalesce(p_user_id, auth.uid());
  is_self := (uid = auth.uid());

  IF uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'Not signed in.');
  END IF;

  -- Acting on somebody else requires admin. Acting on yourself requires only
  -- that admissions has enrolled you, which is checked below.
  IF NOT is_self
     AND NOT (has_role(auth.uid(), 'admin'::app_role)
           OR has_role(auth.uid(), 'super_admin'::app_role)) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'Not permitted.');
  END IF;

  SELECT * INTO v_applicant FROM applicants WHERE user_id = uid;
  IF v_applicant.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'No applicant record for this account.');
  END IF;

  -- THE gate. Enrolment is a decision made in admissions; this only carries it
  -- across to the login. Without an enrolled application there is nothing to
  -- claim, and self-activation cannot invent one.
  SELECT status INTO v_app_status
    FROM applications
   WHERE applicant_id = v_applicant.id
   ORDER BY submitted_at DESC NULLS LAST
   LIMIT 1;

  IF v_app_status IS DISTINCT FROM 'enrolled' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'This application is not enrolled yet'
                || coalesce(' (currently: ' || v_app_status || ')', '') || '.');
  END IF;

  SELECT * INTO v_prof FROM profiles WHERE user_id = uid;

  -- Find the students row created at enrolment. Prefer an existing link; fall
  -- back to national ID, then email. The fallbacks matter because the profile
  -- link is written by the SAME unchecked UPDATE that fails silently, so a
  -- student can be enrolled with the link missing.
  SELECT * INTO v_student FROM students WHERE id = v_prof.student_ref;

  IF v_student.id IS NULL AND coalesce(v_applicant.national_id, '') <> '' THEN
    SELECT * INTO v_student FROM students
     WHERE national_id = v_applicant.national_id AND status = 'active'
     ORDER BY enrolment_date DESC NULLS LAST LIMIT 1;
  END IF;

  IF v_student.id IS NULL AND coalesce(v_applicant.email, '') <> '' THEN
    SELECT * INTO v_student FROM students
     WHERE lower(email) = lower(v_applicant.email) AND status = 'active'
     ORDER BY enrolment_date DESC NULLS LAST LIMIT 1;
  END IF;

  IF v_student.id IS NULL THEN
    -- Enrolment marked the application but never created the student, or it
    -- was created under different details. Say so plainly rather than handing
    -- out a student login with no student behind it — that logs in to a blank
    -- system and reads as a fresh bug.
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'Enrolled, but no student record could be matched to this account. '
             || 'An administrator needs to link it on the Students page.');
  END IF;

  -- Role: replace, never add. user_roles carries UNIQUE(user_id, role), and a
  -- leftover 'applicant' row alongside 'student' makes the single-row read in
  -- useAuth non-deterministic — the portal would come back at random.
  DELETE FROM user_roles WHERE user_id = uid;
  INSERT INTO user_roles (user_id, role) VALUES (uid, 'student'::app_role);

  UPDATE profiles
     SET student_ref = v_student.id,
         student_id  = v_student.student_id,
         -- They have been using their application password, which was chosen
         -- before they were a student and may have been shared during
         -- admissions. Force a change on the way in.
         must_change_password = true
   WHERE user_id = uid;

  RETURN jsonb_build_object(
    'ok', true,
    'student_id', v_student.student_id,
    'name', v_student.name);
END $$;

REVOKE ALL ON FUNCTION public.activate_student_account(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.activate_student_account(uuid) TO authenticated;


-- ── Repair: anyone already enrolled and still stuck as an applicant ──────────
-- These are the students who enrolled before this fix and cannot get in.
DO $$
DECLARE
  r record;
  res jsonb;
  fixed int := 0;
  stuck int := 0;
BEGIN
  FOR r IN
    SELECT a.user_id
      FROM applicants a
      JOIN applications ap ON ap.applicant_id = a.id AND ap.status = 'enrolled'
     WHERE a.user_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM user_roles ur
                        WHERE ur.user_id = a.user_id AND ur.role = 'student'::app_role)
  LOOP
    res := public.activate_student_account(r.user_id);
    IF (res->>'ok')::boolean THEN
      fixed := fixed + 1;
      RAISE NOTICE 'activated % (%)', res->>'name', res->>'student_id';
    ELSE
      stuck := stuck + 1;
      RAISE NOTICE 'COULD NOT activate %: %', r.user_id, res->>'reason';
    END IF;
  END LOOP;
  RAISE NOTICE '--- % activated, % need attention ---', fixed, stuck;
END $$;


-- ── Verify ──────────────────────────────────────────────────────────────────
-- 1. Enrolled applications and where each account actually stands. Anything
--    other than 'ok — student' is a person who cannot reach their account.
SELECT coalesce(a.name, '—')     AS applicant,
       coalesce(ur.role::text, '(no role)') AS role_now,
       CASE
         WHEN ur.role = 'student'::app_role AND p.student_ref IS NOT NULL THEN 'ok — student'
         WHEN ur.role = 'student'::app_role THEN 'student role, but profile not linked'
         ELSE 'STUCK — still lands on the applicant portal'
       END AS state
  FROM applicants a
  JOIN applications ap ON ap.applicant_id = a.id AND ap.status = 'enrolled'
  LEFT JOIN user_roles ur ON ur.user_id = a.user_id
  LEFT JOIN profiles   p  ON p.user_id  = a.user_id
 ORDER BY state, applicant;

-- 2. Accounts carrying more than one role — the portal reappears at random for
--    these, because useAuth reads a single row.
SELECT user_id, string_agg(role::text, ' + ' ORDER BY role::text) AS roles
  FROM user_roles GROUP BY user_id HAVING count(*) > 1;
