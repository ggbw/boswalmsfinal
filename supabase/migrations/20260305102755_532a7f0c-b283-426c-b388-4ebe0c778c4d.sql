
-- Add national_id to students
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS national_id text;

-- Add submission_type to assignments (softcopy or hardcopy)
ALTER TABLE public.assignments ADD COLUMN IF NOT EXISTS submission_type text DEFAULT 'softcopy';

-- Add created_by to exams (to track which lecturer created it)
ALTER TABLE public.exams ADD COLUMN IF NOT EXISTS created_by text;

-- Add created_by to assignments (to track which lecturer created it)
ALTER TABLE public.assignments ADD COLUMN IF NOT EXISTS created_by text;
