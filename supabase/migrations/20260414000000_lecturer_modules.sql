-- lecturer_modules: stores which lecturer teaches which module in which class
-- Replaces the old "class.lecturer" single-lecturer-per-class model.

CREATE TABLE IF NOT EXISTS lecturer_modules (
  id          TEXT PRIMARY KEY,
  lecturer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  module_id   TEXT NOT NULL,
  class_id    TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (lecturer_id, module_id, class_id)
);

-- Index for fast lookups by class or lecturer
CREATE INDEX IF NOT EXISTS idx_lm_class    ON lecturer_modules (class_id);
CREATE INDEX IF NOT EXISTS idx_lm_lecturer ON lecturer_modules (lecturer_id);
CREATE INDEX IF NOT EXISTS idx_lm_module   ON lecturer_modules (module_id);

-- Enable Row Level Security (open for now — tighten later if needed)
ALTER TABLE lecturer_modules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for authenticated" ON lecturer_modules
  FOR ALL USING (true);
