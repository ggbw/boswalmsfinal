-- Store the transcript signatory's signature image (drawn or uploaded) as a
-- data URL on the singleton school_config row, alongside issuer name/position.
ALTER TABLE public.school_config ADD COLUMN IF NOT EXISTS transcript_signature TEXT;
