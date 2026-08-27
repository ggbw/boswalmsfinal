-- Allow a fourth kind of backup run: 'files'.
--
-- WHY
--
-- Until now the nightly pg_dump was the whole cloud backup, and everything in
-- Supabase Storage — every student photo, applicant document, employee file,
-- assignment upload and timetable — was in no backup at all. Those objects do
-- not live in the database, so pg_dump has never contained them. A weekly job
-- now copies them to Google Drive as well (scripts/vps/files-backup.mjs), and
-- it needs somewhere to report to.
--
-- WHY A NEW KIND RATHER THAN ANOTHER 'cloud' ROW
--
-- backup_health() counts `kind = 'cloud'` rows alone to decide whether the
-- freshness banner is red. Reusing 'cloud' for the file sync would mean a
-- failed photo copy turned the *database* indicator red, and — far worse — a
-- successful photo copy would mask a database backup that had silently stopped
-- running. That is precisely the manufactured confidence this whole feature
-- exists to prevent, so the two answers stay separate.
--
-- backup_health() is deliberately NOT changed. Files are weekly and are shown
-- in their own section of the Nightly tab; folding them into the one banner
-- would blur the question it answers.
--
-- APPLY WITH
--
--   node scripts/apply-migration.mjs supabase/migrations/20260827120000_backup_runs_files_kind.sql
--
-- NOT with `supabase db push`, `db reset` or `migration repair` — see the note
-- at the top of supabase/config.toml. Apply this BEFORE deploying a
-- backup-report that accepts 'files', and before the first files run: sending
-- an unknown kind to record_backup_run() raises, and the runner's whole finish
-- call answers 500.

-- The constraint was declared inline as `kind text NOT NULL CHECK (...)`, so
-- Postgres generated its name. `backup_runs_kind_check` is the overwhelmingly
-- likely result, but it is not guaranteed — and a DROP CONSTRAINT IF EXISTS on
-- a guessed name would silently do nothing, leaving the old constraint in place
-- to reject every 'files' row while this migration reported success.
--
-- So find it by what it says rather than by what it is called.
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'public.backup_runs'::regclass
       AND contype  = 'c'
       AND pg_get_constraintdef(oid) LIKE '%restore_test%'
  LOOP
    EXECUTE format('ALTER TABLE public.backup_runs DROP CONSTRAINT %I', c.conname);
    RAISE NOTICE 'Dropped the old kind constraint: %', c.conname;
  END LOOP;
END $$;

-- Named explicitly this time, so the next migration to touch it does not have
-- to go looking.
ALTER TABLE public.backup_runs
  ADD CONSTRAINT backup_runs_kind_check
  CHECK (kind IN ('usb', 'cloud', 'files', 'restore_test'));

COMMENT ON COLUMN public.backup_runs.kind IS
  'usb = an admin''s one-click download; cloud = the nightly pg_dump to Google '
  'Drive; files = the weekly Storage-bucket sync to Google Drive; restore_test '
  '= the weekly proof that the newest dump actually restores.';

-- PostgREST caches its picture of the schema. Without this the API keeps
-- rejecting the new value for up to a minute after this file has run, which
-- reads as the migration having failed.
NOTIFY pgrst, 'reload schema';
