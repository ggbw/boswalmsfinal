-- ============================================================================
-- Close unauthenticated read access
-- ============================================================================
-- Verified against the live DB on 2026-08-12:
--
--   employee_leave_balances, programme_modules, module_notes
--     → RLS was switched OFF. With RLS off, PostgREST serves these tables to
--       the `anon` role, so anyone holding the publishable key (which ships in
--       the browser bundle) could read them WITHOUT LOGGING IN.
--       employee_leave_balances holds named staff leave balances.
--
--   storage bucket `module-notes`
--     → public = true, so every uploaded note was fetchable by URL with no
--       login. Safe to close: NotesPage reads it with .download() (an
--       authenticated request), not getPublicUrl().
--
-- NOT changed here, deliberately:
--   storage bucket `student-photos` is also public, but ProfilePage and
--   PhotoGalleryPage read it via getPublicUrl(). Making it private would blank
--   every student photo in the app. Closing it needs the read path moved to
--   createSignedUrl() first — tracked as a separate change.
--
-- Idempotent: safe to run more than once.
-- ============================================================================


-- ── 1. employee_leave_balances — HR data, super_admin/hr only ───────────────
ALTER TABLE public.employee_leave_balances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "HR reads leave balances"   ON public.employee_leave_balances;
DROP POLICY IF EXISTS "HR manages leave balances" ON public.employee_leave_balances;

CREATE POLICY "HR reads leave balances"
  ON public.employee_leave_balances FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'super_admin'::app_role)
    OR has_role(auth.uid(), 'hr'::app_role)
  );

CREATE POLICY "HR manages leave balances"
  ON public.employee_leave_balances FOR ALL TO authenticated
  USING (
    has_role(auth.uid(), 'super_admin'::app_role)
    OR has_role(auth.uid(), 'hr'::app_role)
  )
  WITH CHECK (
    has_role(auth.uid(), 'super_admin'::app_role)
    OR has_role(auth.uid(), 'hr'::app_role)
  );


-- ── 2. programme_modules — everyone signed in reads, admins write ───────────
-- Read must stay open to all authenticated users: useDbData loads this table
-- for every role, and ClassesPage.syncModulesForClass reads it to rebuild
-- module_classes. Writes come only from ConfigPage, which is admin-gated.
ALTER TABLE public.programme_modules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read programme_modules"  ON public.programme_modules;
DROP POLICY IF EXISTS "Admins manage programme_modules"       ON public.programme_modules;

CREATE POLICY "Authenticated read programme_modules"
  ON public.programme_modules FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Admins manage programme_modules"
  ON public.programme_modules FOR ALL TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'super_admin'::app_role)
  )
  WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'super_admin'::app_role)
  );


-- ── 3. module_notes — turn RLS on, and stop students deleting notes ─────────
-- The four policies from 20260321095812 already exist but have never applied,
-- because RLS was off. Enabling it closes anon immediately. The write policies
-- were USING (true) for any authenticated user, which let a student delete a
-- lecturer's notes — narrow them to the same staff set NotesPage.canUpload uses.
ALTER TABLE public.module_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated insert module_notes" ON public.module_notes;
DROP POLICY IF EXISTS "Authenticated update module_notes" ON public.module_notes;
DROP POLICY IF EXISTS "Authenticated delete module_notes" ON public.module_notes;
DROP POLICY IF EXISTS "Staff manage module_notes"         ON public.module_notes;

-- "Authenticated read module_notes" (SELECT, USING true) is left in place:
-- students need to read notes for their modules.

CREATE POLICY "Staff manage module_notes"
  ON public.module_notes FOR ALL TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'super_admin'::app_role)
    OR has_role(auth.uid(), 'hod'::app_role)
    OR has_role(auth.uid(), 'hoy'::app_role)
    OR has_role(auth.uid(), 'lecturer'::app_role)
  )
  WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'super_admin'::app_role)
    OR has_role(auth.uid(), 'hod'::app_role)
    OR has_role(auth.uid(), 'hoy'::app_role)
    OR has_role(auth.uid(), 'lecturer'::app_role)
  );


-- ── 4. module-notes bucket — private, with a size cap ───────────────────────
-- The bucket has no storage.objects policies at all (it was created by hand and
-- relied on public = true). Setting public = false WITHOUT adding a SELECT
-- policy would break every download, so both happen together here.
--
-- No allowed_mime_types is set: the browser does not always report a reliable
-- content type for Office files, and a rejected upload would be a new failure
-- for lecturers. File-type restriction belongs with the client-side `accept`
-- attribute, so the two stay consistent — tracked as a separate change.
UPDATE storage.buckets
   SET public          = false,
       file_size_limit = 20971520   -- 20 MB; the app enforces nothing today
 WHERE id = 'module-notes';

DROP POLICY IF EXISTS "Authenticated read module-notes"  ON storage.objects;
DROP POLICY IF EXISTS "Staff write module-notes"         ON storage.objects;
DROP POLICY IF EXISTS "Staff update module-notes"        ON storage.objects;
DROP POLICY IF EXISTS "Staff delete module-notes"        ON storage.objects;

CREATE POLICY "Authenticated read module-notes"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'module-notes');

CREATE POLICY "Staff write module-notes"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'module-notes'
    AND (
      has_role(auth.uid(), 'admin'::app_role)
      OR has_role(auth.uid(), 'super_admin'::app_role)
      OR has_role(auth.uid(), 'hod'::app_role)
      OR has_role(auth.uid(), 'hoy'::app_role)
      OR has_role(auth.uid(), 'lecturer'::app_role)
    )
  );

CREATE POLICY "Staff update module-notes"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'module-notes'
    AND (
      has_role(auth.uid(), 'admin'::app_role)
      OR has_role(auth.uid(), 'super_admin'::app_role)
      OR has_role(auth.uid(), 'hod'::app_role)
      OR has_role(auth.uid(), 'hoy'::app_role)
      OR has_role(auth.uid(), 'lecturer'::app_role)
    )
  );

CREATE POLICY "Staff delete module-notes"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'module-notes'
    AND (
      has_role(auth.uid(), 'admin'::app_role)
      OR has_role(auth.uid(), 'super_admin'::app_role)
      OR has_role(auth.uid(), 'hod'::app_role)
      OR has_role(auth.uid(), 'hoy'::app_role)
      OR has_role(auth.uid(), 'lecturer'::app_role)
    )
  );
