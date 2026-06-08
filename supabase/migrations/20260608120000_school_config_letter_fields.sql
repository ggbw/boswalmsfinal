-- Add configurable offer/welcome letter fields to school_config.
--
-- These columns are read by the applicant portal (offer & welcome letters)
-- and written by the Admissions "Letter Settings" panel. They existed in the
-- application code but were never added to the database, so the settings save
-- failed and welcome letters always printed "TBC" dates with default
-- signatories. This migration adds them. All columns are nullable; the app
-- falls back to sensible defaults when they are empty.

ALTER TABLE public.school_config
  -- Offer letter
  ADD COLUMN IF NOT EXISTS offer_letter_signatory        TEXT,
  ADD COLUMN IF NOT EXISTS offer_letter_signatory_title  TEXT,
  ADD COLUMN IF NOT EXISTS offer_letter_signature_url    TEXT,
  ADD COLUMN IF NOT EXISTS letter_date                   DATE,
  -- Welcome letter signatory
  ADD COLUMN IF NOT EXISTS welcome_letter_signatory       TEXT,
  ADD COLUMN IF NOT EXISTS welcome_letter_signatory_title TEXT,
  ADD COLUMN IF NOT EXISTS welcome_letter_signature_url   TEXT,
  -- Welcome letter key dates
  ADD COLUMN IF NOT EXISTS wl_uniform_open   DATE,
  ADD COLUMN IF NOT EXISTS wl_uniform_close  DATE,
  ADD COLUMN IF NOT EXISTS wl_reg_start      DATE,
  ADD COLUMN IF NOT EXISTS wl_reg_end        DATE,
  ADD COLUMN IF NOT EXISTS wl_induction      DATE,
  ADD COLUMN IF NOT EXISTS wl_classes_start  DATE;
