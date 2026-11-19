-- Coursework slots per module (UAT retest 18 Nov 2026, correction 1 / M1).
--
-- The academic office weights coursework as equal SLOTS — Test 1, Test 2,
-- Individual Assignment, Group Assignment — 15% each of a theory module (10%
-- each of a practical one). A slot with no mark yet counts as 0 (retest Figure
-- 13: 79, 45, 66, no group assignment, final 73 → 58). The app now computes it
-- that way, with 4 slots by default. This column lets a module that is
-- designed with a different number of coursework assessments say so.
--
-- RUN ON boswa-live. Adds one nullable column; changes no data. Idempotent.
-- The app works before and after this is run (NULL / missing = 4).

ALTER TABLE public.modules
  ADD COLUMN IF NOT EXISTS coursework_items integer
  CHECK (coursework_items IS NULL OR coursework_items BETWEEN 1 AND 20);

COMMENT ON COLUMN public.modules.coursework_items IS
  'Number of coursework assessments the module is designed to have (each an equal share of coursework; unmarked = 0). NULL = 4.';

-- Verify:
--   select column_name, data_type from information_schema.columns
--   where table_schema = 'public' and table_name = 'modules' and column_name = 'coursework_items';
