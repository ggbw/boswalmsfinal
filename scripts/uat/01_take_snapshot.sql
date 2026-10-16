-- ════════════════════════════════════════════════════════════════════════════
-- Boswa LMS — UAT step 1: snapshot the live data   (run ONCE, before UAT)
-- ════════════════════════════════════════════════════════════════════════════
--
-- Paste the whole file into the Lovable Cloud SQL editor and run it.
-- It only READS live data. It writes nothing into public, auth or storage.
--
-- What it creates, all inside a new private schema `uat_snapshot`:
--   • a copy of every public table as it is right now (HR and payroll
--     included, purely as a backup — the cleanup never restores them)
--   • the list of login accounts and storage files that exist right now
--   • the functions that report and later remove UAT data
--
-- From the moment this runs, anything entered in the LMS academic tables
-- is treated as UAT data and will be wiped. HR and payroll are not touched.
-- Code changes made because of UAT are live and are never rolled back; see
-- section 5 for what to run after a migration so its data is kept too.
-- ════════════════════════════════════════════════════════════════════════════

-- One transaction, one consistent moment: every table is copied as it stood
-- at the same instant, even while staff attendance punches keep arriving.
begin isolation level repeatable read;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'uat_snapshot') then
    raise exception 'uat_snapshot already exists: the snapshot was taken already. Running this again would overwrite it with UAT data, so nothing was done.';
  end if;
end $$;

create schema uat_snapshot;
revoke all on schema uat_snapshot from public, anon, authenticated;

create table uat_snapshot._meta (
  taken_at timestamptz not null default now(),
  note     text
);
insert into uat_snapshot._meta (note) values ('Live data before UAT, October 2026');

-- ── 1. Copy every public table ──────────────────────────────────────────────
do $$
declare r record;
begin
  for r in select tablename from pg_tables where schemaname = 'public' order by tablename loop
    execute format('create table uat_snapshot.%1$I as table public.%1$I', r.tablename);
  end loop;
end $$;

-- Who could log in, and which files existed, before UAT.
create table uat_snapshot._auth_users as
  select id, email, created_at from auth.users;
create table uat_snapshot._storage_objects as
  select id, bucket_id, name, created_at from storage.objects;

-- ── 2. The tables UAT is allowed to change ──────────────────────────────────
-- Only these are put back at the end. Ordered parents first; the cleanup
-- deletes in the reverse order. HR, payroll, leave, staff attendance,
-- workflows and settings are deliberately absent.
create table uat_snapshot._lms_tables (
  tbl text primary key,
  ord int  not null
);
insert into uat_snapshot._lms_tables (tbl, ord) values
  ('departments',                   10),
  ('programmes',                    20),
  ('terms',                         30),
  ('rooms',                         40),
  ('school_config',                 50),
  ('classes',                       60),
  ('modules',                       70),
  ('module_classes',                80),
  ('programme_modules',             90),
  ('lecturer_modules',             100),
  ('students',                     110),
  ('student_registrations',        120),
  ('student_registration_modules', 130),
  ('student_modules',              140),
  ('module_outcomes',              150),
  ('assignments',                  160),
  ('submissions',                  170),
  ('exams',                        180),
  ('marks',                        190),
  ('assessment_marks',             200),
  ('attendance',                   210),
  ('timetable',                    220),
  ('timetable_documents',          230),
  ('module_notes',                 240),
  ('notifications',                250),
  ('user_notifications',           260),
  ('applicants',                   270),
  ('applications',                 280),
  ('admission_enquiries',          290);

-- ── 3. Helpers ──────────────────────────────────────────────────────────────

-- SQL fragments for one table: how to match a live row to its snapshot row,
-- and which columns to copy. Columns added after the snapshot are left alone.
create function uat_snapshot._parts(
  t text,
  out join_cond text, out cols text, out s_cols text, out p_cols text,
  out upd_cols text, out upd_vals text, out p_txt text, out s_txt text)
language plpgsql stable set search_path = '' as $$
begin
  select string_agg(format('p.%1$I = s.%1$I', a.attname), ' and ')
    into join_cond
  from pg_index i
  join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
  where i.indrelid = format('public.%I', t)::regclass and i.indisprimary;

  if join_cond is null then
    raise exception 'public.% has no primary key', t;
  end if;

  with c as (
    select a.attname, a.attnum,
           exists (select 1 from pg_index i
                   where i.indrelid = a.attrelid and i.indisprimary
                     and a.attnum = any (i.indkey)) as is_pk
    from pg_attribute a
    where a.attrelid = format('public.%I', t)::regclass
      and a.attnum > 0 and not a.attisdropped and a.attgenerated = ''
      and exists (select 1 from pg_attribute b
                  where b.attrelid = format('uat_snapshot.%I', t)::regclass
                    and b.attname = a.attname and not b.attisdropped)
  )
  select string_agg(format('%I', attname),         ', ' order by attnum),
         string_agg(format('s.%I', attname),       ', ' order by attnum),
         string_agg(format('p.%I', attname),       ', ' order by attnum),
         string_agg(format('%I', attname),         ', ' order by attnum) filter (where not is_pk),
         string_agg(format('s.%I', attname),       ', ' order by attnum) filter (where not is_pk),
         string_agg(format('p.%I::text', attname), ', ' order by attnum) filter (where not is_pk),
         string_agg(format('s.%I::text', attname), ', ' order by attnum) filter (where not is_pk)
    into cols, s_cols, p_cols, upd_cols, upd_vals, p_txt, s_txt
  from c;
end $$;

-- Login accounts created since the snapshot, and what the cleanup will do
-- with each. Anything tied to HR or payroll is kept.
create function uat_snapshot.new_accounts()
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
    end as reason
  ) k
  where not exists (select 1 from uat_snapshot._auth_users s where s.id = u.id)
  order by u.created_at
$$;

-- Files uploaded to the LMS buckets since the snapshot.
create function uat_snapshot.new_files()
returns table (bucket text, path text, created_at timestamptz)
language sql stable set search_path = '' as $$
  select o.bucket_id, o.name, o.created_at
  from storage.objects o
  where o.bucket_id in ('applicant-docs', 'assignment-files', 'module-notes', 'student-photos', 'timetables')
    and not exists (select 1 from uat_snapshot._storage_objects s where s.id = o.id)
  order by o.bucket_id, o.created_at
$$;

-- ── 4. The report: what UAT has changed so far ──────────────────────────────
create function uat_snapshot.diff()
returns table (tbl text, added bigint, changed bigint, removed bigint)
language plpgsql stable set search_path = '' as $$
declare
  r record;
  x record;
begin
  for r in select l.tbl as t from uat_snapshot._lms_tables l order by l.ord loop
    tbl := r.t;
    added := null; changed := null; removed := null;
    if to_regclass(format('public.%I', r.t)) is null
       or to_regclass(format('uat_snapshot.%I', r.t)) is null then
      tbl := r.t || '  ** MISSING — check before cleanup **';
      return next;
      continue;
    end if;
    select * into x from uat_snapshot._parts(r.t);
    execute format('select count(*) from public.%1$I p where not exists (select 1 from uat_snapshot.%1$I s where %2$s)',
                   r.t, x.join_cond) into added;
    execute format('select count(*) from uat_snapshot.%1$I s where not exists (select 1 from public.%1$I p where %2$s)',
                   r.t, x.join_cond) into removed;
    if x.upd_cols is null then
      changed := 0;
    else
      execute format('select count(*) from public.%1$I p join uat_snapshot.%1$I s on %2$s where (%3$s) is distinct from (%4$s)',
                     r.t, x.join_cond, x.p_txt, x.s_txt) into changed;
    end if;
    return next;
  end loop;

  -- Report-only rows. The cleanup does not change these; they are here so
  -- nothing surprising is missed.
  added := null; changed := null; removed := null;

  tbl := '[accounts] created during UAT — will be deleted';
  select count(*) into added from uat_snapshot.new_accounts() a where a.action = 'delete';
  return next;

  tbl := '[accounts] created during UAT — will be KEPT (HR)';
  select count(*) into added from uat_snapshot.new_accounts() a where a.action = 'keep';
  return next;

  added := null;
  for r in
    select c.relname as t
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and to_regclass(format('uat_snapshot.%I', c.relname)) is null
  loop
    tbl := '[new table, not tracked] ' || r.t || ' — run track_new_table() if it is LMS';
    execute format('select count(*) from public.%I', r.t) into added;
    return next;
  end loop;

  added := null;
  for r in select p.t from (values ('profiles'), ('user_roles')) p(t) loop
    tbl := '[report only] ' || r.t || ' of pre-UAT users, edited';
    select * into x from uat_snapshot._parts(r.t);
    execute format('select count(*) from public.%1$I p join uat_snapshot.%1$I s on %2$s where (%3$s) is distinct from (%4$s)',
                   r.t, x.join_cond, x.p_txt, x.s_txt) into changed;
    return next;
  end loop;

  changed := null;
  added := null;
  for r in
    select l.tbl as t, string_agg(a.attname, ', ') as missing
    from uat_snapshot._lms_tables l
    join pg_attribute a on a.attrelid = to_regclass(format('public.%I', l.tbl))
    where a.attnum > 0 and not a.attisdropped and a.attgenerated = ''
      and to_regclass(format('uat_snapshot.%I', l.tbl)) is not null
      and not exists (select 1 from pg_attribute b
                      where b.attrelid = format('uat_snapshot.%I', l.tbl)::regclass
                        and b.attname = a.attname and not b.attisdropped)
    group by l.tbl
  loop
    tbl := '[new columns, not in snapshot] ' || r.t || ' (' || r.missing || ') — run after_migration()';
    return next;
  end loop;

  tbl := '[files] uploaded to LMS buckets — delete by hand';
  select count(*) into added from uat_snapshot.new_files();
  return next;
end $$;

-- ── 5. Keeping code and migration changes made during UAT ───────────────────
-- Fixes from UAT are part of the live system and must survive the wipe.
-- Code, RLS policies, functions and edge functions are never touched by the
-- wipe: it only puts table ROWS back. But a migration can also change LMS
-- tables or LMS data, and the snapshot has to learn about that, or the wipe
-- would undo it. After every migration that touches an LMS table, run what
-- applies, BEFORE testers use the change:
--
--   New LMS table           select uat_snapshot.track_new_table('exam_attendance', 185);
--   New columns / backfill  select * from uat_snapshot.after_migration();
--   Fix to live LMS rows    select uat_snapshot.keep_live_rows('exams', 'p.mark = 0');
--     (also for rows a migration seeds, e.g. a config row; p is the live row)
--   Fix that DELETES live rows: run the same DELETE against uat_snapshot.<table> too.
--
-- uat_snapshot.diff() flags new tables and new columns that were not recorded.

-- New table: the snapshot copies its current rows, so whatever the migration
-- put in it is kept and only later (UAT) rows are wiped. The number places it
-- among the tables above (parents before children).
create function uat_snapshot.track_new_table(t text, at_ord int)
returns text
language plpgsql set search_path = '' as $$
begin
  if to_regclass(format('public.%I', t)) is null then
    raise exception 'public.% does not exist', t;
  end if;
  if to_regclass(format('uat_snapshot.%I', t)) is not null then
    raise exception '% is already in the snapshot', t;
  end if;
  execute format('create table uat_snapshot.%1$I as table public.%1$I', t);
  insert into uat_snapshot._lms_tables (tbl, ord) values (t, at_ord);
  revoke all on all tables in schema uat_snapshot from public, anon, authenticated;
  return t || ' is now tracked; its UAT rows will be wiped at cleanup';
end $$;

-- New columns on LMS tables: added to the snapshot with the values the
-- migration gave the live rows (defaults, backfills). Values typed into them
-- later during UAT are then reset by the wipe like any other UAT edit.
create function uat_snapshot.after_migration()
returns table (tbl text, column_added text)
language plpgsql set search_path = '' as $$
declare r record; x record;
begin
  for r in
    select l.tbl as t, a.attname as c, format_type(a.atttypid, a.atttypmod) as typ
    from uat_snapshot._lms_tables l
    join pg_attribute a on a.attrelid = to_regclass(format('public.%I', l.tbl))
    where a.attnum > 0 and not a.attisdropped and a.attgenerated = ''
      and to_regclass(format('uat_snapshot.%I', l.tbl)) is not null
      and not exists (select 1 from pg_attribute b
                      where b.attrelid = format('uat_snapshot.%I', l.tbl)::regclass
                        and b.attname = a.attname and not b.attisdropped)
  loop
    execute format('alter table uat_snapshot.%I add column %I %s', r.t, r.c, r.typ);
    select * into x from uat_snapshot._parts(r.t);
    execute format('update uat_snapshot.%1$I s set %2$I = p.%2$I from public.%1$I p where %3$s',
                   r.t, r.c, x.join_cond);
    tbl := r.t; column_added := r.c; return next;
  end loop;
end $$;

-- Fix to live LMS data: the rows matching the condition are copied, as they
-- are now, into the snapshot, so the wipe keeps the fix. Run it straight
-- after the fix, before testers edit those rows.
create function uat_snapshot.keep_live_rows(t text, condition text)
returns text
language plpgsql set search_path = '' as $$
declare x record; n_del bigint; n_ins bigint;
begin
  if not exists (select 1 from uat_snapshot._lms_tables l where l.tbl = t) then
    raise exception '% is not an LMS table in the snapshot', t;
  end if;
  select * into x from uat_snapshot._parts(t);
  execute format('delete from uat_snapshot.%1$I s using public.%1$I p where %2$s and (%3$s)',
                 t, x.join_cond, condition);
  get diagnostics n_del = row_count;
  execute format('insert into uat_snapshot.%1$I (%2$s) select %3$s from public.%1$I p where (%4$s)',
                 t, x.cols, x.p_cols, condition);
  get diagnostics n_ins = row_count;
  return format('%s: %s rows now kept as live (%s replaced, %s new)', t, n_ins, n_del, n_ins - n_del);
end $$;

-- ── 6. The cleanup itself (used in step 3, not now) ─────────────────────────
-- Puts every LMS table back exactly as it was at the snapshot, then deletes
-- the UAT login accounts. One statement, one transaction: if any step fails,
-- or the final check finds a single difference, nothing at all is changed.
create function uat_snapshot.restore(confirm text, keep_emails text[] default '{}')
returns table (step text, tbl text, n_rows bigint)
language plpgsql set search_path = '' as $$
declare
  r record;
  x record;
  n bigint;
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

  -- c) Delete UAT login accounts. Their profiles, roles and notifications go
  --    with them (ON DELETE CASCADE).
  delete from auth.users u
  using uat_snapshot.new_accounts() a
  where a.user_id = u.id
    and a.action = 'delete'
    and not (lower(u.email) = any (select lower(e) from unnest(keep_emails) e));
  get diagnostics n = row_count;
  step := 'c. UAT accounts deleted'; tbl := 'auth.users'; n_rows := n; return next;

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
end $$;

revoke all on all tables    in schema uat_snapshot from public, anon, authenticated;
revoke all on all functions in schema uat_snapshot from public, anon, authenticated;

-- ── 7. Confirm the snapshot ─────────────────────────────────────────────────
-- Every row must show the same count in both columns.
do $$
declare r record; a bigint; b bigint; bad int := 0;
begin
  for r in select tablename from pg_tables where schemaname = 'public' loop
    execute format('select count(*) from public.%I', r.tablename) into a;
    execute format('select count(*) from uat_snapshot.%I', r.tablename) into b;
    if a <> b then bad := bad + 1; end if;
  end loop;
  if bad > 0 then
    raise exception '% tables differ from their snapshot copy. Nothing was saved.', bad;
  end if;
end $$;

commit;

-- The summary. Note these numbers.
select (select taken_at from uat_snapshot._meta)                         as snapshot_taken_at,
       (select count(*) from pg_tables where schemaname = 'uat_snapshot') as tables_copied,
       (select count(*) from uat_snapshot._auth_users)                    as accounts,
       (select count(*) from uat_snapshot._storage_objects)               as files,
       (select count(*) from uat_snapshot.students)                       as students,
       (select count(*) from uat_snapshot.assessment_marks)               as assessment_marks,
       (select count(*) from uat_snapshot.employees)                      as employees;
