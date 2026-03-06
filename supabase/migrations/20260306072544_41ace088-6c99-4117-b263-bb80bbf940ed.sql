CREATE POLICY "Students can insert submissions"
ON public.submissions
FOR INSERT
TO authenticated
WITH CHECK (has_role(auth.uid(), 'student'::app_role));