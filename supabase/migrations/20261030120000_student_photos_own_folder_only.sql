-- D2 — a student must see ONLY their own photos, never another student's.
--
-- Today the student-photos bucket has ONE read policy, "Authenticated can view
-- student photos", whose condition is just `bucket_id = 'student-photos'`. That
-- means ANY signed-in user — including a student — can read ANY student's photo
-- through a signed URL. The UI hides other students, but the data layer does
-- not enforce it, so a student using the API/console could fetch another
-- student's photo. This closes that gap.
--
-- New rule:
--   • Staff (any profile WITHOUT a student_ref — admin, lecturer, HOD, HOA,
--     principal, etc.) keep full read, exactly as before.
--   • A student (profile WITH a student_ref) may read only objects under their
--     OWN folder, i.e. the first path segment equals their student_ref.
--
-- Folder layout is `{students.id}/photo_*.webp`, and profiles.student_ref holds
-- that same students.id (the primary key), so the viewer's own folder is their
-- student_ref. This is role-enum-free on purpose (keys on the presence of
-- student_ref), so it can't break on an enum value that doesn't exist here.
--
-- RUN ON boswa-live. Changes NO files and NO student data — only the read
-- policy. Run the PRE-CHECK first, then the policy, then test as a student.
-- Idempotent.

-- ── PRE-CHECK (run alone first; it only reads) ──────────────────────────────
-- Confirms the mapping this policy relies on: a student profile's student_ref
-- equals the students.id used as the photo folder name. Expect the sampled
-- rows to line up (student_ref = id) before you apply the policy below.
--   select p.student_ref, s.id as students_id, s.student_id as student_number
--   from public.profiles p
--   join public.students s on s.id = p.student_ref
--   where p.student_ref is not null
--   limit 10;

-- ── Apply ───────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Authenticated can view student photos" ON storage.objects;

CREATE POLICY "Staff read all student photos; students read own"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'student-photos'
  AND (
    -- The viewer is NOT a student (no student_ref) → staff, full read.
    NOT EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid() AND p.student_ref IS NOT NULL
    )
    -- OR the object is in the viewer's own student folder.
    OR (storage.foldername(name))[1] = (
      SELECT p.student_ref::text FROM public.profiles p
      WHERE p.user_id = auth.uid()
    )
  )
);

-- ── Verify (run after applying) ─────────────────────────────────────────────
-- Expect exactly the two intended SELECT policies for this bucket (this one and
-- any super_admin one), and NONE whose condition is only the bucket id.
--   select policyname, qual
--   from pg_policies
--   where schemaname = 'storage' and tablename = 'objects' and cmd = 'SELECT'
--     and qual like '%student-photos%';
--
-- Then test in the app: sign in as a STUDENT → they see their own photo on the
-- profile; they cannot load another student's. Sign in as a lecturer/admin →
-- they still see all photos.
