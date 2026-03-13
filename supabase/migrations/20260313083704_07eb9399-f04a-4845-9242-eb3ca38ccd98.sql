
-- Applicant profiles
CREATE TABLE IF NOT EXISTS applicants (
  id text PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id),
  name text, email text, dob date, gender text,
  nationality text, national_id text, mobile text,
  guardian_name text, guardian_mobile text, guardian_email text,
  id_document_url text, qualification_url text,
  created_at timestamptz DEFAULT now()
);

-- Applications
CREATE TABLE IF NOT EXISTS applications (
  id text PRIMARY KEY,
  applicant_id text REFERENCES applicants(id),
  first_choice_programme text, second_choice_programme text,
  status text DEFAULT 'submitted',
  submitted_at timestamptz DEFAULT now(),
  reviewed_at timestamptz, decided_at timestamptz, enrolled_at timestamptz,
  rejection_reason text,
  sponsor_type text, sponsor_name text, sponsor_doc_url text
);

-- Enable RLS
ALTER TABLE applicants ENABLE ROW LEVEL SECURITY;
ALTER TABLE applications ENABLE ROW LEVEL SECURITY;

-- RLS for applicants
CREATE POLICY "Admins can manage applicants" ON applicants FOR ALL USING (has_role(auth.uid(), 'admin'));
CREATE POLICY "Authenticated can view applicants" ON applicants FOR SELECT TO authenticated USING (true);
CREATE POLICY "Anon can insert applicants" ON applicants FOR INSERT TO anon WITH CHECK (true);

-- RLS for applications
CREATE POLICY "Admins can manage applications" ON applications FOR ALL USING (has_role(auth.uid(), 'admin'));
CREATE POLICY "Authenticated can view applications" ON applications FOR SELECT TO authenticated USING (true);
CREATE POLICY "Anon can insert applications" ON applications FOR INSERT TO anon WITH CHECK (true);

-- Storage bucket for documents
INSERT INTO storage.buckets (id, name, public) VALUES ('applicant-docs', 'applicant-docs', false)
ON CONFLICT DO NOTHING;

-- Allow applicants to upload their own docs
CREATE POLICY "Applicants upload docs" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'applicant-docs');

CREATE POLICY "Authenticated users read docs" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'applicant-docs');
