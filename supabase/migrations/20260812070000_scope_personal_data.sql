-- ============================================================================
-- Stop every signed-in user reading (and in places writing) everyone's data
-- ============================================================================
-- Today a student account can read every other student's marks, attendance and
-- submissions, every applicant's date of birth / national ID / guardian
-- contacts, and the HR biometric punch log — because those tables carry a
-- blanket `USING (true)` SELECT policy for `authenticated`. On assessment_marks
-- the blanket policies cover INSERT and UPDATE too, so a student can write
-- marks.
--
-- The app filters all of this in JavaScript, which is a display convention, not
-- a boundary: the rows are already in the browser and visible in devtools.
--
-- WHAT THIS DOES NOT DO
--   Per-lecturer scoping is NOT enforced here. Staff see all student records at
--   the database level, scoped to their own classes in the app (see
--   src/lib/scope.ts). Encoding "this lecturer, these classes" in a policy is
--   where this change could genuinely break screens; staff-see-all is already a
--   large improvement and can be tightened later against real usage.
--
-- WHAT IS DELIBERATELY LEFT OPEN
--   Curriculum and reference data — classes, modules, module_classes,
--   programmes, programme_modules, departments, rooms, terms, public_holidays,
--   school_config, notifications, timetable, exams, assignments, module_notes.
--   None holds personal data, and several are read by the anonymous /apply form.
--
--   THE ENTIRE HR SIDE. Nothing under HR is touched by this migration, by
--   instruction. Note this leaves attendance_records (the biometric punch log),
--   attendance_devices and attendance_settings readable by every signed-in
--   account, students included — worth revisiting separately, but out of scope
--   here.
--
-- Policies are dropped BY EXPRESSION, not by name. This database's policy names
-- do not match its migration files — `lecturer_modules` carried one called
-- "Allow all" where the file said "Allow all for authenticated", so a
-- DROP POLICY IF EXISTS on the documented name matched nothing and silently
-- left the table world-writable. Only blanket-permissive policies
-- (USING true / WITH CHECK true) are removed; narrower ones — "Students can
-- insert submissions", the applicants' own-row policies — are left intact.
--
-- Idempotent: safe to run more than once.
-- ============================================================================


-- ── Helpers ─────────────────────────────────────────────────────────────────
-- SECURITY DEFINER so they bypass RLS on profiles/user_roles. Without that a
-- policy on a table that reads profiles would recurse or silently return null.
-- Same property the existing has_role() relies on.

CREATE OR REPLACE FUNCTION public.is_school_staff(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
     WHERE user_id = _uid
       AND role IN ('admin','super_admin','hod','hoy','lecturer')
  );
$$;

-- students.id — the record key. marks, attendance, submissions and
-- student_modules all key on this.
CREATE OR REPLACE FUNCTION public.my_student_ref(_uid uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT student_ref FROM public.profiles WHERE user_id = _uid LIMIT 1;
$$;

-- students.student_id — the human number. assessment_marks keys on THIS one
-- instead; the two tables genuinely disagree, so both helpers are needed.
CREATE OR REPLACE FUNCTION public.my_student_number(_uid uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT student_id FROM public.profiles WHERE user_id = _uid LIMIT 1;
$$;


-- ── Remove the blanket policies on the tables being scoped ──────────────────
DO $$
DECLARE
  targets text[] := ARRAY[
    -- students see only their own
    'marks','assessment_marks','attendance','submissions','student_modules',
    -- staff only
    'applicants','applications','admission_enquiries'
  ];
  r record;
BEGIN
  FOR r IN
    SELECT tablename, policyname
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = ANY(targets)
       AND (qual = 'true' OR with_check = 'true')
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', r.policyname, r.tablename);
    RAISE NOTICE 'dropped blanket policy % on %', r.policyname, r.tablename;
  END LOOP;
END $$;


-- ── Tier 2: students see their own row; staff see all ───────────────────────

CREATE POLICY "Staff read marks" ON public.marks FOR SELECT TO authenticated
  USING (is_school_staff(auth.uid()));
CREATE POLICY "Students read own marks" ON public.marks FOR SELECT TO authenticated
  USING (student_id = my_student_ref(auth.uid()));
CREATE POLICY "Staff write marks" ON public.marks FOR ALL TO authenticated
  USING (is_school_staff(auth.uid())) WITH CHECK (is_school_staff(auth.uid()));

-- assessment_marks keys on the student NUMBER, not the record key.
CREATE POLICY "Staff read assessment_marks" ON public.assessment_marks FOR SELECT TO authenticated
  USING (is_school_staff(auth.uid()));
CREATE POLICY "Students read own assessment_marks" ON public.assessment_marks FOR SELECT TO authenticated
  USING (student_id = my_student_number(auth.uid()));
-- Previously any authenticated user could INSERT and UPDATE here — a student
-- could award themselves marks in the table the reports actually use.
CREATE POLICY "Staff write assessment_marks" ON public.assessment_marks FOR ALL TO authenticated
  USING (is_school_staff(auth.uid())) WITH CHECK (is_school_staff(auth.uid()));

CREATE POLICY "Staff read attendance" ON public.attendance FOR SELECT TO authenticated
  USING (is_school_staff(auth.uid()));
CREATE POLICY "Students read own attendance" ON public.attendance FOR SELECT TO authenticated
  USING (student_id = my_student_ref(auth.uid()));
CREATE POLICY "Staff write attendance" ON public.attendance FOR ALL TO authenticated
  USING (is_school_staff(auth.uid())) WITH CHECK (is_school_staff(auth.uid()));

CREATE POLICY "Staff read submissions" ON public.submissions FOR SELECT TO authenticated
  USING (is_school_staff(auth.uid()));
CREATE POLICY "Students read own submissions" ON public.submissions FOR SELECT TO authenticated
  USING (student_id = my_student_ref(auth.uid()));

CREATE POLICY "Staff read student_modules" ON public.student_modules FOR SELECT TO authenticated
  USING (is_school_staff(auth.uid()));
CREATE POLICY "Students read own student_modules" ON public.student_modules FOR SELECT TO authenticated
  USING (student_id = my_student_ref(auth.uid()));


-- ── Tier 3: admissions data — staff only, plus the applicant's own ──────────
-- The applicants'/applications' own-row policies are not touched by the drop
-- above (their expressions are not blanket-true), so the applicant portal keeps
-- working. These add staff access back, since the blanket read is gone.

CREATE POLICY "Staff read applicants" ON public.applicants FOR SELECT TO authenticated
  USING (is_school_staff(auth.uid()));
CREATE POLICY "Staff read applications" ON public.applications FOR SELECT TO authenticated
  USING (is_school_staff(auth.uid()));
CREATE POLICY "Staff read admission_enquiries" ON public.admission_enquiries FOR SELECT TO authenticated
  USING (is_school_staff(auth.uid()));
CREATE POLICY "Staff manage admission_enquiries" ON public.admission_enquiries FOR ALL TO authenticated
  USING (is_school_staff(auth.uid())) WITH CHECK (is_school_staff(auth.uid()));


-- ── Verify ──────────────────────────────────────────────────────────────────
-- Expect blanket_policies = 0 on every row.
SELECT tablename,
       count(*)                                                   AS policies,
       count(*) FILTER (WHERE qual = 'true' OR with_check = 'true') AS blanket_policies
  FROM pg_policies
 WHERE schemaname = 'public'
   AND tablename IN ('marks','assessment_marks','attendance','submissions','student_modules',
                     'applicants','applications','admission_enquiries')
 GROUP BY tablename
 ORDER BY tablename;
