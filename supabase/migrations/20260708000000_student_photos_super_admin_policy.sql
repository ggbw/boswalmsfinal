-- The student-photos bucket policies were written on 2026-03-06, before the
-- `super_admin` role existed. They grant INSERT/UPDATE to admin/lecturer/student
-- and DELETE to admin only — so a super_admin can VIEW photos but cannot upload,
-- update or delete them. Renaming a gallery folder issues Storage .move() calls
-- (which need update + delete on the object); RLS blocks them and Supabase
-- surfaces the failure as "Rename failed: Object not found".
--
-- Grant super_admin the same manage rights the app's `canManage`
-- (admin/super_admin/lecturer) already assumes for this bucket.

DROP POLICY IF EXISTS "Super admins insert student photos" ON storage.objects;
DROP POLICY IF EXISTS "Super admins update student photos" ON storage.objects;
DROP POLICY IF EXISTS "Super admins delete student photos" ON storage.objects;

CREATE POLICY "Super admins insert student photos"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'student-photos'
  AND has_role(auth.uid(), 'super_admin'::app_role)
);

CREATE POLICY "Super admins update student photos"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'student-photos'
  AND has_role(auth.uid(), 'super_admin'::app_role)
)
WITH CHECK (
  bucket_id = 'student-photos'
  AND has_role(auth.uid(), 'super_admin'::app_role)
);

CREATE POLICY "Super admins delete student photos"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'student-photos'
  AND has_role(auth.uid(), 'super_admin'::app_role)
);
