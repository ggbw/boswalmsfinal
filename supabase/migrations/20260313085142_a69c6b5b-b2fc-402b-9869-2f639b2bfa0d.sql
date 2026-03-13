
-- Allow anyone (including unauthenticated) to read programmes
CREATE POLICY "Public can read programmes"
  ON programmes FOR SELECT
  USING (true);

-- Allow anyone to read modules
CREATE POLICY "Public can read modules"
  ON modules FOR SELECT
  USING (true);

-- Allow anyone to read module_classes
CREATE POLICY "Public can read module_classes"
  ON module_classes FOR SELECT
  USING (true);

-- Allow anyone to read classes
CREATE POLICY "Public can read classes"
  ON classes FOR SELECT
  USING (true);
