-- Merge the two duplicate "Certificate in Culinary Arts" programmes into one,
-- and move "intake" from a single per-programme value to a per-application choice
-- so one programme can offer both the January and July intakes.
--
-- Decisions:
--   * Surviving programme: CERT2025 (it already owns the 3 classes).
--   * Merged NQF level: 5 (the Level-6 value was a data-entry mistake).
--   * CERT2025 offers both intakes: January (1) and July (7).
--   * The Level-5 record prog_1773994909406 (which holds the curriculum) is merged
--     into CERT2025 and then removed.

-- 1. New columns -------------------------------------------------------------
-- Offered intakes for a programme (months: 1 = January, 7 = July).
ALTER TABLE public.programmes
  ADD COLUMN IF NOT EXISTS intakes INTEGER[];

-- The intake a specific application is for (set at apply time).
ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS intake_month INTEGER;

-- 2. Move the curriculum onto the surviving programme ------------------------
-- Copy programme_modules rows from the Level-5 record to CERT2025, skipping any
-- (module, year, semester) slot CERT2025 already has.
INSERT INTO public.programme_modules (id, programme_id, module_id, year, semester)
SELECT
  'pm_cert2025_' || pm.module_id || '_' || pm.year || '_' || pm.semester,
  'CERT2025',
  pm.module_id,
  pm.year,
  pm.semester
FROM public.programme_modules pm
WHERE pm.programme_id = 'prog_1773994909406'
  AND NOT EXISTS (
    SELECT 1 FROM public.programme_modules e
    WHERE e.programme_id = 'CERT2025'
      AND e.module_id = pm.module_id
      AND e.year = pm.year
      AND e.semester = pm.semester
  );

-- 3. Re-point any stray references (none expected today, done for safety) ------
UPDATE public.classes      SET programme = 'CERT2025' WHERE programme = 'prog_1773994909406';
UPDATE public.students     SET programme = 'CERT2025' WHERE programme = 'prog_1773994909406';
UPDATE public.applications SET first_choice_programme  = 'CERT2025' WHERE first_choice_programme  = 'prog_1773994909406';
UPDATE public.applications SET second_choice_programme = 'CERT2025' WHERE second_choice_programme = 'prog_1773994909406';

-- 4. Configure the surviving programme ---------------------------------------
UPDATE public.programmes
  SET level = 5,
      intakes = ARRAY[1, 7],
      intake_month = 7
WHERE id = 'CERT2025';

-- 5. Backfill intakes for every other programme from its single intake_month --
UPDATE public.programmes
  SET intakes = ARRAY[COALESCE(intake_month, 7)]
WHERE intakes IS NULL;

-- 6. Remove the merged-away duplicate -----------------------------------------
DELETE FROM public.programme_modules WHERE programme_id = 'prog_1773994909406';
DELETE FROM public.programmes        WHERE id = 'prog_1773994909406';
