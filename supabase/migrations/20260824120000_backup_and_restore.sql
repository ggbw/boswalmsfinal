-- Backup & Restore — the database half.
--
-- Two features share this migration because they share one question: "what is
-- in this database, and when was it last copied somewhere safe?"
--
--   1. Local backup   an admin clicks once, the whole database streams to a
--                     USB stick as one compressed file.
--   2. Cloud backup   the VPS runs pg_dump nightly, ships it to Google Drive,
--                     and reports the outcome back here so the UI can say how
--                     old the newest good copy is.
--
-- Nothing here writes backups itself. It provides three things the two paths
-- both need:
--
--   backup_table_order()   every public table, in an order that can be
--                          restored without tripping a foreign key
--   backup_runs            one row per backup attempt, successful or not
--   record_backup_run()    the only way to write that table
--
-- The freshness banner on the Backup page is the real alerting mechanism for
-- the nightly job. A cron job that fails silently is worse than no cron job,
-- because it manufactures confidence; a row that stops appearing here is
-- visible to anyone who opens the page.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Table inventory, in foreign-key-safe order
-- ─────────────────────────────────────────────────────────────────────────────
-- A restore that inserts student_registration_modules before students fails on
-- the FK. Rather than maintain a hand-written list — which would silently rot
-- the first time someone adds a table — the order is derived from the live FK
-- graph every time it is asked for.
--
-- `depth` is the length of the longest FK chain leading to a table: level 0 is
-- everything that references nothing, level 1 references only level 0, and so
-- on. Restoring in ascending depth is always safe.

CREATE OR REPLACE FUNCTION public.backup_table_order()
RETURNS TABLE (
  table_name  text,
  pk_columns  text[],
  depth       integer,
  approx_rows bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- One recursive query, no temporary table.
  --
  -- The obvious way to write this is a temp table relaxed in a loop, and that
  -- version was wrong twice over: a SECURITY DEFINER function carrying
  -- `SET search_path = public` has no pg_temp in its path, and PostgREST runs
  -- a STABLE function inside a read-only transaction where CREATE TABLE fails
  -- outright. Both failures would only have appeared at the moment somebody
  -- pressed "back up", which is the worst moment for a backup tool to discover
  -- anything about itself.
  --
  -- `walk` starts every table at level 0 and pushes each child one level below
  -- its parent. UNION (not UNION ALL) dedupes on (node, level), so the working
  -- set can never exceed tables x levels — 66 x 13 here — and the query
  -- terminates even if the foreign keys ever form a cycle. The level cap is
  -- twice the depth of any realistic schema; this one is 6 deep.
  WITH RECURSIVE
  permitted AS (
    -- Admins and the edge functions' service role. Anyone else gets an empty
    -- result rather than an error, so a mis-called RPC cannot be used to map
    -- the schema.
    SELECT (
      auth.role() = 'service_role'
      OR public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'super_admin')
    ) AS ok
  ),
  tabs AS (
    SELECT c.oid,
           c.relname::text AS tbl,
           GREATEST(c.reltuples, 0)::bigint AS est
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind = 'r'            -- ordinary tables: no views, no
                                      -- partitions, no foreign tables
       AND c.relpersistence = 'p'     -- and nothing temporary
       AND (SELECT ok FROM permitted)
  ),
  edges AS (
    -- Self-references (a parent_id pointing at the same table) are excluded:
    -- they resolve inside a single table's insert batch, not between tables,
    -- and counting them would push a table below itself for ever.
    SELECT DISTINCT fk.conrelid AS child, fk.confrelid AS parent
      FROM pg_constraint fk
     WHERE fk.contype = 'f'
       AND fk.conrelid <> fk.confrelid
       AND fk.conrelid  IN (SELECT oid FROM tabs)
       AND fk.confrelid IN (SELECT oid FROM tabs)
  ),
  walk (node, lvl) AS (
    SELECT t.oid, 0 FROM tabs t
    UNION
    SELECT e.child, w.lvl + 1
      FROM walk w
      JOIN edges e ON e.parent = w.node
     WHERE w.lvl < 12
  ),
  levels AS (
    -- The LONGEST path into a table, not the shortest: a table is only safe to
    -- insert once every one of its parents is in, however deep the deepest of
    -- them turned out to be.
    SELECT node, max(lvl) AS lvl FROM walk GROUP BY node
  ),
  pks AS (
    SELECT pc.conrelid AS oid,
           array_agg(a.attname::text ORDER BY k.ord) AS cols
      FROM pg_constraint pc
      CROSS JOIN LATERAL unnest(pc.conkey) WITH ORDINALITY AS k(attnum, ord)
      JOIN pg_attribute a ON a.attrelid = pc.conrelid AND a.attnum = k.attnum
     WHERE pc.contype = 'p'
     GROUP BY pc.conrelid
  )
  SELECT t.tbl,
         COALESCE(p.cols, ARRAY[]::text[]),
         COALESCE(l.lvl, 0)::integer,
         t.est
    FROM tabs t
    LEFT JOIN levels l ON l.node = t.oid
    LEFT JOIN pks    p ON p.oid  = t.oid
   ORDER BY COALESCE(l.lvl, 0), t.tbl;
$$;

REVOKE ALL ON FUNCTION public.backup_table_order() FROM public;
GRANT EXECUTE ON FUNCTION public.backup_table_order() TO authenticated, service_role;

COMMENT ON FUNCTION public.backup_table_order() IS
  'Every public table with its primary key and FK depth. Insert in ascending depth to restore without FK violations.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Exact row counts
-- ─────────────────────────────────────────────────────────────────────────────
-- reltuples above is a planner estimate and can be wildly wrong on a table
-- that has not been analysed. An estimate is fine for showing progress; it is
-- not fine for verifying a backup, where the whole point is that the number in
-- the manifest is the number of rows that were actually written. This does the
-- real count, and is called once per backup rather than per page of rows.

-- One call, not one per table: sixty-odd round trips before a backup even
-- starts would dominate the time taken to run it.

CREATE OR REPLACE FUNCTION public.backup_row_counts()
RETURNS TABLE (table_name text, exact_rows bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  n bigint;
BEGIN
  IF NOT (
    auth.role() = 'service_role'
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
  ) THEN
    RETURN;
  END IF;

  FOR r IN
    SELECT c.relname::text AS tbl
      FROM pg_class c
      JOIN pg_namespace n2 ON n2.oid = c.relnamespace
     WHERE n2.nspname = 'public'
       AND c.relkind = 'r'
       AND c.relpersistence = 'p'
     ORDER BY c.relname
  LOOP
    -- %I quotes the identifier; the name comes from the catalogue, never from
    -- a request body, but going through format() keeps it that way if someone
    -- later parameterises this.
    EXECUTE format('SELECT count(*) FROM public.%I', r.tbl) INTO n;
    table_name := r.tbl;
    exact_rows := n;
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.backup_row_counts() FROM public;
GRANT EXECUTE ON FUNCTION public.backup_row_counts() TO authenticated, service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2b. Columns, so a restore can survive a schema that has moved on
-- ─────────────────────────────────────────────────────────────────────────────
-- A backup taken in March and restored in September will carry columns that
-- have since been dropped and be missing columns that have since been added.
-- Handing such a row to PostgREST fails the whole batch on the first unknown
-- key. The restorer intersects the incoming keys with this list instead, and
-- reports what it dropped rather than discarding the restore.

CREATE OR REPLACE FUNCTION public.backup_table_columns()
RETURNS TABLE (table_name text, column_name text, is_generated boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.table_name::text, c.column_name::text,
         (c.is_generated = 'ALWAYS' OR c.identity_generation = 'ALWAYS')
    FROM information_schema.columns c
   WHERE c.table_schema = 'public'
     AND (
       auth.role() = 'service_role'
       OR public.has_role(auth.uid(), 'admin')
       OR public.has_role(auth.uid(), 'super_admin')
     );
$$;

REVOKE ALL ON FUNCTION public.backup_table_columns() FROM public;
GRANT EXECUTE ON FUNCTION public.backup_table_columns() TO authenticated, service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2c. Emptying a table as part of a replace-restore
-- ─────────────────────────────────────────────────────────────────────────────
-- DELETE, not TRUNCATE … CASCADE. Cascade would silently empty tables nobody
-- named — the single most destructive thing this feature could do by accident.
-- A plain DELETE respects foreign keys, so clearing in reverse dependency
-- order either works or fails loudly with the constraint that stopped it.
--
-- service_role only: there is no path from a browser session to this function,
-- whatever role the browser holds.

CREATE OR REPLACE FUNCTION public.backup_clear_table(_table text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n bigint;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Not permitted';
  END IF;
  IF to_regclass(format('public.%I', _table)) IS NULL THEN
    RAISE EXCEPTION 'No such table: %', _table;
  END IF;
  -- Never lets a restore erase its own trail, nor the account that is running
  -- it. audit_logs is append-only by trigger anyway; naming these here means
  -- the refusal is explicit rather than an obscure trigger error.
  IF _table IN ('audit_logs', 'user_sessions', 'backup_runs', 'user_roles') THEN
    RAISE EXCEPTION 'Refusing to clear %: restoring over it would destroy the record of the restore', _table;
  END IF;

  EXECUTE format('DELETE FROM public.%I', _table);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.backup_clear_table(text) FROM public;
GRANT EXECUTE ON FUNCTION public.backup_clear_table(text) TO service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Backup history
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.backup_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,

  -- 'usb'          an admin's one-click download (JSON snapshot)
  -- 'cloud'        the nightly VPS pg_dump shipped to Google Drive
  -- 'restore_test' the weekly proof that the newest dump actually restores
  kind          text NOT NULL CHECK (kind IN ('usb', 'cloud', 'restore_test')),
  status        text NOT NULL DEFAULT 'running'
                  CHECK (status IN ('running', 'success', 'failed')),

  artifact      text,          -- file name as written
  destination   text,          -- 'USB / local disk', 'Google Drive: /Boswa…'
  storage_path  text,          -- object key in the db-backups bucket, if mirrored
  size_bytes    bigint,
  table_count   integer,
  row_count     bigint,
  checksum      text,          -- sha256 of the artifact

  actor_id      uuid,          -- null for machine-run backups
  actor_label   text,          -- 'Kabo (super_admin)' or 'vps:hik-boswa'
  message       text,          -- failure reason, or a short success note
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS backup_runs_started_idx ON public.backup_runs (started_at DESC);
CREATE INDEX IF NOT EXISTS backup_runs_kind_status_idx ON public.backup_runs (kind, status, started_at DESC);

ALTER TABLE public.backup_runs ENABLE ROW LEVEL SECURITY;

-- Read-only to admins. Writes go through record_backup_run() so that a row can
-- never claim a backup happened under someone else's name.
DROP POLICY IF EXISTS backup_runs_admin_read ON public.backup_runs;
CREATE POLICY backup_runs_admin_read ON public.backup_runs
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
  );


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. The one way to write backup_runs
-- ─────────────────────────────────────────────────────────────────────────────
-- Called twice per backup: once with no id to open a 'running' row, then again
-- with that id to close it. A row left 'running' is itself a signal — it means
-- a backup started and never came back, which is exactly the failure a cron
-- job hides when it only writes on success.

CREATE OR REPLACE FUNCTION public.record_backup_run(
  p_id           uuid    DEFAULT NULL,
  p_kind         text    DEFAULT 'usb',
  p_status       text    DEFAULT 'running',
  p_artifact     text    DEFAULT NULL,
  p_destination  text    DEFAULT NULL,
  p_storage_path text    DEFAULT NULL,
  p_size_bytes   bigint  DEFAULT NULL,
  p_table_count  integer DEFAULT NULL,
  p_row_count    bigint  DEFAULT NULL,
  p_checksum     text    DEFAULT NULL,
  p_actor_label  text    DEFAULT NULL,
  p_message      text    DEFAULT NULL,
  p_metadata     jsonb   DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id    uuid := p_id;
  v_actor uuid := auth.uid();
BEGIN
  IF NOT (
    auth.role() = 'service_role'
    OR public.has_role(v_actor, 'admin')
    OR public.has_role(v_actor, 'super_admin')
  ) THEN
    RAISE EXCEPTION 'Not permitted';
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO public.backup_runs (
      kind, status, artifact, destination, storage_path, size_bytes,
      table_count, row_count, checksum, actor_id, actor_label, message, metadata
    ) VALUES (
      p_kind, p_status, p_artifact, p_destination, p_storage_path, p_size_bytes,
      p_table_count, p_row_count, p_checksum, v_actor, p_actor_label, p_message,
      COALESCE(p_metadata, '{}'::jsonb)
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.backup_runs SET
      status       = COALESCE(p_status, status),
      artifact     = COALESCE(p_artifact, artifact),
      destination  = COALESCE(p_destination, destination),
      storage_path = COALESCE(p_storage_path, storage_path),
      size_bytes   = COALESCE(p_size_bytes, size_bytes),
      table_count  = COALESCE(p_table_count, table_count),
      row_count    = COALESCE(p_row_count, row_count),
      checksum     = COALESCE(p_checksum, checksum),
      actor_label  = COALESCE(p_actor_label, actor_label),
      message      = COALESCE(p_message, message),
      metadata     = COALESCE(p_metadata, metadata),
      finished_at  = CASE WHEN COALESCE(p_status, status) IN ('success', 'failed')
                          THEN now() ELSE finished_at END
     WHERE id = v_id;
  END IF;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_backup_run(
  uuid, text, text, text, text, text, bigint, integer, bigint, text, text, text, jsonb
) FROM public;
GRANT EXECUTE ON FUNCTION public.record_backup_run(
  uuid, text, text, text, text, text, bigint, integer, bigint, text, text, text, jsonb
) TO authenticated, service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Backup health, in one row
-- ─────────────────────────────────────────────────────────────────────────────
-- The banner at the top of the Backup page. Deliberately answers the question
-- an auditor asks — "how old is the newest copy of this database that is known
-- to restore?" — rather than "did last night's job exit zero".

CREATE OR REPLACE FUNCTION public.backup_health()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN NOT (
      public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'super_admin')
    ) THEN '{}'::jsonb
    ELSE jsonb_build_object(
      'last_cloud_success',   (SELECT max(started_at) FROM public.backup_runs
                                WHERE kind = 'cloud' AND status = 'success'),
      'last_cloud_failure',   (SELECT max(started_at) FROM public.backup_runs
                                WHERE kind = 'cloud' AND status = 'failed'),
      'last_usb_success',     (SELECT max(started_at) FROM public.backup_runs
                                WHERE kind = 'usb' AND status = 'success'),
      'last_verified_restore',(SELECT max(started_at) FROM public.backup_runs
                                WHERE kind = 'restore_test' AND status = 'success'),
      'cloud_failures_7d',    (SELECT count(*) FROM public.backup_runs
                                WHERE kind = 'cloud' AND status <> 'success'
                                  AND started_at > now() - interval '7 days')
    )
  END;
$$;

REVOKE ALL ON FUNCTION public.backup_health() FROM public;
GRANT EXECUTE ON FUNCTION public.backup_health() TO authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Storage bucket for the nightly dump
-- ─────────────────────────────────────────────────────────────────────────────
-- The VPS mirrors each nightly pg_dump here as well as to Google Drive, so the
-- Backup page can offer "save last night's dump to USB" without the browser
-- ever talking to the VPS. Private, and never read directly by the client —
-- only through a short-lived signed URL.
--
-- Retention in this bucket is days, not months: it is a convenience copy. The
-- retained history lives in Google Drive.

-- ⚠ THIS SECTION IS DELIBERATELY NON-FATAL. Read before "tidying" it.
--
-- `storage.objects` is owned by `supabase_storage_admin`, not by the role the
-- SQL editor runs as. On many projects CREATE POLICY on it therefore fails
-- with
--
--   42501: must be owner of table objects
--
-- and because the editor runs a whole script as ONE transaction, that failure
-- at the end of the file rolls back everything above it — the table, all six
-- functions, the lot. The migration then looks like it ran, and the API keeps
-- answering PGRST205. That is a genuinely nasty way to lose an afternoon, and
-- it happened.
--
-- So the storage work is wrapped: if it cannot be done from here it raises a
-- WARNING and the rest of the migration still commits. The bucket can then be
-- made by hand in ten seconds (Storage → New bucket → 'db-backups', private),
-- and everything except the "Nightly cloud backups" tab works without it.

DO $storage$
BEGIN
  INSERT INTO storage.buckets (id, name, public)
  VALUES ('db-backups', 'db-backups', false)
  ON CONFLICT (id) DO NOTHING;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Could not create the db-backups bucket (%). Create it by hand: Storage -> New bucket -> name "db-backups", Public = OFF.', SQLERRM;
END
$storage$;

-- The read policy, separately, for the same reason: the bucket may well be
-- creatable when the policy is not.
--
-- No INSERT/UPDATE/DELETE policy for authenticated users on purpose. The only
-- writer is the VPS, through a signed upload URL minted by an edge function
-- holding the service role key. A browser cannot put anything in this bucket,
-- so nobody can plant a file that looks like a backup.
DO $storage$
BEGIN
  EXECUTE 'DROP POLICY IF EXISTS "db-backups admin read" ON storage.objects';
  EXECUTE $policy$
    CREATE POLICY "db-backups admin read" ON storage.objects
      FOR SELECT TO authenticated
      USING (
        bucket_id = 'db-backups'
        AND (
          public.has_role(auth.uid(), 'admin')
          OR public.has_role(auth.uid(), 'super_admin')
        )
      )
  $policy$;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Could not create the db-backups read policy (%). Add it from Storage -> db-backups -> Policies, or run this section as supabase_storage_admin. Everything except the "Nightly cloud backups" tab works without it.', SQLERRM;
END
$storage$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Tell PostgREST the schema changed
-- ─────────────────────────────────────────────────────────────────────────────
-- Without this, the API keeps serving its cached picture of the schema and
-- answers every call to the new table and functions with
--
--   PGRST205  Could not find the table 'public.backup_runs' in the schema cache
--   PGRST202  Could not find the function public.backup_health …
--
-- — which reads exactly like "the migration did not run" even though it did.
-- PostgREST reloads on its own within a minute or so, and on a project restart;
-- this just makes it immediate.
NOTIFY pgrst, 'reload schema';


-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Verify (run these after the migration, they change nothing)
-- ─────────────────────────────────────────────────────────────────────────────
--
--   -- every table, deepest last; expect ~66 rows and a max depth around 6
--   SELECT depth, count(*) FROM public.backup_table_order()
--    GROUP BY depth ORDER BY depth;
--
--   -- exact counts
--   SELECT * FROM public.backup_row_counts() ORDER BY exact_rows DESC LIMIT 10;
--
--   -- the object the Backup page's banner reads
--   SELECT public.backup_health();
--
--   -- the history table and its policy
--   SELECT count(*) FROM public.backup_runs;
--   SELECT polname FROM pg_policy
--    WHERE polrelid = 'public.backup_runs'::regclass;
--
--   -- the private bucket
--   SELECT id, public FROM storage.buckets WHERE id = 'db-backups';
--
--   -- all six functions present
--   SELECT proname FROM pg_proc p
--     JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND proname LIKE 'backup%'
--    ORDER BY proname;
--   -- expect: backup_clear_table, backup_health, backup_row_counts,
--   --         backup_table_columns, backup_table_order, record_backup_run
