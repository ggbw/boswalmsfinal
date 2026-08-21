-- ============================================================================
-- Make student-photos private
-- ============================================================================
-- This bucket has been public since it was created (20260306070101). A public
-- bucket serves permanent, unauthenticated URLs — anyone holding a link can
-- fetch the file forever, with no login and no trace. For photographs of
-- students, several of whom are minors, that is the wrong default.
--
-- It was left open deliberately in 20260812000000_close_open_data, because
-- ProfilePage and PhotoGalleryPage read it with getPublicUrl() and closing the
-- bucket without changing that code would have blanked every photo in the app.
-- Both now use createSignedUrl()/createSignedUrls() via src/lib/storage.ts, so
-- the bucket can be closed.
--
-- ORDER MATTERS: publish the frontend BEFORE running this. The new code works
-- against a public bucket (a signed URL is valid either way); the OLD code does
-- not work against a private one. Publishing first means neither state is broken.
--
-- Reads still work because "Authenticated can view student photos" already
-- exists (SELECT on this bucket for any signed-in user) — that is what signed
-- URLs are checked against. It is left exactly as it is: this migration changes
-- who can reach the files WITHOUT a session, not who can see them with one.
--
-- A size limit is also set. The app compresses to webp before upload, so 5 MB
-- is generous; nothing enforced a limit before.
--
-- No data is touched — one row in the bucket registry. The image files
-- themselves are not read, moved or modified.
--
-- Idempotent: safe to run more than once.
-- ============================================================================

UPDATE storage.buckets
   SET public          = false,
       file_size_limit = 5242880   -- 5 MB
 WHERE id = 'student-photos';


-- ── Verify ──────────────────────────────────────────────────────────────────
-- Expect: no public buckets left, and the student-photos SELECT policy present.
SELECT
  (SELECT coalesce(string_agg(id, ', ' ORDER BY id), 'none')
     FROM storage.buckets WHERE public)                                  AS still_public,
  (SELECT public::text || ' / ' || coalesce((file_size_limit/1048576)::text || 'MB', 'no limit')
     FROM storage.buckets WHERE id = 'student-photos')                   AS student_photos,
  (SELECT count(*) FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND cmd = 'SELECT' AND qual LIKE '%student-photos%')               AS read_policies;
