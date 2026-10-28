-- Grading-system switch for the super-admin.
--
-- Lets a super-admin flip the WHOLE system between the new Boswa award scales
-- (Diploma/Certificate, chosen by programme level) and the old legacy letter
-- scale (A, A-, B+ … F on 4.0). This is a DISPLAY switch only: it changes how
-- grades are rendered from the existing marks and alters NO result rows.
--
-- RUN THIS ON boswa-live (dwavbotriuabrvhqeshm) MANUALLY. Additive and safe; the
-- app defaults to 'boswa' until the column exists, so reading is fine before it
-- is run — only SAVING the toggle needs the column.

ALTER TABLE public.school_config
  ADD COLUMN IF NOT EXISTS grading_system text NOT NULL DEFAULT 'boswa';

-- Optional: keep it to the two known values.
ALTER TABLE public.school_config
  DROP CONSTRAINT IF EXISTS school_config_grading_system_check;
ALTER TABLE public.school_config
  ADD CONSTRAINT school_config_grading_system_check
  CHECK (grading_system IN ('boswa', 'legacy'));
