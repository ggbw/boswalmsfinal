-- ============================================================================
-- Move assignment attachments and student submissions to Storage
-- ============================================================================
-- Today both are stored as base64 data URLs in text columns:
--   assignments.attachment_data
--   submissions.file_data
--
-- base64 inflates a file by about a third, so a 10 MB upload becomes ~13 MB of
-- row data. That made the bulk loader (useDbData) slow enough that those two
-- columns were dropped from its SELECT — and because the download links are
-- gated on the data being present, they now NEVER RENDER. Live check on
-- 2026-08-12: all 3 assignments have an attachment, none is downloadable; the
-- two columns hold 3.3 MB between them.
--
-- Fix: new uploads go to a private Storage bucket and the row keeps only a path.
-- The existing base64 rows are left exactly as they are — the app falls back to
-- fetching that single column on demand when a path is absent, so the 3 current
-- attachments become downloadable again without any data migration.
--
-- Bucket is PRIVATE. Downloads go through createSignedUrl(), so nothing is
-- reachable without a session — unlike student-photos, which is still public.
--
-- Idempotent: safe to run more than once.
-- ============================================================================


-- ── 1. Path columns ─────────────────────────────────────────────────────────
-- Nullable on purpose: NULL means "this row predates Storage, look in the
-- base64 column instead". That is what makes the old rows keep working.
ALTER TABLE public.assignments ADD COLUMN IF NOT EXISTS attachment_path TEXT;
ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS file_path       TEXT;


-- ── 2. The bucket ───────────────────────────────────────────────────────────
-- 10 MB matches the limit the app already applies in the browser. Setting it
-- here makes it real: the browser check alone is trivially bypassed.
--
-- No allowed_mime_types, for the same reason as module-notes: browsers do not
-- reliably report a content type for Office documents, and a rejected upload
-- would be a new failure for students mid-deadline. File-type restriction
-- belongs with the client-side `accept` attribute so the two agree.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('assignment-files', 'assignment-files', false, 10485760)
ON CONFLICT (id) DO UPDATE
  SET public = false, file_size_limit = 10485760;


-- ── 3. Storage policies ─────────────────────────────────────────────────────
-- Path layout:
--   assignments/<assignment_id>/<filename>              — the brief/rubric
--   submissions/<assignment_id>/<student_id>/<filename> — a student's work
--                                ^ students.id, matching submissions.student_id
--
-- storage.foldername(name) splits the path, so [1] is the top folder and, for a
-- submission, [3] is the owning student's record id.

DROP POLICY IF EXISTS "Read assignment briefs"      ON storage.objects;
DROP POLICY IF EXISTS "Read submissions"            ON storage.objects;
DROP POLICY IF EXISTS "Staff write assignment-files" ON storage.objects;
DROP POLICY IF EXISTS "Students submit work"        ON storage.objects;
DROP POLICY IF EXISTS "Staff delete assignment-files" ON storage.objects;

-- Briefs: any signed-in user. Students need to open the assignment they've been set.
CREATE POLICY "Read assignment briefs"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'assignment-files'
    AND (storage.foldername(name))[1] = 'assignments'
  );

-- Submissions: staff see all; a student sees only their own work.
CREATE POLICY "Read submissions"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'assignment-files'
    AND (storage.foldername(name))[1] = 'submissions'
    AND (
      has_role(auth.uid(), 'admin'::app_role)
      OR has_role(auth.uid(), 'super_admin'::app_role)
      OR has_role(auth.uid(), 'hod'::app_role)
      OR has_role(auth.uid(), 'hoy'::app_role)
      OR has_role(auth.uid(), 'lecturer'::app_role)
      OR (storage.foldername(name))[3] IN (
           SELECT p.student_ref FROM public.profiles p WHERE p.user_id = auth.uid()
         )
    )
  );

-- Only staff upload briefs.
CREATE POLICY "Staff write assignment-files"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'assignment-files'
    AND (storage.foldername(name))[1] = 'assignments'
    AND (
      has_role(auth.uid(), 'admin'::app_role)
      OR has_role(auth.uid(), 'super_admin'::app_role)
      OR has_role(auth.uid(), 'hod'::app_role)
      OR has_role(auth.uid(), 'hoy'::app_role)
      OR has_role(auth.uid(), 'lecturer'::app_role)
    )
  );

-- A student may upload only into their own submission folder.
CREATE POLICY "Students submit work"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'assignment-files'
    AND (storage.foldername(name))[1] = 'submissions'
    AND (storage.foldername(name))[3] IN (
          SELECT p.student_ref FROM public.profiles p WHERE p.user_id = auth.uid()
        )
  );

-- Deleting an assignment removes its brief and every submission under it.
CREATE POLICY "Staff delete assignment-files"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'assignment-files'
    AND (
      has_role(auth.uid(), 'admin'::app_role)
      OR has_role(auth.uid(), 'super_admin'::app_role)
      OR has_role(auth.uid(), 'hod'::app_role)
      OR has_role(auth.uid(), 'hoy'::app_role)
      OR has_role(auth.uid(), 'lecturer'::app_role)
    )
  );


-- ── Verify ──────────────────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema='public' AND table_name='assignments' AND column_name='attachment_path') = 1 AS assignments_has_path,
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema='public' AND table_name='submissions' AND column_name='file_path') = 1      AS submissions_has_path,
  (SELECT public::text || ' / ' || coalesce((file_size_limit/1048576)::text || 'MB','no limit')
     FROM storage.buckets WHERE id='assignment-files')                                             AS bucket_public_and_limit,
  (SELECT count(*) FROM pg_policies
    WHERE schemaname='storage' AND tablename='objects'
      AND policyname IN ('Read assignment briefs','Read submissions','Staff write assignment-files',
                         'Students submit work','Staff delete assignment-files'))                  AS policies_created;
