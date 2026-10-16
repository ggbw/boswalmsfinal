-- Exact row counts for every table restored from the export, in the same
-- "schema.table: N rows" form that the dump reader prints, for diffing.
\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned
select format('%s.%s: %s rows', table_schema, table_name,
  (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text)
from information_schema.tables
where table_type = 'BASE TABLE'
  and (table_schema = 'public' or (table_schema = 'auth' and table_name in ('users', 'identities')))
order by 1;
select format('objects: functions %s, policies %s, triggers %s, storage policies %s',
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'),
  (select count(*) from pg_policies where schemaname = 'public'),
  (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and not t.tgisinternal),
  (select count(*) from pg_policies where schemaname = 'storage'));
