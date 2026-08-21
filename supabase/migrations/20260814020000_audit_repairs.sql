-- ============================================================================
-- Repairs from the data-flow audit
-- ============================================================================
-- Three separate problems, deliberately kept apart because only the first is
-- safe to apply blind.
--
--   PART 1  Policies that apply to PUBLIC — tightened to authenticated.
--           Safe: no signed-in user loses access.
--   PART 2  Orphaned marks and broken accounts — REPORTED, not deleted.
--           Deleting marks is not reversible and is not my call.
--   PART 3  The real super_admin picture, per table rather than per policy.
--
-- Nothing here deletes data.
-- ============================================================================


-- ── PART 1. Policies covering anonymous visitors ────────────────────────────
-- A policy written without a TO clause applies to PUBLIC, which includes the
-- anon role — an unauthenticated visitor holding only the publishable key. The
-- USING expression still has to pass, and these all call auth.uid() or
-- has_role(), which fail for anon, so this is not currently an open door.
--
-- It is still wrong. It means the only thing standing between an anonymous
-- request and the whole students table is that one expression, rather than the
-- role grant AND the expression. Depth matters on personal data: the next
-- person to write a policy with a slightly looser USING clause gets a leak
-- instead of a bug.
--
-- Rewriting them TO authenticated changes nothing for any real user.
DO $$
DECLARE
  r record;
  n int := 0;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname, cmd, permissive, qual, with_check
      FROM pg_policies
     WHERE schemaname = 'public'
       AND 'public' = ANY(roles)
       AND tablename IN ('students','profiles','user_roles','assessment_marks',
                         'attendance','submissions','applications','applicants',
                         'marks','student_modules','module_notes')
  LOOP
    -- Anonymous applicants must still reach the public application form, so the
    -- two policies that exist for them are left exactly as they are.
    IF r.policyname IN ('applicants_read_own_record', 'applicants_read_own_application') THEN
      RAISE NOTICE 'left alone (public application flow needs it): %.%', r.tablename, r.policyname;
      CONTINUE;
    END IF;

    EXECUTE format('DROP POLICY %I ON public.%I', r.policyname, r.tablename);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS %s FOR %s TO authenticated %s %s',
      r.policyname, r.tablename,
      CASE WHEN r.permissive = 'PERMISSIVE' THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END,
      CASE r.cmd WHEN 'ALL' THEN 'ALL' ELSE r.cmd END,
      CASE WHEN r.qual       IS NOT NULL THEN 'USING (' || r.qual || ')'            ELSE '' END,
      CASE WHEN r.with_check IS NOT NULL THEN 'WITH CHECK (' || r.with_check || ')' ELSE '' END);
    n := n + 1;
    RAISE NOTICE 'now authenticated-only: %.%', r.tablename, r.policyname;
  END LOOP;
  RAISE NOTICE '--- % policies tightened ---', n;
END $$;


-- ── PART 2. What is broken, in enough detail to decide ──────────────────────
-- No DELETEs. Marks are not recoverable and accounts belong to real people.

-- 2a. Orphaned marks: recorded against an assessment that no longer exists.
--     They count toward nothing and no student can see them. Whoever deleted
--     those exams left the marks behind.
SELECT 'orphaned marks' AS item,
       am.assessment_id,
       am.assessment_type,
       coalesce(m.name, '(unknown module)') AS module,
       count(*)                             AS marks,
       min(am.created_at)::date             AS first_recorded,
       string_agg(DISTINCT am.student_id, ', ' ORDER BY am.student_id) AS students
  FROM assessment_marks am
  LEFT JOIN modules m ON m.id = am.module_id
 WHERE NOT EXISTS (SELECT 1 FROM assignments a WHERE a.id = am.assessment_id)
   AND NOT EXISTS (SELECT 1 FROM exams e      WHERE e.id = am.assessment_id)
 GROUP BY am.assessment_id, am.assessment_type, m.name
 ORDER BY marks DESC;

-- 2b. Accounts that cannot work, and why. Each row is one person who either
--     cannot sign in or signs in to nothing.
SELECT 'broken account' AS item,
       u.email,
       CASE
         WHEN p.user_id IS NULL              THEN 'no profile — cannot sign in at all'
         WHEN ur.role IS NULL                THEN 'no role — treated as an applicant'
         WHEN ur.role = 'student'::app_role
              AND (p.student_ref IS NULL OR p.student_id IS NULL)
                                             THEN 'student role, but not linked to a student record'
         ELSE 'ok'
       END AS problem,
       u.created_at::date AS created,
       u.last_sign_in_at::date AS last_signed_in
  FROM auth.users u
  LEFT JOIN profiles   p  ON p.user_id  = u.id
  LEFT JOIN user_roles ur ON ur.user_id = u.id
 WHERE p.user_id IS NULL
    OR ur.role IS NULL
    OR (ur.role = 'student'::app_role AND (p.student_ref IS NULL OR p.student_id IS NULL))
 ORDER BY created;

-- 2c. Student records with no login, and whether a login exists under the same
--     email waiting to be linked. 'link this one' means the account is already
--     there and only the join is missing.
SELECT 'student without login' AS item,
       s.student_id, s.name, coalesce(c.name, '(no class)') AS class,
       CASE WHEN u.id IS NOT NULL THEN 'link this one: ' || u.email
            ELSE 'no account exists — provision one' END AS action
  FROM students s
  LEFT JOIN classes c    ON c.id = s.class_id
  LEFT JOIN auth.users u ON lower(u.email) = lower(s.email)
 WHERE s.status = 'active'
   AND NOT EXISTS (SELECT 1 FROM profiles p WHERE p.student_ref = s.id)
 ORDER BY s.name;


-- ── PART 3. super_admin, per TABLE ──────────────────────────────────────────
-- The audit reported 30 policies "excluding super_admin" and that count was
-- misleading. Postgres combines PERMISSIVE policies with OR, so an old
-- admin-only policy sitting beside a newer admin-or-super_admin one blocks
-- nothing. The question is not whether a policy omits super_admin — it is
-- whether the TABLE has any write policy that grants it.
--
-- A RESTRICTIVE policy is the exception: those are ANDed, so one that omits
-- super_admin really does block. Counted separately for that reason.
SELECT tablename,
       count(*) FILTER (WHERE grants_super)                            AS grants_super_admin,
       count(*) FILTER (WHERE NOT grants_super)                        AS admin_only,
       count(*) FILTER (WHERE NOT grants_super AND NOT is_permissive)  AS blocking_restrictive,
       CASE
         WHEN count(*) FILTER (WHERE NOT grants_super AND NOT is_permissive) > 0
           THEN 'FAULT — a RESTRICTIVE policy blocks super_admin'
         WHEN count(*) FILTER (WHERE grants_super) = 0
           THEN 'FAULT — super_admin cannot write this table'
         ELSE 'ok'
       END AS verdict
  FROM (
    SELECT tablename,
           permissive = 'PERMISSIVE'                                       AS is_permissive,
           coalesce(qual,'') || coalesce(with_check,'') LIKE '%super_admin%' AS grants_super
      FROM pg_policies
     WHERE schemaname = 'public' AND cmd <> 'SELECT'
       AND coalesce(qual,'') || coalesce(with_check,'') LIKE '%admin%'
  ) x
 GROUP BY tablename
 ORDER BY verdict DESC, tablename;
