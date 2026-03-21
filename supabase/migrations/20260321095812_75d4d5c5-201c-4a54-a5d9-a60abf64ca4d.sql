CREATE TABLE module_notes (
  id TEXT PRIMARY KEY,
  module_id TEXT NOT NULL,
  title TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  uploaded_by TEXT NOT NULL,
  uploaded_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE module_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read module_notes"
  ON module_notes FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated insert module_notes"
  ON module_notes FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated update module_notes"
  ON module_notes FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Authenticated delete module_notes"
  ON module_notes FOR DELETE TO authenticated USING (true);