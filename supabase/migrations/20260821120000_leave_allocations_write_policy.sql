-- ============================================================
-- Fix: leave_allocations lost all write access
-- ------------------------------------------------------------
-- 20260820142349 dropped the old blanket "la_all" policy (any
-- authenticated user could read/write ANY employee's leave balance —
-- a real vulnerability) and replaced it with only a manager-scoped
-- SELECT policy. It never added back INSERT/UPDATE for anyone, so
-- every write path in the app has been silently no-oping since:
--   - HR approving/rejecting a request (used_days / pending_days)
--   - HR's manual allocation edits on the Leaves admin page
--   - An employee's own leave submission bumping their pending_days
-- leave_requests itself is unaffected (separate table/policies), so
-- requests still look correct while the balance behind them never
-- actually moves — exactly the "not demonstrated as operational" gap.
--
-- This restores write access, scoped (not the old blanket policy),
-- and adds a hard floor so no write path — buggy, stale, or
-- malicious — can ever push a balance negative for a non-HR actor.
-- ============================================================

-- Self-contained "is this employee row mine" check, following the same
-- proven auth_user_id pattern is_own_attendance_code() already uses in
-- 20260820142349, rather than relying on current_employee_id() /
-- is_managed_by_current_user() — neither of those is defined anywhere in
-- this migration history, so a policy depending on them can't be verified
-- to actually work.
create or replace function public.is_own_employee_id(_employee_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.employees e
    where e.auth_user_id = auth.uid() and e.id = _employee_id
  )
$$;

-- HR/admin: full read-write, matching the is_hr_admin() pattern already
-- used for every other table in 20260820142349.
drop policy if exists "la_hr_write" on public.leave_allocations;
create policy "la_hr_write" on public.leave_allocations for all to authenticated
  using (public.is_hr_admin(auth.uid())) with check (public.is_hr_admin(auth.uid()));

-- Employee: can see and update their own allocation row — needed so their
-- balance cards show live figures and submitting/cancelling a leave request
-- can still reserve/release pending_days against it.
drop policy if exists "la_self_select" on public.leave_allocations;
create policy "la_self_select" on public.leave_allocations for select to authenticated
  using (public.is_own_employee_id(employee_id));

drop policy if exists "la_self_update" on public.leave_allocations;
create policy "la_self_update" on public.leave_allocations for update to authenticated
  using (public.is_own_employee_id(employee_id))
  with check (public.is_own_employee_id(employee_id));

-- Hard floor: block any non-HR write (including the self-service policy
-- above) from ever leaving a balance negative, regardless of what values
-- the client sends. HR keeps the ability to record deliberate corrections
-- (e.g. a legacy negative carryover), matching how is_hr_admin already
-- bypasses every other constraint in this schema.
--
-- remaining_days is a STORED generated column, so inside a BEFORE trigger
-- it still reflects the OLD row — the projected new value has to be
-- computed from NEW's base columns directly.
create or replace function public.enforce_leave_allocation_floor()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  projected numeric;
begin
  projected := NEW.opening_balance + NEW.allocated_days - NEW.used_days - NEW.pending_days;
  if projected < 0 and not public.is_hr_admin(auth.uid()) then
    raise exception 'This would exceed the available leave balance (only % day(s) remaining).',
      GREATEST(0, OLD.opening_balance + OLD.allocated_days - OLD.used_days - OLD.pending_days);
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_enforce_leave_allocation_floor on public.leave_allocations;
create trigger trg_enforce_leave_allocation_floor
  before update on public.leave_allocations
  for each row execute function public.enforce_leave_allocation_floor();
