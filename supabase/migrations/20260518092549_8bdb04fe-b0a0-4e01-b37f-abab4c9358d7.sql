DROP POLICY IF EXISTS "Authenticated can view students" ON public.students;

CREATE POLICY "Staff and self can view students"
ON public.students
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'super_admin'::app_role)
  OR has_role(auth.uid(), 'hod'::app_role)
  OR has_role(auth.uid(), 'hoy'::app_role)
  OR has_role(auth.uid(), 'lecturer'::app_role)
  OR EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.user_id = auth.uid()
      AND (p.student_id = public.students.id OR p.student_ref = public.students.student_id)
  )
);