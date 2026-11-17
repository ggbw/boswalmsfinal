-- D2 follow-up — a student may only UPLOAD, REPLACE or DELETE photos in their
-- OWN folder, and a student account is never mistaken for staff.
--
-- 20261030120000 closed READING other students' photos, but the write policies
-- from 6 March were never touched:
--   • "Students can upload own photo"  — INSERT for admin/lecturer/student, ANY folder
--   • "Users can update student photos" — UPDATE for admin/lecturer/student, ANY folder
--   • "Students can delete own photos"  — DELETE for student, ANY folder
-- So any signed-in student could overwrite or delete any other student's photo
-- through the API. The read policy also treated "no student_ref" as staff, so a
-- Student-role account that was never linked to a student record could read
-- every photo.
--
-- New rules (folder layout is `{students.id}/…`, and profiles.student_ref holds
-- that students.id — the app uploads to `${currentUser.studentRef}/…`):
--   • Admin, super_admin and lecturer: upload / replace / delete anywhere
--     (this matches the Photo Gallery's `canManage`).
--   • Student: upload / replace / delete ONLY inside their own folder.
--   • Reading: staff read all; anyone holding the student role OR a student_ref
--     reads only their own folder. An unlinked student account reads nothing.
--
-- RUN ON boswa-live by hand (pushing code does not run migrations). Changes no
-- files and no data — policies only. Idempotent.

-- ── Writes ─────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Students can upload own photo"   ON storage.objects;
DROP POLICY IF EXISTS "Users can update student photos" ON storage.objects;
DROP POLICY IF EXISTS "Students can delete own photos"  ON storage.objects;
DROP POLICY IF EXISTS "Staff upload student photos; students own folder"  ON storage.objects;
DROP POLICY IF EXISTS "Staff update student photos; students own folder"  ON storage.objects;
DROP POLICY IF EXISTS "Lecturers delete student photos; students own folder" ON storage.objects;

CREATE POLICY "Staff upload student photos; students own folder"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'student-photos'
  AND (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'lecturer'::app_role)
    OR (
      has_role(auth.uid(), 'student'::app_role)
      AND (storage.foldername(name))[1] = (
        SELECT p.student_ref::text FROM public.profiles p WHERE p.user_id = auth.uid()
      )
    )
  )
);

CREATE POLICY "Staff update student photos; students own folder"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'student-photos'
  AND (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'lecturer'::app_role)
    OR (
      has_role(auth.uid(), 'student'::app_role)
      AND (storage.foldername(name))[1] = (
        SELECT p.student_ref::text FROM public.profiles p WHERE p.user_id = auth.uid()
      )
    )
  )
)
WITH CHECK (
  bucket_id = 'student-photos'
  AND (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'lecturer'::app_role)
    OR (
      has_role(auth.uid(), 'student'::app_role)
      AND (storage.foldername(name))[1] = (
        SELECT p.student_ref::text FROM public.profiles p WHERE p.user_id = auth.uid()
      )
    )
  )
);

-- "Admins can delete student photos" (admin) and "Super admins delete student
-- photos" stay as they are. This adds lecturers (the gallery already offers
-- them Delete) and students for their own folder only.
CREATE POLICY "Lecturers delete student photos; students own folder"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'student-photos'
  AND (
    has_role(auth.uid(), 'lecturer'::app_role)
    OR (
      has_role(auth.uid(), 'student'::app_role)
      AND (storage.foldername(name))[1] = (
        SELECT p.student_ref::text FROM public.profiles p WHERE p.user_id = auth.uid()
      )
    )
  )
);

-- ── Read: a student-role account without a student_ref is NOT staff ──────────
DROP POLICY IF EXISTS "Staff read all student photos; students read own" ON storage.objects;

CREATE POLICY "Staff read all student photos; students read own"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'student-photos'
  AND (
    -- Staff: neither the student role nor a linked student record.
    (
      NOT has_role(auth.uid(), 'student'::app_role)
      AND NOT EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.user_id = auth.uid() AND p.student_ref IS NOT NULL
      )
    )
    -- Students: their own folder only.
    OR (storage.foldername(name))[1] = (
      SELECT p.student_ref::text FROM public.profiles p WHERE p.user_id = auth.uid()
    )
  )
);

-- ── Verify (run after applying) ─────────────────────────────────────────────
--   select policyname, cmd from pg_policies
--   where schemaname = 'storage' and tablename = 'objects'
--     and (qual like '%student-photos%' or with_check like '%student-photos%')
--   order by cmd, policyname;
-- Expect: no policy left that lets 'student' write without the foldername check.
-- Then in the app: as a student, change your profile photo (works); as a
-- lecturer/admin, upload and delete in the gallery (works).
