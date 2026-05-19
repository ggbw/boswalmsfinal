-- Adds optional Saturday-specific work hours to attendance_settings.
-- saturday_enabled = false → Saturday is treated as a non-workday (no late check)
-- saturday_enabled = true  → Saturday late-detection uses saturday_work_start_time
--                            (falls back to weekday work_start_time when NULL).

ALTER TABLE public.attendance_settings
  ADD COLUMN IF NOT EXISTS saturday_enabled         BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS saturday_work_start_time TIME    NULL,
  ADD COLUMN IF NOT EXISTS saturday_grace_minutes   INT     NULL;
