-- Rename modules to the Reubens-transcript spellings (Boswa feedback, 30 Oct 2026).
--
-- The live module names were the old "synopsis" spellings (double spaces, wrong
-- case/punctuation, "Providing"→"Provide", "Understanding"→"Understand", etc.),
-- so the printed transcript did not match the official template. The transcript
-- renders modules.name directly, so renaming the rows fixes the output with no
-- code change.
--
-- Keyed on module_id (the only safe key — the table has duplicate/look-alike
-- rows and code↔name mismatches). These are the exact ids the Diploma and
-- Certificate programmes link via programme_modules. Shared ids serve both
-- programmes. The old names are backed up in Claude memory
-- (old-module-names-pre-rename) for restore.
--
-- NOT renamed (left as-is): the three Diploma modules not on the transcript
-- (Hospitality Management, Introduction to Hot Kitchen/Savory, Introduction to
-- Pastry) and the Certificate's Food Production.
--
-- RUN ON boswa-live. Touches 25 rows, data only. Idempotent.

UPDATE public.modules m
SET name = v.new_name
FROM (VALUES
  ('mod1774682511894', 'Supervise and Monitor on Section'),
  ('mod_1776411933959', 'Awareness and Sustainability in the Hospitality Industry'),
  ('mod1774681892741',  'Contribute to Business Success'),
  ('mod_1780128913470', 'Contribute to Guest Experience'),
  ('mod_1781778731128', 'Cooking Methods, Techniques & Commodities (Baking, Roasting and Grilling)'),
  ('mod002',            'Cooking Methods, Techniques & Commodities (Boiling, Poaching and Steaming)'),
  ('mod_1780136264231', 'Cooking Methods, Techniques & Commodities (Deep and Shallow Frying)'),
  ('mod_1780136113888', 'Cooking Methods, Techniques & Commodities (Stewing and Braising)'),
  ('mod_1780128821496', 'Developing Progression Opportunities in the Culinary Industry'),
  ('mod003',            'Food Safety'),
  ('mod_1781777964135', 'Industrial Placement'),
  ('mod007',            'Meet Guest Requirements Through Menu Planning'),
  ('mod_1776499990689', 'Mise en Place'),
  ('mod_1780136170728', 'Monitoring and Supervision of Food Safety'),
  ('mod_1780128678802', 'Prepare and Finish Stocks, Soups and Sauces'),
  ('mod_1780136388430', 'Produce and Present advanced Main Course Dishes using Standardised Recipes'),
  ('mod_1780136325584', 'Produce and Present advanced Main Course Dishes using Standardised Recipes'),
  ('mod1774682677630',  'Professional Workplace Standards'),
  ('mod1774621573772',  'Provide Guest Service'),
  ('mod_1776349621432', 'Sustainability in Professional Kitchen'),
  ('mod_1780128463196', 'Understand Business Success'),
  ('mod_1776349484520', 'Understand Food Commodities'),
  ('mod1774682128965',  'Understand the Role of Self Development'),
  ('mod_1775139804703', 'Wines and Food'),
  ('mod_1780128413791', 'Introduction to the Hospitality Industry')
) AS v(id, new_name)
WHERE m.id = v.id;
