-- ============================================================================
-- An employee can grant themselves unlimited leave
-- ============================================================================
-- 20260821120000 correctly restored write access to leave_allocations after
-- the RLS audit removed it, and correctly added a floor so no balance can go
-- negative. But the self-service UPDATE policy it created is:
--
--     create policy "la_self_update" on public.leave_allocations for update
--       using (is_own_employee_id(employee_id))
--       with check (is_own_employee_id(employee_id));
--
-- Postgres RLS gates ROWS, not COLUMNS. That policy therefore permits an
-- employee to update EVERY column on their own allocation row — including
-- allocated_days, opening_balance, carried_forward_days and used_days.
--
-- The floor trigger does not catch it, because it only rejects a NEGATIVE
-- projected balance. Setting allocated_days to 1000 projects strongly
-- positive and passes cleanly. Any authenticated employee can therefore
-- award themselves unlimited leave with a single PostgREST call — no UI
-- required, and the request looks entirely legitimate.
--
-- Self-service genuinely needs ONE column: pending_days, so submitting or
-- cancelling a leave request can reserve and release against the balance.
-- Everything else is an HR decision.
--
-- Enforced by trigger rather than by narrowing the policy, because RLS has no
-- column granularity. Column-level GRANTs could express it, but they are
-- invisible to anyone reading pg_policies — the place every audit here has
-- looked — so the guard would be silently unauditable.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.enforce_leave_allocation_columns()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- HR and admins may change anything: corrections, carryover, annual
  -- allocation. This guard exists only to bound the self-service path.
  IF public.is_hr_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;

  IF NEW.allocated_days      IS DISTINCT FROM OLD.allocated_days
     OR NEW.opening_balance     IS DISTINCT FROM OLD.opening_balance
     OR NEW.carried_forward_days IS DISTINCT FROM OLD.carried_forward_days
     OR NEW.used_days          IS DISTINCT FROM OLD.used_days
     OR NEW.leave_type_id      IS DISTINCT FROM OLD.leave_type_id
     OR NEW.employee_id        IS DISTINCT FROM OLD.employee_id
     OR NEW.year               IS DISTINCT FROM OLD.year THEN
    RAISE EXCEPTION
      'Only HR can change a leave entitlement. You may only reserve or release pending days.';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_enforce_leave_allocation_columns ON public.leave_allocations;
-- Ordered before the floor trigger by name (columns < floor), so an attempt to
-- change entitlement is rejected for the right reason rather than incidentally
-- passing the floor check.
CREATE TRIGGER trg_enforce_leave_allocation_columns
  BEFORE UPDATE ON public.leave_allocations
  FOR EACH ROW EXECUTE FUNCTION public.enforce_leave_allocation_columns();


-- ── Verify ──────────────────────────────────────────────────────────────────
-- 1. Both guards present on the table.
SELECT tgname AS trigger_name,
       CASE WHEN tgenabled = 'O' THEN 'enabled' ELSE tgenabled::text END AS state
  FROM pg_trigger
 WHERE tgrelid = 'public.leave_allocations'::regclass
   AND NOT tgisinternal
 ORDER BY tgname;

-- 2. Who may write leave_allocations, and how. Expect la_hr_write (ALL) plus
--    la_self_update (UPDATE) and la_self_select / la_manager_select (SELECT).
SELECT policyname, cmd, qual
  FROM pg_policies
 WHERE schemaname = 'public' AND tablename = 'leave_allocations'
 ORDER BY cmd, policyname;

-- 3. Any table where the 20260820 RLS audit dropped a blanket policy and left
--    no write policy behind. leave_allocations was one; this confirms it is
--    now covered and finds any other that was missed.
SELECT c.relname AS table_name,
       count(*) FILTER (WHERE p.cmd <> 'SELECT') AS write_policies,
       count(*) FILTER (WHERE p.cmd  = 'SELECT') AS read_policies
  FROM pg_class c
  LEFT JOIN pg_policies p ON p.schemaname = 'public' AND p.tablename = c.relname
 WHERE c.relnamespace = 'public'::regnamespace
   AND c.relkind = 'r' AND c.relrowsecurity
   AND c.relname IN ('leave_allocations','leave_requests','attendance_records',
                     'attendance_devices','attendance_settings','employee_groups',
                     'employee_group_members','document_types','public_holidays',
                     'sync_runs','workflows','workflow_stages','company_settings')
 GROUP BY c.relname
HAVING count(*) FILTER (WHERE p.cmd <> 'SELECT') = 0
 ORDER BY c.relname;
