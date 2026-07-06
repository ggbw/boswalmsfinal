-- ============================================================================
-- Twice-per-lesson, per-module class attendance
-- ============================================================================
-- Each lesson can now be registered TWICE:
--   • 'start' register — taken when the lesson starts (Present / Absent / Late)
--   • 'end'   register — taken when the lesson ends   (Present / Absent)
-- Attendance is also scoped per MODULE, so two different modules on the same day
-- are independent registers instead of overwriting one another.
--
-- Written idempotently (IF [NOT] EXISTS / IF EXISTS) because the live schema has
-- drifted from the migration history (module_id was added out-of-band), so this
-- must be safe to run whatever state the table is currently in.

-- 1. Columns ----------------------------------------------------------------
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS module_id TEXT;
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS session   TEXT NOT NULL DEFAULT 'start';

-- 2. Normalise module_id so it can participate in the unique key -------------
--    (Postgres treats NULLs as distinct, which would let duplicate rows slip
--     past a unique index — so empty-string them instead.)
UPDATE public.attendance SET module_id = '' WHERE module_id IS NULL;
ALTER TABLE public.attendance ALTER COLUMN module_id SET DEFAULT '';
ALTER TABLE public.attendance ALTER COLUMN module_id SET NOT NULL;

-- 3. Replace the old one-row-per-day uniqueness ------------------------------
--    Old: UNIQUE (student_id, class_id, date) — only one register per day and
--    module-blind. It MUST be dropped, or the start + end registers (which share
--    student/class/date) collide. The prod schema has drifted, so we can't rely
--    on the auto-generated name — drop by whatever name it actually has by
--    matching the exact column set (student_id, class_id, date).
DO $$
DECLARE
  con   text;
  idx   text;
BEGIN
  -- Any UNIQUE/PK constraint on exactly (student_id, class_id, date)
  FOR con IN
    SELECT c.conname
    FROM pg_constraint c
    WHERE c.conrelid = 'public.attendance'::regclass
      AND c.contype IN ('u', 'p')
      AND (
        SELECT array_agg(a.attname ORDER BY a.attname)
        FROM unnest(c.conkey) k
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k
      ) = ARRAY['class_id','date','student_id']
  LOOP
    EXECUTE format('ALTER TABLE public.attendance DROP CONSTRAINT %I', con);
  END LOOP;

  -- Any standalone UNIQUE index on the same three columns (no backing constraint)
  FOR idx IN
    SELECT i.indexrelid::regclass::text
    FROM pg_index i
    WHERE i.indrelid = 'public.attendance'::regclass
      AND i.indisunique
      AND NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conindid = i.indexrelid)
      AND (
        SELECT array_agg(a.attname ORDER BY a.attname)
        FROM unnest(i.indkey) k
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k
      ) = ARRAY['class_id','date','student_id']
  LOOP
    EXECUTE format('DROP INDEX %s', idx);
  END LOOP;
END $$;

-- New: one row per student, class, module, date AND register (start/end).
CREATE UNIQUE INDEX IF NOT EXISTS attendance_unique_register
  ON public.attendance (student_id, class_id, module_id, date, session);
