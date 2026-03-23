CREATE POLICY "admins_read_applications" ON applications
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

CREATE POLICY "admins_read_applicants" ON applicants
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

CREATE POLICY "applicants_read_own" ON applications
  FOR SELECT USING (
    applicant_id IN (
      SELECT id FROM applicants WHERE user_id = auth.uid()
    )
  );