
-- ========================================
-- 1. ROLE ENUM & USER ROLES TABLE
-- ========================================
CREATE TYPE public.app_role AS ENUM ('admin', 'hod', 'hoy', 'lecturer', 'student');

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL,
  UNIQUE (user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Security definer function to check roles (avoids RLS recursion)
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role
  )
$$;

-- Function to get user's role
CREATE OR REPLACE FUNCTION public.get_user_role(_user_id UUID)
RETURNS app_role
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT role FROM public.user_roles WHERE user_id = _user_id LIMIT 1
$$;

-- RLS for user_roles
CREATE POLICY "Users can view their own role" ON public.user_roles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admins can view all roles" ON public.user_roles FOR SELECT USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can insert roles" ON public.user_roles FOR INSERT WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can update roles" ON public.user_roles FOR UPDATE USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can delete roles" ON public.user_roles FOR DELETE USING (public.has_role(auth.uid(), 'admin'));

-- ========================================
-- 2. PROFILES TABLE
-- ========================================
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  name TEXT NOT NULL,
  email TEXT,
  dept TEXT,
  code TEXT,
  student_ref TEXT,
  student_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admins can view all profiles" ON public.profiles FOR SELECT USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "HODs can view all profiles" ON public.profiles FOR SELECT USING (public.has_role(auth.uid(), 'hod'));
CREATE POLICY "HOYs can view all profiles" ON public.profiles FOR SELECT USING (public.has_role(auth.uid(), 'hoy'));
CREATE POLICY "Lecturers can view all profiles" ON public.profiles FOR SELECT USING (public.has_role(auth.uid(), 'lecturer'));
CREATE POLICY "Admins can insert profiles" ON public.profiles FOR INSERT WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can update profiles" ON public.profiles FOR UPDATE USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = user_id);

-- ========================================
-- 3. DEPARTMENTS
-- ========================================
CREATE TABLE public.departments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  hod TEXT
);
ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can view departments" ON public.departments FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage departments" ON public.departments FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- ========================================
-- 4. PROGRAMMES
-- ========================================
CREATE TABLE public.programmes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  years INT NOT NULL DEFAULT 1,
  semesters INT NOT NULL DEFAULT 2,
  type TEXT NOT NULL DEFAULT 'Diploma',
  start_year INT NOT NULL
);
ALTER TABLE public.programmes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can view programmes" ON public.programmes FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage programmes" ON public.programmes FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- ========================================
-- 5. TERMS
-- ========================================
CREATE TABLE public.terms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  semester_id INT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL
);
ALTER TABLE public.terms ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can view terms" ON public.terms FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage terms" ON public.terms FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- ========================================
-- 6. SCHOOL CONFIG
-- ========================================
CREATE TABLE public.school_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_name TEXT NOT NULL DEFAULT 'Boswa Culinary Institute of Botswana',
  current_year INT NOT NULL DEFAULT 2026,
  current_semester INT NOT NULL DEFAULT 1,
  current_term INT NOT NULL DEFAULT 1
);
ALTER TABLE public.school_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can view config" ON public.school_config FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage config" ON public.school_config FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- ========================================
-- 7. CLASSES
-- ========================================
CREATE TABLE public.classes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  programme TEXT REFERENCES public.programmes(id),
  year INT NOT NULL,
  semester INT NOT NULL,
  cal_year INT NOT NULL,
  division TEXT,
  lecturer TEXT
);
ALTER TABLE public.classes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can view classes" ON public.classes FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage classes" ON public.classes FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- ========================================
-- 8. MODULES
-- ========================================
CREATE TABLE public.modules (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  dept TEXT REFERENCES public.departments(id)
);
ALTER TABLE public.modules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can view modules" ON public.modules FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage modules" ON public.modules FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- Module-class mapping (many-to-many)
CREATE TABLE public.module_classes (
  module_id TEXT REFERENCES public.modules(id) ON DELETE CASCADE,
  class_id TEXT REFERENCES public.classes(id) ON DELETE CASCADE,
  PRIMARY KEY (module_id, class_id)
);
ALTER TABLE public.module_classes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can view module_classes" ON public.module_classes FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage module_classes" ON public.module_classes FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- ========================================
-- 9. STUDENTS
-- ========================================
CREATE TABLE public.students (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  gender TEXT,
  dob DATE,
  mobile TEXT,
  class_id TEXT REFERENCES public.classes(id),
  guardian TEXT,
  programme TEXT REFERENCES public.programmes(id),
  year INT NOT NULL DEFAULT 1,
  semester INT NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active'
);
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can view students" ON public.students FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage students" ON public.students FOR ALL USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Lecturers can update students" ON public.students FOR UPDATE USING (public.has_role(auth.uid(), 'lecturer'));

-- ========================================
-- 10. MARKS
-- ========================================
CREATE TABLE public.marks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id TEXT REFERENCES public.students(id) NOT NULL,
  module_id TEXT REFERENCES public.modules(id) NOT NULL,
  class_id TEXT REFERENCES public.classes(id) NOT NULL,
  test1 NUMERIC DEFAULT 0,
  test2 NUMERIC DEFAULT 0,
  pract_test NUMERIC DEFAULT 0,
  ind_ass NUMERIC DEFAULT 0,
  grp_ass NUMERIC DEFAULT 0,
  final_exam NUMERIC DEFAULT 0,
  practical NUMERIC DEFAULT 0,
  year INT NOT NULL,
  semester INT NOT NULL,
  UNIQUE (student_id, module_id, class_id, year, semester)
);
ALTER TABLE public.marks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can view marks" ON public.marks FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage marks" ON public.marks FOR ALL USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Lecturers can manage marks" ON public.marks FOR ALL USING (public.has_role(auth.uid(), 'lecturer'));

-- ========================================
-- 11. ATTENDANCE
-- ========================================
CREATE TABLE public.attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id TEXT REFERENCES public.students(id) NOT NULL,
  class_id TEXT REFERENCES public.classes(id) NOT NULL,
  date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'present',
  UNIQUE (student_id, class_id, date)
);
ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can view attendance" ON public.attendance FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage attendance" ON public.attendance FOR ALL USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Lecturers can manage attendance" ON public.attendance FOR ALL USING (public.has_role(auth.uid(), 'lecturer'));

-- ========================================
-- 12. EXAMS
-- ========================================
CREATE TABLE public.exams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  module_id TEXT REFERENCES public.modules(id),
  class_id TEXT REFERENCES public.classes(id),
  date DATE,
  status TEXT DEFAULT 'scheduled',
  type TEXT
);
ALTER TABLE public.exams ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can view exams" ON public.exams FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage exams" ON public.exams FOR ALL USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Lecturers can manage exams" ON public.exams FOR ALL USING (public.has_role(auth.uid(), 'lecturer'));

-- ========================================
-- 13. ASSIGNMENTS
-- ========================================
CREATE TABLE public.assignments (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  module_id TEXT REFERENCES public.modules(id),
  class_id TEXT REFERENCES public.classes(id),
  due_date DATE,
  marks INT DEFAULT 0,
  status TEXT DEFAULT 'active',
  description TEXT,
  instructions TEXT,
  attachment_name TEXT,
  attachment_data TEXT,
  uploaded_by TEXT,
  uploaded_date TEXT
);
ALTER TABLE public.assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can view assignments" ON public.assignments FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage assignments" ON public.assignments FOR ALL USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Lecturers can manage assignments" ON public.assignments FOR ALL USING (public.has_role(auth.uid(), 'lecturer'));

-- ========================================
-- 14. SUBMISSIONS
-- ========================================
CREATE TABLE public.submissions (
  id TEXT PRIMARY KEY,
  assignment_id TEXT REFERENCES public.assignments(id),
  student_id TEXT REFERENCES public.students(id),
  submitted_date TEXT,
  submitted_time TEXT,
  file_name TEXT,
  file_data TEXT,
  file_size TEXT,
  notes TEXT,
  status TEXT DEFAULT 'submitted',
  grade NUMERIC,
  feedback TEXT
);
ALTER TABLE public.submissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can view submissions" ON public.submissions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage submissions" ON public.submissions FOR ALL USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Lecturers can manage submissions" ON public.submissions FOR ALL USING (public.has_role(auth.uid(), 'lecturer'));

-- ========================================
-- 15. TIMETABLE
-- ========================================
CREATE TABLE public.timetable (
  id TEXT PRIMARY KEY,
  class_id TEXT REFERENCES public.classes(id),
  day TEXT NOT NULL,
  time TEXT NOT NULL,
  module_id TEXT REFERENCES public.modules(id),
  room TEXT
);
ALTER TABLE public.timetable ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can view timetable" ON public.timetable FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage timetable" ON public.timetable FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- ========================================
-- 16. NOTIFICATIONS
-- ========================================
CREATE TABLE public.notifications (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT,
  date DATE DEFAULT CURRENT_DATE,
  priority TEXT DEFAULT 'normal',
  author TEXT
);
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can view notifications" ON public.notifications FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage notifications" ON public.notifications FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- ========================================
-- 17. ADMISSION ENQUIRIES
-- ========================================
CREATE TABLE public.admission_enquiries (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  programme TEXT,
  status TEXT DEFAULT 'enquiry',
  date DATE DEFAULT CURRENT_DATE,
  dob DATE,
  gender TEXT,
  mobile TEXT
);
ALTER TABLE public.admission_enquiries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can view enquiries" ON public.admission_enquiries FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage enquiries" ON public.admission_enquiries FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- ========================================
-- 18. STUDENT MODULE OVERRIDES
-- ========================================
CREATE TABLE public.student_modules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id TEXT REFERENCES public.students(id) NOT NULL,
  module_id TEXT REFERENCES public.modules(id) NOT NULL,
  added_by TEXT,
  added_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (student_id, module_id)
);
ALTER TABLE public.student_modules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can view student_modules" ON public.student_modules FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage student_modules" ON public.student_modules FOR ALL USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "HODs can manage student_modules" ON public.student_modules FOR ALL USING (public.has_role(auth.uid(), 'hod'));

-- ========================================
-- 19. UPDATED_AT TRIGGER
-- ========================================
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ========================================
-- 20. AUTO-CREATE PROFILE ON SIGNUP
-- ========================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (user_id, name, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', NEW.email),
    NEW.email
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ========================================
-- 21. SEED CONFIG DATA
-- ========================================
INSERT INTO public.school_config (school_name, current_year, current_semester, current_term)
VALUES ('Boswa Culinary Institute of Botswana', 2026, 1, 1);

INSERT INTO public.terms VALUES
  ('t1', 'Term 1', 1, '2025-07-07', '2025-09-19'),
  ('t2', 'Term 2', 1, '2025-09-22', '2025-12-05'),
  ('t3', 'Term 3', 2, '2026-01-12', '2026-03-27'),
  ('t4', 'Term 4', 2, '2026-04-07', '2026-06-19');

INSERT INTO public.departments VALUES
  ('ADM', 'Administration', 'Julia'),
  ('ADMIN_OPS', 'Admin & Operations', 'Malcom'),
  ('CULH', 'Culinary & Hospitality', 'Bonang Keabetswe'),
  ('CULP', 'Culinary Practicals', 'Poneso Kgakge');

INSERT INTO public.programmes VALUES
  ('DIPL2023', 'Diploma in Culinary Arts', 3, 2, 'Diploma', 2023),
  ('DIPL2024', 'Diploma in Culinary Arts', 3, 2, 'Diploma', 2024),
  ('DIPL2025', 'Diploma in Culinary Arts', 3, 2, 'Diploma', 2025),
  ('CERT2025', 'Certificate in Culinary Arts', 1, 2, 'Certificate', 2025);

INSERT INTO public.classes VALUES
  ('cls001', 'Ramseys', 'DIPL2025', 1, 1, 2025, 'Year 1 - 2025', 'Poneso Kgakge'),
  ('cls002', 'Reubens', 'DIPL2025', 1, 1, 2025, 'Year 1 - 2025', 'Nthoyapelo Senatla'),
  ('cls003', 'Caremes', 'DIPL2023', 3, 1, 2026, 'Year 3 - 2023', 'Sekgele Mono'),
  ('cls004', 'Soyers', 'DIPL2024', 2, 1, 2026, 'Year 2 - 2024', 'Neo Medupe'),
  ('cls005', 'Escoffiers', 'DIPL2024', 2, 1, 2026, 'Year 2 - 2024', 'Tshepang Utlwang'),
  ('cls006', 'Cert Jan 2025', 'CERT2025', 1, 2, 2025, 'Year 1 - 2025', 'Poneso Kgakge'),
  ('cls007', 'Cert July 2025', 'CERT2025', 1, 1, 2025, 'Year 1 - 2025', 'Sekgele Mono');

INSERT INTO public.modules VALUES
  ('mod001', 'BOSCG-01', 'Introduction to Hot Kitchen', 'CULP'),
  ('mod002', 'BOSCG-02', 'Cold Kitchen & Pastry', 'CULP'),
  ('mod003', 'BOSCG-03', 'Food Safety & Hygiene', 'CULH'),
  ('mod004', 'BOSCG-04', 'Professional Cookery', 'CULP'),
  ('mod005', 'BOSCG-05', 'Hospitality Management', 'CULH'),
  ('mod006', 'BOSCG-06', 'Culinary Arts Advanced', 'CULP'),
  ('mod007', 'BOSCG-07', 'Menu Planning', 'CULH'),
  ('mod008', 'BOSCG-08', 'Basic Culinary Skills', 'CULP');

INSERT INTO public.module_classes VALUES
  ('mod001', 'cls001'), ('mod001', 'cls002'),
  ('mod002', 'cls001'), ('mod002', 'cls002'),
  ('mod003', 'cls001'), ('mod003', 'cls002'), ('mod003', 'cls003'), ('mod003', 'cls004'),
  ('mod004', 'cls003'), ('mod004', 'cls004'), ('mod004', 'cls005'),
  ('mod005', 'cls004'), ('mod005', 'cls005'),
  ('mod006', 'cls003'),
  ('mod007', 'cls004'), ('mod007', 'cls005'),
  ('mod008', 'cls006'), ('mod008', 'cls007');
