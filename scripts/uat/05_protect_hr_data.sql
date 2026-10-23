-- ════════════════════════════════════════════════════════════════════════════
-- Boswa LMS — UAT step 1b: protect HR and payroll during the wipe
--   (run ONCE on boswa-live, any time before 03_wipe_uat_data.sql)
-- ════════════════════════════════════════════════════════════════════════════
--
-- Paste the whole file into the Supabase SQL editor for boswa-live and run it.
-- It changes no data: it only replaces two functions in uat_snapshot.
--
-- Why: the wipe deletes login accounts created during UAT. Postgres then
-- deletes or blanks any row that points at a deleted account. If a UAT
-- tester approved a leave, or touched payroll, HR rows pointing at that
-- account would be changed, and the old final check only looked at LMS
-- tables, so it would not have noticed.
--
-- After this runs:
--   1. A UAT account that any HR or payroll row points at is NOT deleted.
--      It is kept with sign-in blocked, so the HR row stays as it is.
--      02 shows these as "keep" with the reason "referenced by HR data".
--   2. The wipe locks every HR and payroll table, fingerprints each one,
--      does its work, and fingerprints them again. If a single HR or payroll
--      row differs, it raises an error and NOTHING is changed.
--      Staff attendance punches that arrive meanwhile wait a few seconds.
--
-- profiles and user_roles are left out of the fingerprint: the UAT accounts'
-- own rows there go with the accounts. audit_logs is left out because the
-- wipe's own LMS changes are logged there.
-- ════════════════════════════════════════════════════════════════════════════

-- Tables the HR guard skips (see above). Everything else in public that is
-- not an LMS table is HR, payroll or settings, and must not change.
create or replace function uat_snapshot._guard_skips()
returns text[] language sql immutable as $$
  select array['profiles', 'user_roles', 'audit_logs']
$$;

-- The first HR or payroll column that points at this account, directly or
-- through its profiles row, or null. Found from the foreign keys, so tables
-- and columns added during UAT are covered too.
create or replace function uat_snapshot._hr_reference(uid uuid)
returns text
language plpgsql stable set search_path = '' as $$
declare
  r record;
  hit boolean;
begin
  for r in
    select c.conrelid::regclass::text as tbl, a.attname as col,
           pa.attname as ref_col, c.confrelid::regclass::text as target
    from pg_constraint c
    join pg_class k     on k.oid = c.conrelid
    join pg_namespace n on n.oid = k.relnamespace
    join pg_attribute a  on a.attrelid = c.conrelid  and a.attnum = c.conkey[1]
    join pg_attribute pa on pa.attrelid = c.confrelid and pa.attnum = c.confkey[1]
    where c.contype = 'f'
      and array_length(c.conkey, 1) = 1
      and n.nspname = 'public'
      and k.relname <> all (uat_snapshot._guard_skips())
      and k.relname not in (select l.tbl from uat_snapshot._lms_tables l)
      and (c.confrelid = 'auth.users'::regclass
           or c.confrelid = to_regclass('public.profiles'))
  loop
    if r.target = 'auth.users' then
      execute format('select exists (select 1 from %s t where t.%I = $1)', r.tbl, r.col)
        into hit using uid;
    else
      -- Points at profiles: match through every profiles column that is the
      -- account id (the one with a foreign key to auth.users).
      execute (
        select format('select exists (select 1 from %s t join public.profiles p on t.%I = p.%I where %s)',
                      r.tbl, r.col, r.ref_col,
                      coalesce(string_agg(format('p.%I = $1', a2.attname), ' or '), 'false'))
        from pg_constraint c2
        join pg_attribute a2 on a2.attrelid = c2.conrelid and a2.attnum = c2.conkey[1]
        where c2.conrelid = 'public.profiles'::regclass and c2.contype = 'f'
          and c2.confrelid = 'auth.users'::regclass
      ) into hit using uid;
    end if;
    if hit then
      return r.tbl || '.' || r.col;
    end if;
  end loop;
  return null;
end $$;

-- Same columns as before; adds the "referenced by HR data" keep reason.
create or replace function uat_snapshot.new_accounts()
returns table (user_id uuid, email text, role text, created_at timestamptz, action text, reason text)
language sql stable set search_path = '' as $$
  select u.id, u.email::text, r.role::text, u.created_at,
         case when k.reason is null then 'delete' else 'keep' end,
         coalesce(k.reason, 'created during UAT, not linked to HR')
  from auth.users u
  left join public.user_roles r on r.user_id = u.id
  cross join lateral (
    select case
      when exists (select 1 from public.employees e where e.auth_user_id = u.id)
        then 'linked to an employee record'
      when r.role::text in ('employee', 'hr', 'accountant')
        then 'HR or payroll role'
      when exists (select 1 from public.employee_documents d where d.uploaded_by = u.id)
        then 'uploaded HR documents'
      when exists (select 1 from public.workflow_stage_approvals w where w.approver_id = u.id)
        then 'approved HR requests'
      else (select 'referenced by HR data (' || h || ') — sign-in will be blocked'
            from uat_snapshot._hr_reference(u.id) h where h is not null)
    end as reason
  ) k
  where not exists (select 1 from uat_snapshot._auth_users s where s.id = u.id)
  order by u.created_at
$$;

-- Fingerprint of every HR/payroll table: row count plus a hash of all rows.
create or replace function uat_snapshot._hr_fingerprint()
returns table (tbl text, fp text)
language plpgsql stable set search_path = '' as $$
declare r record;
begin
  for r in
    select k.relname as t
    from pg_class k join pg_namespace n on n.oid = k.relnamespace
    where n.nspname = 'public' and k.relkind in ('r', 'p')
      and k.relname <> all (uat_snapshot._guard_skips())
      and k.relname not in (select l.tbl from uat_snapshot._lms_tables l)
    order by k.relname
  loop
    tbl := r.t;
    execute format('select count(*)::text || '':'' || coalesce(md5(string_agg(md5(t::text), '''' order by md5(t::text))), '''') from public.%I t', r.t)
      into fp;
    return next;
  end loop;
end $$;

-- The cleanup, as before, wrapped in the HR guard.
create or replace function uat_snapshot.restore(confirm text, keep_emails text[] default '{}')
returns table (step text, tbl text, n_rows bigint)
language plpgsql set search_path = '' as $$
declare
  r record;
  x record;
  n bigint;
  bad text;
begin
  if confirm is distinct from 'WIPE UAT DATA' then
    raise exception 'Nothing done. To run the cleanup call: select * from uat_snapshot.restore(''WIPE UAT DATA'');';
  end if;

  for r in select l.tbl as t from uat_snapshot._lms_tables l loop
    if to_regclass(format('public.%I', r.t)) is null
       or to_regclass(format('uat_snapshot.%I', r.t)) is null then
      raise exception 'Table % is missing from public or from the snapshot. Nothing was changed.', r.t;
    end if;
  end loop;

  -- 0) Freeze HR and payroll: no one else can write to them until this
  --    finishes, so the before/after fingerprints compare like with like.
  for r in select f.tbl as t from uat_snapshot._hr_fingerprint() f loop
    execute format('lock table public.%I in share mode', r.t);
  end loop;
  create temp table _hr_before on commit drop as
    select * from uat_snapshot._hr_fingerprint();
  step := '0. HR and payroll tables locked and fingerprinted'; tbl := null;
  select count(*) into n_rows from _hr_before; return next;

  -- a) Put back live rows that UAT edited or deleted. Parents first, so every
  --    reference points at a row that already exists again.
  for r in select l.tbl as t from uat_snapshot._lms_tables l order by l.ord loop
    select * into x from uat_snapshot._parts(r.t);
    if x.upd_cols is not null then
      execute format('update public.%1$I p set (%2$s) = row(%3$s) from uat_snapshot.%1$I s where %4$s and (%5$s) is distinct from (%6$s)',
                     r.t, x.upd_cols, x.upd_vals, x.join_cond, x.p_txt, x.s_txt);
      get diagnostics n = row_count;
      step := 'a. live rows un-edited'; tbl := r.t; n_rows := n; return next;
    end if;
    execute format('insert into public.%1$I (%2$s) select %3$s from uat_snapshot.%1$I s where not exists (select 1 from public.%1$I p where %4$s)',
                   r.t, x.cols, x.s_cols, x.join_cond);
    get diagnostics n = row_count;
    step := 'a. live rows re-inserted'; tbl := r.t; n_rows := n; return next;
  end loop;

  -- b) Delete the rows UAT created. Children first.
  for r in select l.tbl as t from uat_snapshot._lms_tables l order by l.ord desc loop
    select * into x from uat_snapshot._parts(r.t);
    execute format('delete from public.%1$I p where not exists (select 1 from uat_snapshot.%1$I s where %2$s)',
                   r.t, x.join_cond);
    get diagnostics n = row_count;
    step := 'b. UAT rows deleted'; tbl := r.t; n_rows := n; return next;
  end loop;

  -- c) Delete UAT login accounts that nothing in HR points at. Their
  --    profiles, roles and notifications go with them (ON DELETE CASCADE).
  create temp table _acct on commit drop as
    select a.user_id, a.action, a.reason from uat_snapshot.new_accounts() a
    join auth.users u on u.id = a.user_id
    where not (lower(u.email) = any (select lower(e) from unnest(keep_emails) e));

  delete from auth.users u using _acct a
  where a.user_id = u.id and a.action = 'delete';
  get diagnostics n = row_count;
  step := 'c. UAT accounts deleted'; tbl := 'auth.users'; n_rows := n; return next;

  -- c2) UAT accounts that HR rows point at stay, so those rows stay intact,
  --     but nobody can sign in with them any more.
  update auth.users u set banned_until = 'infinity'
  from _acct a
  where a.user_id = u.id and a.reason like 'referenced by HR data%';
  get diagnostics n = row_count;
  step := 'c. UAT accounts kept for HR rows, sign-in blocked'; tbl := 'auth.users'; n_rows := n; return next;

  -- d) Prove it. Any difference left undoes everything above.
  for r in
    select d.tbl as t, d.added, d.changed, d.removed
    from uat_snapshot.diff() d
    join uat_snapshot._lms_tables l on l.tbl = d.tbl
  loop
    if r.added <> 0 or r.changed <> 0 or r.removed <> 0 then
      raise exception 'Check failed on %: % added, % changed, % removed. Nothing was changed.',
                      r.t, r.added, r.changed, r.removed;
    end if;
  end loop;
  step := 'd. check passed'; tbl := 'all LMS tables match the snapshot'; n_rows := 0; return next;

  -- e) HR and payroll must be exactly as they were before step a.
  select string_agg(coalesce(b.tbl, a.tbl), ', ') into bad
  from _hr_before b
  full join uat_snapshot._hr_fingerprint() a on a.tbl = b.tbl
  where a.fp is distinct from b.fp;
  if bad is not null then
    raise exception 'HR/payroll data would have changed (%). Nothing was changed.', bad;
  end if;
  step := 'e. HR check passed'; tbl := 'no HR or payroll row changed'; n_rows := 0; return next;
end $$;

revoke all on all functions in schema uat_snapshot from public, anon, authenticated;

-- Shows what the wipe would now do with each account created during UAT.
select * from uat_snapshot.new_accounts();
