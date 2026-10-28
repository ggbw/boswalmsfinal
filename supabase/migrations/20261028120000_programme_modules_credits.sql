-- Credits per module, per programme.
--
-- The same module carries different credits on different programmes (e.g.
-- BSCITH101 "Introduction to the Hospitality Industry" is 5 credits on the
-- Diploma but 6 on the Certificate), so credits belong on programme_modules
-- (programme + module), not on modules. Source: the Credits column of the two
-- official transcript templates (Reubens Transcript.DOCX — Diploma, Level 6,
-- total 360; Atang Thako.DOCX — Certificate, Level 5, total 132).
--
-- RUN THIS ON boswa-live (dwavbotriuabrvhqeshm) MANUALLY. It is additive and
-- changes NO result rows. Review the programme-matching WHERE clauses against
-- your real programme rows before running the seed UPDATEs — this file matches
-- programmes by level/name because programme ids differ per environment.

-- 1. Schema: add the column (nullable; the app falls back to 10 when null).
ALTER TABLE public.programme_modules
  ADD COLUMN IF NOT EXISTS credits integer;

-- 2. Seed from the templates. Each UPDATE matches ONE programme (by level, with
--    a name fallback) and sets credits by module code. Adjust the programme
--    predicate if your levels are not set.

-- 2a. DIPLOMA in Culinary Arts (Level 6) — totals 360.
UPDATE public.programme_modules pm
SET credits = c.credits
FROM public.modules m,
     public.programmes p,
     (VALUES
        ('BSCITH101', 5), ('BSCUBS102', 8),  ('BSCPGS103', 8),  ('BSCASHI104', 10),
        ('BSCPWS105', 8), ('BSCUFC114', 10), ('BSCURSD106', 8), ('BSCFS107', 10),
        ('BSCMRMP108', 10), ('BSCMP109', 8), ('BSCCBS203', 10), ('BSCSPK205', 10),
        ('BSCCTC1110', 15), ('BSCCTC2111', 15), ('BSCDPCI201', 10), ('BSCSMS202', 10),
        ('BSCCGE204', 10), ('BSCCTC3112', 15), ('BSCCTC4113', 15), ('BSCMSFS206', 10),
        ('BSCPFSS207', 25), ('BSCWF200', 20), ('BSCPPMC1208', 25), ('BSCPPMC2209', 25),
        ('BSCIP209', 60)
     ) AS c(code, credits)
WHERE pm.module_id = m.id
  AND pm.programme_id = p.id
  AND m.code = c.code
  AND (p.level = 6 OR p.name ILIKE '%Diploma%');

-- 2b. CERTIFICATE in Culinary Arts (Level 5) — totals 132.
UPDATE public.programme_modules pm
SET credits = c.credits
FROM public.modules m,
     public.programmes p,
     (VALUES
        ('BSCITH101', 6), ('BSCUBS102', 8),  ('BSCPGS103', 8),  ('BSCASHI104', 10),
        ('BSCPWS105', 8), ('BSCURSD106', 8), ('BSCFS107', 10),  ('BSCMRMP108', 10),
        ('BSCCBS203', 10), ('BSCSPK205', 10), ('BSCFP114', 44)
     ) AS c(code, credits)
WHERE pm.module_id = m.id
  AND pm.programme_id = p.id
  AND m.code = c.code
  AND (p.level = 5 OR p.name ILIKE '%Certificate%');

-- 3. After running this, add `credits` to the programme_modules SELECT in
--    src/hooks/useDbData.tsx (line ~92) so the app loads the column:
--      .select("programme_id,module_id,year,semester,credits")
--    The transcript already reads pm.credits and falls back to 10 until then.
