CREATE TABLE IF NOT EXISTS assessment_marks (
  id              text PRIMARY KEY,
  student_id      text NOT NULL,
  assessment_id   text NOT NULL,
  assessment_type text NOT NULL,
  class_id        text,
  module_id       text,
  score           numeric NOT NULL DEFAULT 0,
  created_at      timestamptz DEFAULT now(),
  UNIQUE (student_id, assessment_id)
);

ALTER TABLE assessment_marks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read assessment_marks"
  ON assessment_marks FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated write assessment_marks"
  ON assessment_marks FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated update assessment_marks"
  ON assessment_marks FOR UPDATE TO authenticated USING (true);