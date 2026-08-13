-- ============================================================================
-- URGENT: is_school_staff() still says 'hoy' and now throws
-- ============================================================================
--   marks: invalid input value for enum app_role: "hoy"
--   admission_enquiries: invalid input value for enum app_role: "hoy"
--
-- 20260812120000 renamed the enum value 'hoy' to 'hoa'. That IS transparent to
-- RLS policies, which store the parsed enum value and follow a rename. It is NOT
-- transparent to FUNCTION BODIES: a SQL function's source is stored as text and
-- re-parsed on execution, so a literal 'hoy' inside one keeps referring to a
-- label that no longer exists, and every call raises.
--
-- is_school_staff() — created in 20260812070000 with 'hoy' spelled out — guards
-- SELECT on marks, assessment_marks, attendance, submissions, student_modules,
-- applicants, applications and admission_enquiries. So those queries all fail,
-- and the load-failure banner reports them.
--
-- (has_role() is unaffected: it takes the role as a parameter rather than
-- naming one, so there is no literal in its body.)
--
-- Fix: recreate the function with 'hoa'. Nothing else changes — same name, same
-- signature, same semantics — so every policy calling it picks this up with no
-- policy rewrite.
--
-- No data is touched.
-- Idempotent: safe to run more than once.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.is_school_staff(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
     WHERE user_id = _uid
       AND role IN ('admin','super_admin','hod','hoa','lecturer')
  );
$$;


-- ── Sweep for the same problem elsewhere ────────────────────────────────────
-- Any other function whose stored source still contains the old label, and any
-- policy whose expression does. Both must come back empty.
SELECT 'function' AS kind, p.proname AS name,
       'still contains the literal hoy' AS problem
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.prosrc ~ '\mhoy\M'
UNION ALL
SELECT 'policy', tablename || ' · ' || policyname,
       'still contains the literal hoy'
  FROM pg_policies
 WHERE schemaname = 'public'
   AND (coalesce(qual, '') ~ '\mhoy\M' OR coalesce(with_check, '') ~ '\mhoy\M')
UNION ALL
-- Confirms the fix actually works, rather than merely being installed.
SELECT 'check', 'is_school_staff() evaluates',
       CASE WHEN public.is_school_staff('00000000-0000-0000-0000-000000000000'::uuid) IS NOT NULL
            THEN 'OK — no error' ELSE 'unexpected' END;
