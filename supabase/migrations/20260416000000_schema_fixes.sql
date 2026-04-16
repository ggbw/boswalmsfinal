-- ── 1. lecturer_modules ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lecturer_modules (
  id           TEXT PRIMARY KEY,
  lecturer_id  TEXT NOT NULL,
  module_id    TEXT NOT NULL,
  class_id     TEXT NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (lecturer_id, module_id, class_id)
);
CREATE INDEX IF NOT EXISTS idx_lm_class    ON lecturer_modules (class_id);
CREATE INDEX IF NOT EXISTS idx_lm_lecturer ON lecturer_modules (lecturer_id);
CREATE INDEX IF NOT EXISTS idx_lm_module   ON lecturer_modules (module_id);
ALTER TABLE lecturer_modules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all for authenticated" ON lecturer_modules;
CREATE POLICY "Allow all for authenticated" ON lecturer_modules FOR ALL USING (true);

-- ── 2. programmes.intake_month ─────────────────────────────────────────────────
ALTER TABLE programmes ADD COLUMN IF NOT EXISTS intake_month INTEGER DEFAULT 7;

-- ── 3. timetable: date + session_id ───────────────────────────────────────────
-- date: optional specific calendar date for a one-off or dated slot (e.g. '2026-04-17')
-- session_id: shared across rows that represent the same physical session (multi-class slots)
ALTER TABLE timetable ADD COLUMN IF NOT EXISTS date TEXT;
ALTER TABLE timetable ADD COLUMN IF NOT EXISTS session_id TEXT;
