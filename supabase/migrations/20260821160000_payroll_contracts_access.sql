-- ============================================================================
-- Payroll and contracts: HR out, Accountant in
-- ============================================================================
-- RUN 20260821150000 FIRST, as a separate statement. This file uses the
-- 'accountant' enum value, and Postgres refuses to use a new enum value in the
-- same transaction that created it.
--
-- Removing payroll from the HR menu is not enough on its own. The pages are
-- reachable by URL, and PostgREST is reachable without the app at all — anyone
-- with a login and the anon key can query a table directly. So the rule has to
-- be enforced here, in the database, or it is not enforced.
--
-- The existing policies on these tables were never written into a migration
-- file; they exist only in the live database. They are therefore discovered
-- and dropped by name rather than edited, and replaced with one explicit
-- policy per table. After this runs, pg_policies is the whole truth for who
-- may touch payroll.
--
-- Idempotent: the drop is driven by a catalogue query, so re-running simply
-- rebuilds the same policies.
-- ============================================================================

-- Who may see salary figures and employment terms.
-- Note this is the one place the plain LMS 'admin' role carries an HR
-- permission — elsewhere in the HR module admin is deliberately LMS-only.
CREATE OR REPLACE FUNCTION public.is_payroll_admin(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
     WHERE user_id = _uid
       AND role IN ('admin', 'super_admin', 'accountant')
  );
$$;

REVOKE ALL ON FUNCTION public.is_payroll_admin(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.is_payroll_admin(uuid) TO authenticated;


DO $$
DECLARE
  t   text;
  pol record;
  tables text[] := ARRAY[
    'payslips', 'pay_component_defs', 'employee_pay_components',
    'contracts', 'contract_lines', 'contract_templates', 'contract_template_lines'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_class c
                    WHERE c.relname = t AND c.relnamespace = 'public'::regnamespace) THEN
      RAISE NOTICE 'skipped % - not present', t;
      CONTINUE;
    END IF;

    -- Clear every existing policy. Leaving one behind would defeat the point:
    -- permissive policies are OR'd, so a surviving HR policy would keep HR's
    -- access no matter what is added alongside it.
    FOR pol IN SELECT policyname FROM pg_policies
                WHERE schemaname = 'public' AND tablename = t LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', pol.policyname, t);
    END LOOP;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated '
      'USING (public.is_payroll_admin(auth.uid())) '
      'WITH CHECK (public.is_payroll_admin(auth.uid()))',
      'payroll_admin_all_' || t, t);

    EXECUTE format('REVOKE SELECT, INSERT, UPDATE, DELETE ON public.%I FROM anon', t);
    RAISE NOTICE 'payroll access rebuilt on %', t;
  END LOOP;
END $$;


-- is_own_employee_id is defined in 20260821120000. Repeated here with the same
-- body so this file does not silently depend on that one having been run — the
-- migrations in this project are pasted in by hand, and one being skipped has
-- already cost two days once this month.
CREATE OR REPLACE FUNCTION public.is_own_employee_id(_employee_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.employees e
     WHERE e.auth_user_id = auth.uid() AND e.id = _employee_id
  );
$$;

-- Staff must still see their OWN payslip. Self-service reads it by employee,
-- and that has nothing to do with running payroll.
DROP POLICY IF EXISTS "payslips_self_select" ON public.payslips;
CREATE POLICY "payslips_self_select" ON public.payslips FOR SELECT TO authenticated
  USING (public.is_own_employee_id(employee_id));

-- An accountant needs to read the employee list to run payroll against it,
-- but nothing more: no writes, and no other HR table.
DROP POLICY IF EXISTS "employees_accountant_select" ON public.employees;
CREATE POLICY "employees_accountant_select" ON public.employees FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'accountant'::app_role));


-- ── Verify ──────────────────────────────────────────────────────────────────
-- 1. Who may write payroll and contracts. Every row should name
--    is_payroll_admin, and NONE should mention 'hr'.
SELECT tablename, policyname, cmd,
       CASE WHEN qual LIKE '%is_payroll_admin%' THEN 'payroll admins only'
            WHEN qual LIKE '%is_own_employee_id%' THEN 'own record only'
            ELSE 'CHECK THIS: ' || coalesce(qual, '(none)') END AS who
  FROM pg_policies
 WHERE schemaname = 'public'
   AND tablename IN ('payslips','pay_component_defs','employee_pay_components',
                     'contracts','contract_lines','contract_templates','contract_template_lines')
 ORDER BY tablename, policyname;

-- 2. Anything still granting the HR role access to payroll or contracts.
--    MUST return no rows.
SELECT tablename, policyname, 'HR CAN STILL REACH PAYROLL' AS problem
  FROM pg_policies
 WHERE schemaname = 'public'
   AND tablename IN ('payslips','pay_component_defs','employee_pay_components',
                     'contracts','contract_lines','contract_templates','contract_template_lines')
   AND coalesce(qual,'') || coalesce(with_check,'') LIKE '%''hr''%';

-- 3. The role exists and can be assigned.
SELECT string_agg(e.enumlabel, ', ' ORDER BY e.enumsortorder) AS app_role_values
  FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
 WHERE t.typname = 'app_role';
