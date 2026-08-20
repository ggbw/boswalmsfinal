create or replace function public.is_hr_admin(_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _uid and role in ('admin','super_admin','hr')
  )
$$;

create or replace function public.is_own_attendance_code(_code text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.employees e
    where e.auth_user_id = auth.uid()
      and (upper(e.employee_code) = upper(_code) or e.biometric_id = _code)
  )
$$;

-- 1. attendance_devices (stores api_key / device_password)
drop policy if exists "Authenticated write attendance_devices" on public.attendance_devices;
drop policy if exists "Authenticated read attendance_devices" on public.attendance_devices;
drop policy if exists "attendance_devices_select_auth" on public.attendance_devices;
drop policy if exists "att_devices_admin_all" on public.attendance_devices;
create policy "att_devices_admin_all" on public.attendance_devices for all to authenticated
  using (public.is_hr_admin(auth.uid())) with check (public.is_hr_admin(auth.uid()));
revoke select, insert, update, delete on public.attendance_devices from anon;

-- 2. attendance_records (biometric punches)
drop policy if exists "Authenticated write attendance_records" on public.attendance_records;
drop policy if exists "Authenticated read attendance_records" on public.attendance_records;
drop policy if exists "att_records_admin_all" on public.attendance_records;
drop policy if exists "att_records_self_select" on public.attendance_records;
create policy "att_records_admin_all" on public.attendance_records for all to authenticated
  using (public.is_hr_admin(auth.uid())) with check (public.is_hr_admin(auth.uid()));
create policy "att_records_self_select" on public.attendance_records for select to authenticated
  using (public.is_own_attendance_code(employee_id));
revoke select, insert, update, delete on public.attendance_records from anon;

-- 3. attendance_settings
drop policy if exists "Authenticated write attendance_settings" on public.attendance_settings;
drop policy if exists "attendance_settings_update_auth" on public.attendance_settings;
drop policy if exists "attendance_settings_select_auth" on public.attendance_settings;
drop policy if exists "Authenticated read attendance_settings" on public.attendance_settings;
drop policy if exists "att_settings_read" on public.attendance_settings;
drop policy if exists "att_settings_admin_write" on public.attendance_settings;
create policy "att_settings_read" on public.attendance_settings for select to authenticated using (true);
create policy "att_settings_admin_write" on public.attendance_settings for all to authenticated
  using (public.is_hr_admin(auth.uid())) with check (public.is_hr_admin(auth.uid()));
revoke select, insert, update, delete on public.attendance_settings from anon;

-- 4. company_settings
drop policy if exists "company_settings_insert_auth" on public.company_settings;
drop policy if exists "company_settings_update_auth" on public.company_settings;
drop policy if exists "company_settings_select_auth" on public.company_settings;
drop policy if exists "company_settings_read" on public.company_settings;
drop policy if exists "company_settings_admin_write" on public.company_settings;
create policy "company_settings_read" on public.company_settings for select to authenticated using (true);
create policy "company_settings_admin_write" on public.company_settings for all to authenticated
  using (public.is_hr_admin(auth.uid())) with check (public.is_hr_admin(auth.uid()));
revoke select, insert, update, delete on public.company_settings from anon;

-- 5. leave_allocations: drop the blanket policy, add manager visibility
drop policy if exists "la_all" on public.leave_allocations;
drop policy if exists "la_manager_select" on public.leave_allocations;
create policy "la_manager_select" on public.leave_allocations for select to authenticated
  using (public.is_managed_by_current_user(employee_id));
revoke select, insert, update, delete on public.leave_allocations from anon;

-- 6. employee groups / document types
drop policy if exists "employee_groups_authenticated" on public.employee_groups;
drop policy if exists "employee_groups_read" on public.employee_groups;
drop policy if exists "employee_groups_admin_write" on public.employee_groups;
create policy "employee_groups_read" on public.employee_groups for select to authenticated using (true);
create policy "employee_groups_admin_write" on public.employee_groups for all to authenticated
  using (public.is_hr_admin(auth.uid())) with check (public.is_hr_admin(auth.uid()));

drop policy if exists "employee_group_members_authenticated" on public.employee_group_members;
drop policy if exists "egm_admin_all" on public.employee_group_members;
drop policy if exists "egm_self_select" on public.employee_group_members;
create policy "egm_admin_all" on public.employee_group_members for all to authenticated
  using (public.is_hr_admin(auth.uid())) with check (public.is_hr_admin(auth.uid()));
create policy "egm_self_select" on public.employee_group_members for select to authenticated
  using (employee_id = public.current_employee_id());

drop policy if exists "dt_all" on public.document_types;
drop policy if exists "dt_read" on public.document_types;
drop policy if exists "dt_admin_write" on public.document_types;
create policy "dt_read" on public.document_types for select to authenticated using (true);
create policy "dt_admin_write" on public.document_types for all to authenticated
  using (public.is_hr_admin(auth.uid())) with check (public.is_hr_admin(auth.uid()));

revoke select, insert, update, delete on public.employee_groups, public.employee_group_members, public.document_types from anon;

-- 7. public_holidays / sync_runs
drop policy if exists "ph_all" on public.public_holidays;
drop policy if exists "ph_admin_write" on public.public_holidays;
create policy "ph_admin_write" on public.public_holidays for all to authenticated
  using (public.is_hr_admin(auth.uid())) with check (public.is_hr_admin(auth.uid()));

drop policy if exists "sr_all" on public.sync_runs;
drop policy if exists "sr_read" on public.sync_runs;
drop policy if exists "sr_admin_write" on public.sync_runs;
create policy "sr_read" on public.sync_runs for select to authenticated using (true);
create policy "sr_admin_write" on public.sync_runs for all to authenticated
  using (public.is_hr_admin(auth.uid())) with check (public.is_hr_admin(auth.uid()));

revoke select, insert, update, delete on public.public_holidays, public.sync_runs from anon;

-- 8. workflow tables
drop policy if exists "workflows_authenticated" on public.workflows;
create policy "workflows_read" on public.workflows for select to authenticated using (true);
create policy "workflows_admin_write" on public.workflows for all to authenticated
  using (public.is_hr_admin(auth.uid())) with check (public.is_hr_admin(auth.uid()));

drop policy if exists "workflow_stages_authenticated" on public.workflow_stages;
create policy "workflow_stages_read" on public.workflow_stages for select to authenticated using (true);
create policy "workflow_stages_admin_write" on public.workflow_stages for all to authenticated
  using (public.is_hr_admin(auth.uid())) with check (public.is_hr_admin(auth.uid()));

drop policy if exists "workflow_assignments_authenticated" on public.workflow_assignments;
create policy "workflow_assignments_read" on public.workflow_assignments for select to authenticated using (true);
create policy "workflow_assignments_admin_write" on public.workflow_assignments for all to authenticated
  using (public.is_hr_admin(auth.uid())) with check (public.is_hr_admin(auth.uid()));

drop policy if exists "workflow_stage_owners_authenticated" on public.workflow_stage_owners;
create policy "workflow_stage_owners_read" on public.workflow_stage_owners for select to authenticated using (true);
create policy "workflow_stage_owners_admin_write" on public.workflow_stage_owners for all to authenticated
  using (public.is_hr_admin(auth.uid())) with check (public.is_hr_admin(auth.uid()));

drop policy if exists "workflow_instances_authenticated" on public.workflow_instances;
create policy "workflow_instances_read" on public.workflow_instances for select to authenticated using (true);
create policy "workflow_instances_write" on public.workflow_instances for all to authenticated
  using (public.is_hr_admin(auth.uid()) or public.current_employee_id() is not null)
  with check (public.is_hr_admin(auth.uid()) or public.current_employee_id() is not null);

drop policy if exists "workflow_stage_approvals_authenticated" on public.workflow_stage_approvals;
create policy "wsa_read" on public.workflow_stage_approvals for select to authenticated using (true);
create policy "wsa_insert_self" on public.workflow_stage_approvals for insert to authenticated
  with check (approver_id = auth.uid());
create policy "wsa_admin_all" on public.workflow_stage_approvals for all to authenticated
  using (public.is_hr_admin(auth.uid())) with check (public.is_hr_admin(auth.uid()));

revoke select, insert, update, delete on public.workflows, public.workflow_stages, public.workflow_assignments,
  public.workflow_stage_owners, public.workflow_instances, public.workflow_stage_approvals from anon;

-- 9. rooms
drop policy if exists "Authenticated insert rooms" on public.rooms;
drop policy if exists "Authenticated update rooms" on public.rooms;
drop policy if exists "Authenticated delete rooms" on public.rooms;
drop policy if exists "rooms_admin_write" on public.rooms;
create policy "rooms_admin_write" on public.rooms for all to authenticated
  using (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'super_admin'))
  with check (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'super_admin'));
revoke select, insert, update, delete on public.rooms from anon;

-- 10. drop anon write grants on academic reference tables (public read stays)
revoke insert, update, delete on public.classes, public.modules, public.module_classes,
  public.programmes, public.programme_modules from anon;
