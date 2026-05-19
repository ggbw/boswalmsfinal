-- Storage bucket for employee documents uploaded from HR → Documents.
-- Private bucket (signed URLs); replaces the previous "paste a URL" flow.

INSERT INTO storage.buckets (id, name, public)
  VALUES ('employee-docs', 'employee-docs', false)
  ON CONFLICT DO NOTHING;

-- Authenticated HR users can upload to and read from this bucket.
DROP POLICY IF EXISTS "HR upload employee-docs"   ON storage.objects;
DROP POLICY IF EXISTS "HR read employee-docs"     ON storage.objects;
DROP POLICY IF EXISTS "HR delete employee-docs"   ON storage.objects;

CREATE POLICY "HR upload employee-docs"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'employee-docs');

CREATE POLICY "HR read employee-docs"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'employee-docs');

CREATE POLICY "HR delete employee-docs"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'employee-docs');
