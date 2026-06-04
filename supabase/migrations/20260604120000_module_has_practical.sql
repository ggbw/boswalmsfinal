-- Add a `has_practical` flag to modules.
--
-- Modules WITH a practical keep the existing scheme:
--   Coursework 40% + Practical 20% + Final Exam 40%
-- Modules WITHOUT a practical use:
--   Coursework 60% + Final Exam 40%
--
-- The flag is editable per-module from the configuration screens; this
-- migration just seeds sensible starting values per the faculty's list.

ALTER TABLE public.modules
  ADD COLUMN IF NOT EXISTS has_practical boolean NOT NULL DEFAULT true;

-- Per the faculty: only the listed culinary modules retain practicals.
-- Everything else becomes coursework + final exam only.
UPDATE public.modules SET has_practical = false;

UPDATE public.modules SET has_practical = true
WHERE name ILIKE '%food commodit%'   -- Understanding Food Commodities
   OR name ILIKE '%molecular%'       -- Molecular Gastronomy
   OR name ILIKE '%pastry%'          -- Introduction to Pastry
   OR name ILIKE '%dough%'           -- Introduction to Dough
   OR name ILIKE '%hot kitchen%'     -- Introduction to Hot Kitchen
   OR name ILIKE '%dessert%';        -- Hot and Cold Desserts
