-- Fix the "self" branch of the students SELECT policy.
--
-- The previous policy (20260518092549) compared the wrong columns:
--   p.student_id = students.id   AND   p.student_ref = students.student_id
-- But provisioning (provision-student-accounts) populates profiles the other
-- way around:
--   profiles.student_id  = students.student_id  (the student NUMBER)
--   profiles.student_ref = students.id          (the primary key)
-- So the self-check never matched and a logged-in student could not read their
-- own record. With students empty, every student-portal page that starts from
-- `db.students.find(... === currentUser.studentId)` showed nothing.
--
-- This recreates the policy with the columns matched correctly.

DROP POLICY IF EXISTS "Staff and self can view students" ON public.students;

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
      AND (p.student_id = public.students.student_id OR p.student_ref = public.students.id)
  )
);
