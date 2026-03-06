
-- Create storage bucket for student photos
INSERT INTO storage.buckets (id, name, public) VALUES ('student-photos', 'student-photos', true);

-- Allow authenticated users to view all photos
CREATE POLICY "Authenticated can view student photos"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'student-photos');

-- Allow students to upload their own photo (path: {student_id}/photo.webp)
CREATE POLICY "Students can upload own photo"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'student-photos'
  AND (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'lecturer'::app_role)
    OR has_role(auth.uid(), 'student'::app_role)
  )
);

-- Allow students to update (upsert) their own photo
CREATE POLICY "Users can update student photos"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'student-photos'
  AND (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'lecturer'::app_role)
    OR has_role(auth.uid(), 'student'::app_role)
  )
);

-- Allow admins to delete photos
CREATE POLICY "Admins can delete student photos"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'student-photos'
  AND has_role(auth.uid(), 'admin'::app_role)
);
