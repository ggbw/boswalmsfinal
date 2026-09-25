-- Repair the two cross-role reads that 20260821160000 (payroll and contracts
-- to the Accountant) broke without anyone noticing.
--
-- 1. HR lost SELECT on contracts, but the Leave page decides who can be picked
--    for "apply on behalf" from contracts.status = 'active'. HR's query came
--    back empty, so the employee dropdown was empty for every employee.
--    HR still must not read wages, so rather than reopen contracts this exposes
--    only the one fact the Leave page needs: which employees are on an active
--    contract.
--
-- 2. The Accountant builds payslips, and a payslip prints leave balances and
--    salary-advance balances. The Accountant had no SELECT on leave_allocations,
--    leave_requests or advance_salaries, so those figures silently fell back to
--    "full entitlement, nothing taken" and "no advances". Read-only access is
--    added; HR keeps sole write access.

CREATE OR REPLACE FUNCTION public.active_contract_employee_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT c.employee_id
    FROM public.contracts c
   WHERE c.status = 'active'
     AND c.employee_id IS NOT NULL
     AND (
       public.is_payroll_admin(auth.uid())
       OR public.has_role(auth.uid(), 'hr'::app_role)
     );
$$;

REVOKE ALL ON FUNCTION public.active_contract_employee_ids() FROM public;
GRANT EXECUTE ON FUNCTION public.active_contract_employee_ids() TO authenticated;

DROP POLICY IF EXISTS la_accountant_select ON public.leave_allocations;
CREATE POLICY la_accountant_select ON public.leave_allocations
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'accountant'::app_role));

DROP POLICY IF EXISTS lr_accountant_select ON public.leave_requests;
CREATE POLICY lr_accountant_select ON public.leave_requests
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'accountant'::app_role));

DROP POLICY IF EXISTS as_accountant_select ON public.advance_salaries;
CREATE POLICY as_accountant_select ON public.advance_salaries
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'accountant'::app_role));
