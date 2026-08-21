-- ============================================================================
-- Lecturers can post a LINK as a module note, not only a file
-- ============================================================================
-- A note is currently always an uploaded file: file_name and file_path are both
-- NOT NULL. Plenty of teaching material is a URL — a video, a recipe site, a
-- shared document — and uploading a placeholder file to carry a link is worse
-- than storing the link.
--
-- Adds `link_url`. A note is now EITHER a file or a link:
--   • file  → file_path set, link_url null
--   • link  → link_url set, file_path holds '' (the column is NOT NULL and
--             existing rows rely on that, so it is not being relaxed)
--
-- file_name is reused as the link's display label, so the list needs no special
-- case to show a title.
--
-- Idempotent: safe to run more than once.
-- ============================================================================

ALTER TABLE public.module_notes
  ADD COLUMN IF NOT EXISTS link_url TEXT;

COMMENT ON COLUMN public.module_notes.link_url IS
  'External URL when this note is a link rather than an uploaded file. Mutually exclusive with a real file_path.';

-- A note must be one or the other — never both, never neither. Without this a
-- row with no file and no link would render as a broken download.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.module_notes'::regclass
       AND conname = 'module_notes_file_or_link'
  ) THEN
    ALTER TABLE public.module_notes
      ADD CONSTRAINT module_notes_file_or_link
      CHECK (
        (nullif(trim(link_url), '') IS NOT NULL AND coalesce(trim(file_path), '') = '')
        OR
        (nullif(trim(link_url), '') IS NULL AND coalesce(trim(file_path), '') <> '')
      );
  END IF;
END $$;


-- ── Verify ──────────────────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema='public' AND table_name='module_notes' AND column_name='link_url') = 1 AS link_column_added,
  (SELECT count(*) FROM pg_constraint
    WHERE conrelid='public.module_notes'::regclass AND conname='module_notes_file_or_link') = 1 AS constraint_added,
  (SELECT count(*) FROM public.module_notes)                     AS existing_notes,
  (SELECT count(*) FROM public.module_notes WHERE link_url IS NOT NULL) AS link_notes;
