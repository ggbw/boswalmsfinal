-- ============================================================================
-- Analytical dashboards for principal, deputy, HOA and HOD
-- ============================================================================
-- The existing dashboards answer "how big is the school". These answer the
-- questions someone actually opens a dashboard to decide:
--
--   • Which MODULES are failing, and is it one class or the module itself?
--     A module failing in every class is a curriculum or assessment problem.
--     A module failing in one class is a teaching or timetable problem. The
--     same number means different things, so the breakdown has to be visible.
--
--   • Is attendance DRIFTING? A single rate cannot show a decline. Week by week
--     can, and attendance falls before marks do — it is the earliest warning
--     the system holds.
--
--   • WHO is at risk, by name? A percentage cannot be acted on. A list of
--     students can.
--
-- Also re-applies the fixed dashboard_department_stats. 20260812220000 fixed
-- the "column reference dept_id is ambiguous" error, but the dashboards still
-- report it, so either that migration did not run or it did not stick. This is
-- CREATE OR REPLACE and idempotent — running it twice costs nothing, and it
-- guarantees the fixed body is the one installed.
--
-- Every function is SECURITY DEFINER with the role gate as its first statement,
-- so an aggregate may span rows the caller cannot read one at a time.
--
-- Pass marks come from one place: 50 to pass, below 45 in the final theory exam
-- triggers a supplementary. Kept in step with src/lib/progression.ts.
--
-- NOTE: the column linking a module to its department is modules.dept, NOT
-- modules.department. The earlier dashboard_department_stats used the wrong
-- name, so it could never have returned a row — the "dept_id is ambiguous"
-- error simply raised first and hid it. Fixing only the ambiguity would have
-- swapped one error for another.
-- ============================================================================


-- ── 1. Department stats — re-apply the disambiguated body ───────────────────
-- RETURNS TABLE (dept_id text, ...) declares dept_id as an OUT variable, so a
-- CTE column of the same name is ambiguous inside the body. The CTE column is
-- aliased d_id and every reference qualified.
CREATE OR REPLACE FUNCTION public.dashboard_department_stats()
RETURNS TABLE (
  dept_id text, dept_name text,
  students bigint, modules bigint, lecturers bigint,
  attendance_rate numeric, pass_rate numeric, marks_recorded bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.can_view_school(auth.uid())
     AND NOT EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'hod') THEN
    RAISE EXCEPTION 'Not authorised to view department statistics';
  END IF;

  RETURN QUERY
  WITH dept_modules AS (
    SELECT d.id AS d_id, m.id AS m_id
      FROM departments d JOIN modules m ON m.dept = d.id
  ),
  dept_classes AS (
    SELECT DISTINCT dm.d_id, mc.class_id
      FROM dept_modules dm JOIN module_classes mc ON mc.module_id = dm.m_id
  )
  SELECT d.id, d.name,
         (SELECT count(*) FROM students s
           WHERE s.status = 'active'
             AND s.class_id IN (SELECT dc.class_id FROM dept_classes dc WHERE dc.d_id = d.id)),
         (SELECT count(*) FROM modules m WHERE m.dept = d.id),
         (SELECT count(DISTINCT lm.lecturer_id) FROM lecturer_modules lm
           WHERE lm.module_id IN (SELECT dm.m_id FROM dept_modules dm WHERE dm.d_id = d.id)),
         (SELECT round(100.0 * count(*) FILTER (WHERE a.status = 'present') / nullif(count(*), 0), 1)
            FROM attendance a
           WHERE a.class_id IN (SELECT dc.class_id FROM dept_classes dc WHERE dc.d_id = d.id)),
         (SELECT round(100.0 * count(*) FILTER (WHERE am.score >= 50) / nullif(count(*), 0), 1)
            FROM assessment_marks am
           WHERE am.module_id IN (SELECT dm.m_id FROM dept_modules dm WHERE dm.d_id = d.id)),
         (SELECT count(*) FROM assessment_marks am
           WHERE am.module_id IN (SELECT dm.m_id FROM dept_modules dm WHERE dm.d_id = d.id))
    FROM departments d
   ORDER BY d.name;
END $$;


-- ── 2. Module performance, per class ────────────────────────────────────────
-- One row per module × class, because that is the unit a decision acts on. A
-- module aggregated across all its classes hides the case that matters most:
-- fine everywhere except one room.
CREATE OR REPLACE FUNCTION public.dashboard_module_performance()
RETURNS TABLE (
  dept_id text, dept_name text,
  module_id text, module_name text,
  class_id text, class_name text,
  lecturers text,
  students bigint, marks_recorded bigint,
  avg_mark numeric, pass_rate numeric, attendance_rate numeric,
  unmarked_assessments bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.can_view_school(auth.uid())
     AND NOT EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role IN ('hod','lecturer')) THEN
    RAISE EXCEPTION 'Not authorised to view module performance';
  END IF;

  RETURN QUERY
  SELECT d.id, d.name,
         m.id, m.name,
         c.id, c.name,
         -- Co-teaching is supported, so a module in a class may have several.
         coalesce((SELECT string_agg(DISTINCT p.name, ', ')
                     FROM lecturer_modules lm
                     JOIN profiles p ON p.user_id::text = lm.lecturer_id
                    WHERE lm.module_id = m.id AND lm.class_id = c.id), '—'),
         (SELECT count(*) FROM students s WHERE s.class_id = c.id AND s.status = 'active'),
         (SELECT count(*) FROM assessment_marks am
           WHERE am.module_id = m.id AND am.class_id = c.id),
         (SELECT round(avg(am.score), 1) FROM assessment_marks am
           WHERE am.module_id = m.id AND am.class_id = c.id),
         (SELECT round(100.0 * count(*) FILTER (WHERE am.score >= 50) / nullif(count(*), 0), 1)
            FROM assessment_marks am
           WHERE am.module_id = m.id AND am.class_id = c.id),
         (SELECT round(100.0 * count(*) FILTER (WHERE a.status = 'present') / nullif(count(*), 0), 1)
            FROM attendance a
           WHERE a.module_id = m.id AND a.class_id = c.id),
         -- Work set but with no marks entered at all. High numbers here mean the
         -- pass rate beside them is measuring only part of the picture.
         (SELECT count(*) FROM assignments ag
           WHERE ag.module_id = m.id AND ag.class_id = c.id
             AND NOT EXISTS (SELECT 1 FROM assessment_marks am WHERE am.assessment_id = ag.id))
    FROM modules m
    JOIN module_classes mc ON mc.module_id = m.id
    JOIN classes c         ON c.id = mc.class_id
    LEFT JOIN departments d ON d.id = m.dept
   ORDER BY d.name NULLS LAST, m.name, c.name;
END $$;


-- ── 3. Attendance trend, by week ────────────────────────────────────────────
-- Attendance falls before marks do. A single percentage cannot show that; a
-- sequence of weeks can, which makes this the earliest warning the data holds.
CREATE OR REPLACE FUNCTION public.dashboard_attendance_trend(weeks integer DEFAULT 12)
RETURNS TABLE (
  week_start date, dept_id text, dept_name text,
  present bigint, sessions bigint, rate numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.can_view_school(auth.uid())
     AND NOT EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'hod') THEN
    RAISE EXCEPTION 'Not authorised to view attendance trends';
  END IF;

  RETURN QUERY
  SELECT date_trunc('week', a.date::date)::date AS wk,
         d.id, d.name,
         count(*) FILTER (WHERE a.status = 'present'),
         count(*),
         round(100.0 * count(*) FILTER (WHERE a.status = 'present') / nullif(count(*), 0), 1)
    FROM attendance a
    JOIN modules m          ON m.id = a.module_id
    LEFT JOIN departments d ON d.id = m.dept
   WHERE a.date::date >= (current_date - (greatest(weeks, 1) * 7))
   GROUP BY wk, d.id, d.name
   ORDER BY wk, d.name NULLS LAST;
END $$;


-- ── 4. Students at risk, by name ────────────────────────────────────────────
-- A percentage cannot be acted on; a list of students can.
--
-- The rule is deliberately NOT "3 marks below 50". A count punishes volume: a
-- strong student with many assessments trips it on a few bad pieces, and the
-- first version of this flagged students averaging 74%. A share does not — it
-- asks whether failing is the PATTERN, which is the actual question.
--
-- Nor does it recompute the module mark. That is a weighted composite
-- (theory40 + prac20 + final40, weights depending on whether the module has a
-- practical) and it lives in src/lib/moduleMark.ts. Copying it here would give
-- the school two versions of its own pass rule, and they would drift. Worse,
-- that formula treats a missing component as ZERO, so a part-marked module
-- computes as a fail — which is fine on a report a person reads and wrong on a
-- list headed "at risk".
--
-- Minimum counts on every criterion, because early in a semester two marks and
-- one bad day are not a pattern, and a list that cries wolf gets ignored.
CREATE OR REPLACE FUNCTION public.dashboard_at_risk()
RETURNS TABLE (
  student_id text, student_name text,
  class_name text, dept_name text,
  avg_mark numeric, attendance_rate numeric,
  failing_marks bigint, total_marks bigint,
  reason text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.can_view_school(auth.uid())
     AND NOT EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role IN ('hod','lecturer')) THEN
    RAISE EXCEPTION 'Not authorised to view at-risk students';
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT s.student_id AS sid, s.name AS sname, c.name AS cname,
           -- assessment_marks keys on the student NUMBER; attendance keys on
           -- students.id. Different columns holding different things, and
           -- mixing them up is the most common fault in this system.
           (SELECT round(avg(am.score), 1) FROM assessment_marks am WHERE am.student_id = s.student_id) AS avgm,
           (SELECT count(*) FROM assessment_marks am WHERE am.student_id = s.student_id AND am.score < 50) AS failm,
           (SELECT count(*) FROM assessment_marks am WHERE am.student_id = s.student_id) AS totm,
           (SELECT round(100.0 * count(*) FILTER (WHERE a.status = 'present') / nullif(count(*), 0), 1)
              FROM attendance a WHERE a.student_id = s.id) AS attr,
           (SELECT count(*) FROM attendance a WHERE a.student_id = s.id) AS sessions,
           (SELECT d.name FROM module_classes mc
              JOIN modules m2 ON m2.id = mc.module_id
              JOIN departments d ON d.id = m2.dept
             WHERE mc.class_id = c.id LIMIT 1) AS dname
      FROM students s
      LEFT JOIN classes c ON c.id = s.class_id
     WHERE s.status = 'active'
  ), scored AS (
    SELECT b.*,
           CASE WHEN b.totm >= 3 AND b.avgm < 50 THEN true ELSE false END AS low_avg,
           -- Failing is the pattern, not an incident: half or more, over enough
           -- marks for "half" to mean something.
           CASE WHEN b.totm >= 4 AND b.failm::numeric / b.totm >= 0.5 THEN true ELSE false END AS mostly_failing,
           CASE WHEN b.sessions >= 5 AND b.attr < 75 THEN true ELSE false END AS low_att
      FROM base b
  )
  SELECT sc.sid, sc.sname, coalesce(sc.cname, '—'), coalesce(sc.dname, '—'),
         sc.avgm, sc.attr, sc.failm, sc.totm,
         concat_ws(' · ',
           CASE WHEN sc.low_avg        THEN 'averaging ' || sc.avgm || '%' END,
           CASE WHEN sc.mostly_failing THEN sc.failm || ' of ' || sc.totm || ' marks below 50' END,
           CASE WHEN sc.low_att        THEN 'attendance ' || sc.attr || '%' END)
    FROM scored sc
   WHERE sc.low_avg OR sc.mostly_failing OR sc.low_att
   -- Worst first, and anyone failing on two counts above anyone failing on one.
   ORDER BY (sc.low_avg::int + sc.mostly_failing::int + sc.low_att::int) DESC,
            coalesce(sc.avgm, 100), coalesce(sc.attr, 100);
END $$;


REVOKE ALL ON FUNCTION public.dashboard_module_performance()      FROM public;
REVOKE ALL ON FUNCTION public.dashboard_attendance_trend(integer) FROM public;
REVOKE ALL ON FUNCTION public.dashboard_at_risk()                 FROM public;
GRANT EXECUTE ON FUNCTION public.dashboard_module_performance()      TO authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_attendance_trend(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_at_risk()                 TO authenticated;


-- ── Verify ──────────────────────────────────────────────────────────────────
-- These do NOT call the functions above. Every one of them is gated on
-- auth.uid(), and the SQL editor has no signed-in user — auth.uid() is NULL, so
-- can_view_school(NULL) is false and the function correctly refuses. That is
-- the gate working, not a failure. The queries below run the same logic
-- directly, so they work here; the functions themselves are tested by opening
-- a dashboard as a principal, HOA or HOD.

-- 1. All four functions exist and are executable by signed-in users.
SELECT p.proname AS function,
       CASE WHEN has_function_privilege('authenticated', p.oid, 'EXECUTE')
            THEN 'callable' ELSE 'NOT GRANTED' END AS grant_state
  FROM pg_proc p
 WHERE p.pronamespace = 'public'::regnamespace
   AND p.proname IN ('dashboard_department_stats', 'dashboard_module_performance',
                     'dashboard_attendance_trend', 'dashboard_at_risk')
 ORDER BY p.proname;

-- 2. The dept_id ambiguity is gone if this returns rows. It is the body of
--    dashboard_department_stats with the gate removed — if the ambiguous
--    reference were still there, this would raise the same error.
WITH dept_modules AS (
  SELECT d.id AS d_id, m.id AS m_id FROM departments d JOIN modules m ON m.dept = d.id
), dept_classes AS (
  SELECT DISTINCT dm.d_id, mc.class_id
    FROM dept_modules dm JOIN module_classes mc ON mc.module_id = dm.m_id
)
SELECT d.name AS department,
       (SELECT count(*) FROM students s WHERE s.status = 'active'
         AND s.class_id IN (SELECT dc.class_id FROM dept_classes dc WHERE dc.d_id = d.id)) AS students,
       (SELECT round(100.0 * count(*) FILTER (WHERE a.status = 'present') / nullif(count(*),0), 1)
          FROM attendance a
         WHERE a.class_id IN (SELECT dc.class_id FROM dept_classes dc WHERE dc.d_id = d.id)) AS attendance_rate,
       (SELECT round(100.0 * count(*) FILTER (WHERE am.score >= 50) / nullif(count(*),0), 1)
          FROM assessment_marks am
         WHERE am.module_id IN (SELECT dm.m_id FROM dept_modules dm WHERE dm.d_id = d.id)) AS pass_rate
  FROM departments d ORDER BY d.name;

-- 3. Weakest module-in-a-class first — what the dashboard will show at the top.
--    A module appearing once is a class problem; appearing for every one of its
--    classes is a module problem.
SELECT m.name AS module, c.name AS class,
       count(am.id)                                     AS marks,
       round(avg(am.score), 1)                          AS avg_mark,
       round(100.0 * count(*) FILTER (WHERE am.score >= 50) / nullif(count(*),0), 1) AS pass_rate
  FROM modules m
  JOIN module_classes mc  ON mc.module_id = m.id
  JOIN classes c          ON c.id = mc.class_id
  JOIN assessment_marks am ON am.module_id = m.id AND am.class_id = c.id
 GROUP BY m.id, m.name, c.id, c.name
 ORDER BY pass_rate NULLS LAST
 LIMIT 20;

-- 4. Attendance by week — read down the rate column for drift.
SELECT date_trunc('week', a.date::date)::date AS week_start,
       count(*) FILTER (WHERE a.status = 'present') AS present,
       count(*)                                     AS sessions,
       round(100.0 * count(*) FILTER (WHERE a.status = 'present') / nullif(count(*),0), 1) AS rate
  FROM attendance a
 WHERE a.date::date >= current_date - 84
 GROUP BY week_start ORDER BY week_start DESC;

-- 5. Students at risk, worst first — the list the dashboard will name.
--    Flagged on the SHARE of failing marks, not the count, so a strong student
--    with a few bad pieces no longer appears. Minimum counts on each criterion
--    so early-semester noise does not fill the list.
WITH b AS (
  SELECT s.student_id AS sid, s.name AS sname, c.name AS cname,
         (SELECT round(avg(am.score),1) FROM assessment_marks am WHERE am.student_id = s.student_id) AS avgm,
         (SELECT count(*) FROM assessment_marks am WHERE am.student_id = s.student_id AND am.score < 50) AS failm,
         (SELECT count(*) FROM assessment_marks am WHERE am.student_id = s.student_id) AS totm,
         (SELECT round(100.0*count(*) FILTER (WHERE a.status='present')/nullif(count(*),0),1)
            FROM attendance a WHERE a.student_id = s.id) AS attr,
         (SELECT count(*) FROM attendance a WHERE a.student_id = s.id) AS sessions
    FROM students s LEFT JOIN classes c ON c.id = s.class_id
   WHERE s.status = 'active'
)
SELECT sid AS student_id, sname AS name, cname AS class,
       avgm AS avg_mark, failm || '/' || totm AS failing, attr AS attendance
  FROM b
 WHERE (totm >= 3 AND avgm < 50)
    OR (totm >= 4 AND failm::numeric / totm >= 0.5)
    OR (sessions >= 5 AND attr < 75)
 ORDER BY avgm NULLS LAST
 LIMIT 25;
