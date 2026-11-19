-- Keep a class in step with its students' semester (UAT retest 18 Nov,
-- correction 13: "A student is in Year 1 Semester 2 while the class remains
-- Year 1 Semester 1 ... Lecturer has to move the class manually").
--
-- After progression is approved, the app calls sync_class_period(class_id).
-- It moves the class to the year/semester that MOST of its active students
-- are now in — only ever forward, never back — so a few students repeating a
-- semester do not hold the whole cohort back, and the class follows the cohort.
--
-- SECURITY DEFINER because only admins may update classes directly, while HOD,
-- HOA, principal and deputy principal also approve progression. The function
-- itself checks the caller holds one of those roles.
--
-- RUN ON boswa-live. Creates one function; changes no data until called.
-- Idempotent. The app falls back to a direct update (admins only) if this
-- function has not been created yet.

CREATE OR REPLACE FUNCTION public.sync_class_period(_class_id text)
RETURNS TABLE (year integer, semester integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year integer;
  v_sem  integer;
  c_year integer;
  c_sem  integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.role::text IN ('admin', 'super_admin', 'hod', 'hoa', 'principal', 'deputy_principal')
  ) THEN
    RAISE EXCEPTION 'Not allowed to move classes';
  END IF;

  SELECT c.year, c.semester INTO c_year, c_sem FROM public.classes c WHERE c.id = _class_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Class % not found', _class_id;
  END IF;

  -- The period held by the most active students (ties → the later period).
  SELECT s.year, s.semester INTO v_year, v_sem
  FROM public.students s
  WHERE s.class_id = _class_id
    AND coalesce(s.status, 'active') = 'active'
  GROUP BY s.year, s.semester
  ORDER BY count(*) DESC, s.year DESC, s.semester DESC
  LIMIT 1;

  IF v_year IS NOT NULL AND (v_year > c_year OR (v_year = c_year AND v_sem > c_sem)) THEN
    UPDATE public.classes SET year = v_year, semester = v_sem WHERE id = _class_id;
    c_year := v_year; c_sem := v_sem;
  END IF;

  RETURN QUERY SELECT c_year, c_sem;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_class_period(text) FROM public;
GRANT EXECUTE ON FUNCTION public.sync_class_period(text) TO authenticated;

-- Verify:
--   select proname from pg_proc where proname = 'sync_class_period';
