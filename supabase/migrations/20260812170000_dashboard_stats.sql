-- ============================================================================
-- Dashboard statistics, computed in the database
-- ============================================================================
-- Run AFTER 20260812160000 has been applied on its own — these functions
-- reference the new enum values, which cannot be used in the transaction that
-- created them.
--
-- WHY FUNCTIONS RATHER THAN CLIENT-SIDE FILTERING
--   The current dashboard derives everything from the bulk-loaded `db` object:
--   db.students.length, db.attendance.filter(...), and so on. That is fine at
--   141 students. It is not fine for a school-wide view: attendance grows by
--   ~1,400 rows a week now that registers save, and assessment_marks is already
--   3,200 rows. Computing a pass rate by downloading every mark into the browser
--   would be slow, would get slower every term, and would hit the same 1,000-row
--   response cap that made the bulk loader unreliable in the first place.
--
--   Each function returns a handful of already-summed numbers. One small request
--   per dashboard, and the cost stays flat as the data grows.
--
-- WHY SECURITY DEFINER WITH AN EXPLICIT CHECK
--   A dashboard needs to aggregate across rows the caller cannot read
--   individually — that is the point of an aggregate. So these run with the
--   definer's rights and check the caller's role in the first statement. A
--   student calling one gets an exception, not a leak. Never widen one of these
--   without re-reading that check.
--
-- Idempotent: CREATE OR REPLACE throughout. No data is touched.
-- ============================================================================


-- ── Who may see what ────────────────────────────────────────────────────────

-- Whole-school oversight: admins, HOA, and the two new read-only roles.
CREATE OR REPLACE FUNCTION public.can_view_school(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
     WHERE user_id = _uid
       AND role IN ('admin','super_admin','hoa','principal','deputy_principal')
  );
$$;

-- Read-only oversight roles, used to hide edit controls rather than to grant.
CREATE OR REPLACE FUNCTION public.is_oversight_only(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
     WHERE user_id = _uid
       AND role IN ('principal','deputy_principal')
  );
$$;


-- ── Read access for the new roles ───────────────────────────────────────────
-- Whole-school READ, added alongside the existing staff policies rather than
-- replacing them. SELECT only — no INSERT, UPDATE or DELETE policy is created
-- for these roles anywhere, which is what makes them read-only.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'students','marks','assessment_marks','attendance','submissions',
    'student_modules','applicants','applications','admission_enquiries',
    'profiles','user_roles','lecturer_modules'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Oversight reads ' || t, t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (is_oversight_only(auth.uid()))',
      'Oversight reads ' || t, t);
  END LOOP;
END $$;


-- ── School-wide statistics — principal, deputy, admins, HOA ─────────────────
CREATE OR REPLACE FUNCTION public.dashboard_school_stats()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE result jsonb;
BEGIN
  IF NOT public.can_view_school(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorised to view school statistics';
  END IF;

  SELECT jsonb_build_object(
    'active_students',   (SELECT count(*) FROM students WHERE status = 'active'),
    'total_students',    (SELECT count(*) FROM students),
    'teaching_staff',    (SELECT count(DISTINCT user_id) FROM user_roles
                           WHERE role IN ('lecturer','hod','hoa')),
    'classes',           (SELECT count(*) FROM classes),
    'modules',           (SELECT count(*) FROM modules),
    'programmes',        (SELECT count(*) FROM programmes),

    -- Attendance: present as a share of every register taken.
    'attendance_rate',   (SELECT CASE WHEN count(*) = 0 THEN NULL
                                 ELSE round(100.0 * count(*) FILTER (WHERE status = 'present') / count(*)) END
                            FROM attendance),
    'registers_taken',   (SELECT count(*) FROM attendance),

    -- Marking progress: assessments with at least one mark, out of all set.
    'assessments_set',   (SELECT (SELECT count(*) FROM exams) + (SELECT count(*) FROM assignments)),
    'assessments_marked',(SELECT count(DISTINCT assessment_id) FROM assessment_marks),

    -- Grades across everything marked.
    'marks_recorded',    (SELECT count(*) FROM assessment_marks),
    'pass_rate',         (SELECT CASE WHEN count(*) = 0 THEN NULL
                                 ELSE round(100.0 * count(*) FILTER (WHERE score >= 50) / count(*)) END
                            FROM assessment_marks),
    'at_risk_marks',     (SELECT count(*) FROM assessment_marks WHERE score < 50),

    -- Admissions pipeline, by status.
    'applications',      (SELECT coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
                            FROM (SELECT coalesce(status,'unknown') AS status, count(*) AS n
                                    FROM applications GROUP BY 1) a),

    -- Operational health — the things that silently break the system.
    'classes_no_modules',(SELECT count(*) FROM classes c
                           WHERE NOT EXISTS (SELECT 1 FROM module_classes mc WHERE mc.class_id = c.id)),
    'staff_no_modules',  (SELECT count(*) FROM user_roles r
                           WHERE r.role IN ('lecturer','hod','hoa')
                             AND NOT EXISTS (SELECT 1 FROM lecturer_modules lm
                                              WHERE lm.lecturer_id = r.user_id::text)),
    'students_no_login', (SELECT count(*) FROM students s
                           WHERE s.status = 'active'
                             AND NOT EXISTS (SELECT 1 FROM profiles p
                                              WHERE p.student_id = s.student_id OR p.student_ref = s.id))
  ) INTO result;

  RETURN result;
END $$;


-- ── Attendance and marks per department ─────────────────────────────────────
-- Drives the principal's "weakest department" panel and the HOD's own view.
CREATE OR REPLACE FUNCTION public.dashboard_department_stats()
RETURNS TABLE (
  dept_id text, dept_name text,
  students bigint, modules bigint, lecturers bigint,
  attendance_rate numeric, pass_rate numeric, marks_recorded bigint
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (public.can_view_school(auth.uid()) OR has_role(auth.uid(), 'hod'::app_role)) THEN
    RAISE EXCEPTION 'Not authorised to view department statistics';
  END IF;

  RETURN QUERY
  WITH dept_modules AS (
    SELECT d.id AS dept_id, d.name AS dept_name, m.id AS module_id
      FROM departments d
      LEFT JOIN modules m ON m.dept = d.id
  ),
  dept_classes AS (
    SELECT DISTINCT dm.dept_id, mc.class_id
      FROM dept_modules dm
      JOIN module_classes mc ON mc.module_id = dm.module_id
  )
  SELECT d.id, d.name,
         (SELECT count(*) FROM students s
           WHERE s.status = 'active'
             AND s.class_id IN (SELECT class_id FROM dept_classes WHERE dept_id = d.id)),
         (SELECT count(*) FROM modules m WHERE m.dept = d.id),
         (SELECT count(DISTINCT lm.lecturer_id) FROM lecturer_modules lm
           WHERE lm.module_id IN (SELECT m.id FROM modules m WHERE m.dept = d.id)),
         (SELECT CASE WHEN count(*) = 0 THEN NULL
                 ELSE round(100.0 * count(*) FILTER (WHERE a.status = 'present') / count(*)) END
            FROM attendance a
           WHERE a.class_id IN (SELECT class_id FROM dept_classes WHERE dept_id = d.id)),
         (SELECT CASE WHEN count(*) = 0 THEN NULL
                 ELSE round(100.0 * count(*) FILTER (WHERE am.score >= 50) / count(*)) END
            FROM assessment_marks am
           WHERE am.module_id IN (SELECT m.id FROM modules m WHERE m.dept = d.id)),
         (SELECT count(*) FROM assessment_marks am
           WHERE am.module_id IN (SELECT m.id FROM modules m WHERE m.dept = d.id))
    FROM departments d
   ORDER BY d.name;
END $$;


-- ── A lecturer's own outstanding work ───────────────────────────────────────
-- "What is waiting on me" — the most actionable thing a lecturer needs.
CREATE OR REPLACE FUNCTION public.dashboard_lecturer_stats()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  result jsonb;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not signed in';
  END IF;

  SELECT jsonb_build_object(
    'classes',  (SELECT count(DISTINCT class_id)  FROM lecturer_modules WHERE lecturer_id = uid::text),
    'modules',  (SELECT count(DISTINCT module_id) FROM lecturer_modules WHERE lecturer_id = uid::text),
    'students', (SELECT count(*) FROM students s
                  WHERE s.status = 'active'
                    AND s.class_id IN (SELECT class_id FROM lecturer_modules WHERE lecturer_id = uid::text)),

    -- Submissions with no grade yet, on this lecturer's assignments.
    'ungraded_submissions', (SELECT count(*) FROM submissions sub
                              JOIN assignments a ON a.id = sub.assignment_id
                             WHERE sub.grade IS NULL
                               AND (a.module_id, a.class_id) IN
                                   (SELECT module_id, class_id FROM lecturer_modules WHERE lecturer_id = uid::text)),

    -- Assessments set but with no marks entered at all.
    'unmarked_assessments', (SELECT count(*) FROM (
                               SELECT a.id FROM assignments a
                                WHERE (a.module_id, a.class_id) IN
                                      (SELECT module_id, class_id FROM lecturer_modules WHERE lecturer_id = uid::text)
                                  AND NOT EXISTS (SELECT 1 FROM assessment_marks am WHERE am.assessment_id = a.id)
                               UNION ALL
                               SELECT e.id FROM exams e
                                WHERE (e.module_id, e.class_id) IN
                                      (SELECT module_id, class_id FROM lecturer_modules WHERE lecturer_id = uid::text)
                                  AND NOT EXISTS (SELECT 1 FROM assessment_marks am WHERE am.assessment_id = e.id)
                             ) x),

    -- Attendance actually taken by this lecturer's classes in the last fortnight.
    'registers_last_14d', (SELECT count(DISTINCT (class_id, module_id, date, session))
                             FROM attendance
                            WHERE date >= current_date - 14
                              AND class_id IN (SELECT class_id FROM lecturer_modules WHERE lecturer_id = uid::text)),

    'attendance_rate', (SELECT CASE WHEN count(*) = 0 THEN NULL
                               ELSE round(100.0 * count(*) FILTER (WHERE status = 'present') / count(*)) END
                          FROM attendance
                         WHERE class_id IN (SELECT class_id FROM lecturer_modules WHERE lecturer_id = uid::text))
  ) INTO result;

  RETURN result;
END $$;


-- ── Verify ──────────────────────────────────────────────────────────────────
SELECT p.proname AS function,
       CASE WHEN p.prosecdef THEN 'security definer' ELSE 'invoker' END AS mode
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('can_view_school','is_oversight_only',
                     'dashboard_school_stats','dashboard_department_stats','dashboard_lecturer_stats')
 ORDER BY p.proname;
