-- Allow students to delete their own photos from storage
CREATE POLICY "Students can delete own photos"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'student-photos'
  AND has_role(auth.uid(), 'student'::app_role)
);

-- Allow lecturers to delete assignments they created
CREATE POLICY "Lecturers can delete assignments"
ON public.assignments FOR DELETE
TO authenticated
USING (has_role(auth.uid(), 'lecturer'::app_role));

-- Allow lecturers to delete submissions (for cascade on assignment delete)
CREATE POLICY "Lecturers can delete submissions"
ON public.submissions FOR DELETE
TO authenticated
USING (has_role(auth.uid(), 'lecturer'::app_role));

-- Allow lecturers to update submissions (for grading)
CREATE POLICY "Lecturers can update submissions"
ON public.submissions FOR UPDATE
TO authenticated
USING (has_role(auth.uid(), 'lecturer'::app_role));