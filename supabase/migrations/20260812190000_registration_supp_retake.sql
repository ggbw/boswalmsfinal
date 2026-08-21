-- ============================================================================
-- Semester registration, supplementary exams and retakes
-- ============================================================================
-- THE RULES THIS ENCODES
--
--   Module result = coursework 40% + practical 20% + final exam 40%
--                   (or coursework 60% + final exam 40% for theory-only modules)
--
--   ≥50%                        → passed
--   <50% AND final exam <45%    → SUPPLEMENTARY (resit the exam only)
--   <50% AND final exam ≥45%    → RETAKE (they failed on coursework, so resitting
--                                 the exam could not fix it)
--
--   Supplementary pass mark is 50%, and a pass is RECORDED AS 50% however well
--   they did. The module is then recalculated with 50 for the exam — which may
--   still leave it under 50 if the coursework was weak, in which case they
--   retake after all.
--
--   Retake = enrolled in the module with whichever class is running it next,
--   redoing everything. There is no limit on attempts.
--
--   End of semester: up to 2 unpassed modules and the student may progress,
--   carrying those as owed. 3 or more and they are discontinued.
--
-- WHAT THIS MIGRATION ADDS
--   • student_registrations       — a student's request to take a semester
--   • student_registration_modules — the modules in that request
--   • module_outcomes             — the agreed result per student per module
--
-- Deliberately NOT added: a supplementary "assessment type" column. A supp is
-- just an `exams` row whose type is 'Supplementary Exam', because exams.type is
-- already free text and assessment_marks already holds one row per assessment.
-- Making a supp a normal assessment means marking, reporting and transcripts
-- need no special case.
--
-- Registration is submitted by the STUDENT and approved by an ADMIN — two
-- separate actions, reflected in the policies below.
--
-- Idempotent: safe to run more than once.
-- ============================================================================


-- ── 1. Registrations ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.student_registrations (
  id            text PRIMARY KEY,
  student_id    text NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  year          integer NOT NULL,
  semester      integer NOT NULL,
  status        text NOT NULL DEFAULT 'pending',   -- pending | approved | rejected
  note          text,                              -- student's note on submission
  decision_note text,                              -- admin's reason, esp. on reject
  submitted_at  timestamptz NOT NULL DEFAULT now(),
  decided_at    timestamptz,
  decided_by    uuid,
  -- One live request per student per academic period. A rejected one can be
  -- resubmitted only after it is cleared, which is deliberate: it stops a
  -- student flooding the queue.
  UNIQUE (student_id, year, semester)
);

CREATE INDEX IF NOT EXISTS student_registrations_status_idx
  ON public.student_registrations (status, submitted_at DESC);

CREATE TABLE IF NOT EXISTS public.student_registration_modules (
  id              text PRIMARY KEY,
  registration_id text NOT NULL REFERENCES public.student_registrations(id) ON DELETE CASCADE,
  module_id       text NOT NULL REFERENCES public.modules(id),
  -- 'normal' = this semester's curriculum; 'retake' = a module owed from before.
  kind            text NOT NULL DEFAULT 'normal',
  -- The class whose offering of this module they will join. For a retake this is
  -- another cohort's class, which is exactly how a retake works here.
  class_id        text REFERENCES public.classes(id),
  UNIQUE (registration_id, module_id)
);


-- ── 2. Module outcomes ──────────────────────────────────────────────────────
-- The settled result of a student's attempt at a module. Derived from marks, but
-- STORED, because it is a decision with consequences — it drives supp lists,
-- what a student owes, and whether they are discontinued. Recomputing it on the
-- fly would mean a late mark edit could silently un-fail someone who had already
-- been told to retake.
CREATE TABLE IF NOT EXISTS public.module_outcomes (
  id           text PRIMARY KEY,
  student_id   text NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  module_id    text NOT NULL REFERENCES public.modules(id),
  class_id     text REFERENCES public.classes(id),
  year         integer NOT NULL,
  semester     integer NOT NULL,
  module_mark  numeric,
  exam_mark    numeric,
  -- passed | supp | retake | discontinued_fail
  outcome      text NOT NULL,
  -- Set when a supp has been sat, so the recalculated result is traceable.
  supp_mark    numeric,
  attempt      integer NOT NULL DEFAULT 1,
  decided_at   timestamptz NOT NULL DEFAULT now(),
  decided_by   uuid,
  UNIQUE (student_id, module_id, year, semester, attempt)
);

CREATE INDEX IF NOT EXISTS module_outcomes_student_idx
  ON public.module_outcomes (student_id, outcome);


-- ── 3. Access ───────────────────────────────────────────────────────────────
ALTER TABLE public.student_registrations        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_registration_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.module_outcomes              ENABLE ROW LEVEL SECURITY;

-- Students: see and submit their own; staff see all; only admins decide.
DROP POLICY IF EXISTS "Students read own registrations"   ON public.student_registrations;
DROP POLICY IF EXISTS "Students submit own registrations" ON public.student_registrations;
DROP POLICY IF EXISTS "Staff read registrations"          ON public.student_registrations;
DROP POLICY IF EXISTS "Admins decide registrations"       ON public.student_registrations;

CREATE POLICY "Students read own registrations"
  ON public.student_registrations FOR SELECT TO authenticated
  USING (student_id = my_student_ref(auth.uid()));

CREATE POLICY "Students submit own registrations"
  ON public.student_registrations FOR INSERT TO authenticated
  WITH CHECK (student_id = my_student_ref(auth.uid()) AND status = 'pending');

CREATE POLICY "Staff read registrations"
  ON public.student_registrations FOR SELECT TO authenticated
  USING (is_school_staff(auth.uid()) OR is_oversight_only(auth.uid()));

-- Approving or rejecting is an admin decision, not something a student or a
-- lecturer can do — which is the whole point of separating the two actions.
CREATE POLICY "Admins decide registrations"
  ON public.student_registrations FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role));

DROP POLICY IF EXISTS "Read registration modules"   ON public.student_registration_modules;
DROP POLICY IF EXISTS "Students add own modules"    ON public.student_registration_modules;
DROP POLICY IF EXISTS "Admins manage reg modules"   ON public.student_registration_modules;

CREATE POLICY "Read registration modules"
  ON public.student_registration_modules FOR SELECT TO authenticated
  USING (
    is_school_staff(auth.uid()) OR is_oversight_only(auth.uid())
    OR EXISTS (SELECT 1 FROM public.student_registrations r
                WHERE r.id = registration_id AND r.student_id = my_student_ref(auth.uid()))
  );

CREATE POLICY "Students add own modules"
  ON public.student_registration_modules FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.student_registrations r
             WHERE r.id = registration_id
               AND r.student_id = my_student_ref(auth.uid())
               AND r.status = 'pending')
  );

CREATE POLICY "Admins manage reg modules"
  ON public.student_registration_modules FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role));

-- Outcomes: a student sees their own results; staff see all; staff record them.
DROP POLICY IF EXISTS "Students read own outcomes" ON public.module_outcomes;
DROP POLICY IF EXISTS "Staff read outcomes"        ON public.module_outcomes;
DROP POLICY IF EXISTS "Staff manage outcomes"      ON public.module_outcomes;

CREATE POLICY "Students read own outcomes"
  ON public.module_outcomes FOR SELECT TO authenticated
  USING (student_id = my_student_ref(auth.uid()));

CREATE POLICY "Staff read outcomes"
  ON public.module_outcomes FOR SELECT TO authenticated
  USING (is_school_staff(auth.uid()) OR is_oversight_only(auth.uid()));

CREATE POLICY "Staff manage outcomes"
  ON public.module_outcomes FOR ALL TO authenticated
  USING (is_school_staff(auth.uid()))
  WITH CHECK (is_school_staff(auth.uid()));


-- ── Verify ──────────────────────────────────────────────────────────────────
SELECT t.tablename,
       (SELECT count(*) FROM pg_policies p
         WHERE p.schemaname='public' AND p.tablename=t.tablename) AS policies,
       (SELECT c.relrowsecurity FROM pg_class c
         JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relname=t.tablename)       AS rls_on
  FROM (VALUES ('student_registrations'), ('student_registration_modules'), ('module_outcomes'))
       AS t(tablename);
