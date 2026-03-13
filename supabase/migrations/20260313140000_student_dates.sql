ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS enrolment_date DATE,
  ADD COLUMN IF NOT EXISTS completion_date DATE;
