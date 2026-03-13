CREATE TABLE IF NOT EXISTS rooms (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  type        text NOT NULL DEFAULT 'Classroom',
  capacity    integer NOT NULL DEFAULT 0,
  notes       text,
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read rooms"
  ON rooms FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated insert rooms"
  ON rooms FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated update rooms"
  ON rooms FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Authenticated delete rooms"
  ON rooms FOR DELETE TO authenticated USING (true);