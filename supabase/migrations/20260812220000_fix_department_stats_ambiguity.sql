-- ============================================================================
-- dashboard_department_stats: "column reference dept_id is ambiguous"
-- ============================================================================
-- The HOD and Principal dashboards fail with:
--
--   Could not load: column reference "dept_id" is ambiguous
--
-- RETURNS TABLE (dept_id text, ...) declares dept_id as an OUT variable. Inside
-- the body, the CTE `dept_classes` also has a column called dept_id — so this:
--
--   ... WHERE s.class_id IN (SELECT class_id FROM dept_classes WHERE dept_id = d.id)
--
-- cannot tell whether `dept_id` means the CTE's column or the function's own
-- output variable, and PL/pgSQL refuses rather than guessing.
--
-- Fixed by aliasing the CTE and qualifying every reference (dc.dept_id). The
-- results are unchanged — this was a name collision, not a logic error.
--
-- Idempotent: CREATE OR REPLACE. No data is touched.
-- ============================================================================

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
    SELECT d.id AS d_id, m.id AS m_id
      FROM public.departments d
      LEFT JOIN public.modules m ON m.dept = d.id
  ),
  dept_classes AS (
    SELECT DISTINCT dm.d_id, mc.class_id
      FROM dept_modules dm
      JOIN public.module_classes mc ON mc.module_id = dm.m_id
  )
  SELECT d.id, d.name,
         (SELECT count(*) FROM public.students s
           WHERE s.status = 'active'
             AND s.class_id IN (SELECT dc.class_id FROM dept_classes dc WHERE dc.d_id = d.id)),
         (SELECT count(*) FROM public.modules m WHERE m.dept = d.id),
         (SELECT count(DISTINCT lm.lecturer_id) FROM public.lecturer_modules lm
           WHERE lm.module_id IN (SELECT m.id FROM public.modules m WHERE m.dept = d.id)),
         (SELECT CASE WHEN count(*) = 0 THEN NULL
                 ELSE round(100.0 * count(*) FILTER (WHERE a.status = 'present') / count(*)) END
            FROM public.attendance a
           WHERE a.class_id IN (SELECT dc.class_id FROM dept_classes dc WHERE dc.d_id = d.id)),
         (SELECT CASE WHEN count(*) = 0 THEN NULL
                 ELSE round(100.0 * count(*) FILTER (WHERE am.score >= 50) / count(*)) END
            FROM public.assessment_marks am
           WHERE am.module_id IN (SELECT m.id FROM public.modules m WHERE m.dept = d.id)),
         (SELECT count(*) FROM public.assessment_marks am
           WHERE am.module_id IN (SELECT m.id FROM public.modules m WHERE m.dept = d.id))
    FROM public.departments d
   ORDER BY d.name;
END $$;


-- ── Verify ──────────────────────────────────────────────────────────────────
-- Should return one row per department, no error.
SELECT dept_name, students, modules, lecturers, attendance_rate, pass_rate
  FROM public.dashboard_department_stats();
