-- ============================================================================
-- Timetables become uploaded documents rather than hand-built slots
-- ============================================================================
-- The timetable is now a Word or Excel file that an admin uploads. It is
-- rendered read-only in the app, downloadable by everyone, and only an admin
-- can upload or delete one.
--
-- The old public.timetable table (65 slot rows) is NOT dropped. Nothing reads it
-- after this change, but deleting a year of scheduling data on the strength of a
-- feature swap would be irreversible — if the uploaded-document approach doesn't
-- suit, the rows are still there. Drop it deliberately later, not as a side
-- effect of this.
--
-- Idempotent: safe to run more than once.
-- ============================================================================


-- ── 1. The documents table ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.timetable_documents (
  id               text PRIMARY KEY,
  title            text NOT NULL,
  file_name        text NOT NULL,
  file_path        text NOT NULL,   -- path in the `timetables` bucket
  file_size        bigint,
  mime_type        text,
  academic_year    integer,
  semester         integer,
  notes            text,
  uploaded_by      uuid,            -- auth user id
  uploaded_by_name text,            -- captured at upload; survives account changes
  uploaded_at      timestamptz NOT NULL DEFAULT now()
);

-- The list is always "newest first"; this keeps that cheap as terms accumulate.
CREATE INDEX IF NOT EXISTS timetable_documents_uploaded_at_idx
  ON public.timetable_documents (uploaded_at DESC);

ALTER TABLE public.timetable_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Everyone reads timetable documents" ON public.timetable_documents;
DROP POLICY IF EXISTS "Admins manage timetable documents"  ON public.timetable_documents;

-- Students and staff alike need to see the timetable.
CREATE POLICY "Everyone reads timetable documents"
  ON public.timetable_documents FOR SELECT TO authenticated
  USING (true);

-- Upload and delete are admin-only, as specified.
CREATE POLICY "Admins manage timetable documents"
  ON public.timetable_documents FOR ALL TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'super_admin'::app_role)
  )
  WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'super_admin'::app_role)
  );


-- ── 2. The bucket ───────────────────────────────────────────────────────────
-- Private: reads go through a signed URL or an authenticated download, so a
-- timetable is not fetchable by anyone who happens to have the link.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('timetables', 'timetables', false, 10485760)   -- 10 MB
ON CONFLICT (id) DO UPDATE
  SET public = false, file_size_limit = 10485760;

-- No allowed_mime_types: browsers report Office content types inconsistently
-- (a .docx often arrives as application/octet-stream), so a MIME allow-list
-- would reject valid uploads. The app checks the extension instead.

DROP POLICY IF EXISTS "Everyone reads timetables"  ON storage.objects;
DROP POLICY IF EXISTS "Admins write timetables"    ON storage.objects;
DROP POLICY IF EXISTS "Admins delete timetables"   ON storage.objects;

CREATE POLICY "Everyone reads timetables"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'timetables');

CREATE POLICY "Admins write timetables"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'timetables'
    AND (
      has_role(auth.uid(), 'admin'::app_role)
      OR has_role(auth.uid(), 'super_admin'::app_role)
    )
  );

CREATE POLICY "Admins delete timetables"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'timetables'
    AND (
      has_role(auth.uid(), 'admin'::app_role)
      OR has_role(auth.uid(), 'super_admin'::app_role)
    )
  );


-- ── Verify ──────────────────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM information_schema.tables
    WHERE table_schema='public' AND table_name='timetable_documents') = 1        AS table_created,
  (SELECT count(*) FROM pg_policies
    WHERE schemaname='public' AND tablename='timetable_documents')               AS table_policies,
  (SELECT public::text || ' / ' || coalesce((file_size_limit/1048576)::text || 'MB','none')
     FROM storage.buckets WHERE id='timetables')                                 AS bucket,
  (SELECT count(*) FROM pg_policies
    WHERE schemaname='storage' AND tablename='objects'
      AND policyname IN ('Everyone reads timetables','Admins write timetables',
                         'Admins delete timetables'))                            AS bucket_policies,
  (SELECT count(*) FROM public.timetable)                                        AS old_slots_kept;
