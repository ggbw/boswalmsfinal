-- ============================================================================
-- Boswa CIB SMS — data-flow audit
-- ============================================================================
-- ONE query, ONE result table. The previous version was ten separate
-- statements, and the SQL editor only ever displays the last result set — so
-- eight sections ran and were never seen.
--
-- The chain being audited, in the order data actually travels:
--
--   applicant → student → class → modules → assignments → marks → progression
--
-- A break upstream is invisible downstream: a class with no modules produces
-- students with no assignments and no marks, and every symptom gets reported as
-- a different bug.
--
-- HOW TO READ IT
--   severity 'FAULT'  something is broken and someone is affected right now
--   severity 'WARN'   worth knowing; not breaking anything yet
--   severity 'INFO'   the shape of the school, for context
--
-- Sorted with faults first. If nothing has severity 'FAULT', the system is
-- clean and the INFO rows are all you will see.
-- ============================================================================

WITH
-- ── LOGIN. An account that cannot resolve to a person cannot sign in, and the
--    failure looks to them like a wrong password.
login AS (
  SELECT 'FAULT' AS severity, '1 login' AS area,
         'auth account with no profile' AS finding, u.email::text AS detail
    FROM auth.users u LEFT JOIN profiles p ON p.user_id = u.id
   WHERE p.user_id IS NULL
  UNION ALL
  SELECT 'FAULT', '1 login', 'profile with no role', p.email
    FROM profiles p LEFT JOIN user_roles r ON r.user_id = p.user_id
   WHERE r.user_id IS NULL
  UNION ALL
  SELECT 'FAULT', '1 login', 'two accounts share one email',
         lower(email) || ' ×' || count(*)
    FROM profiles WHERE email IS NOT NULL
   GROUP BY lower(email) HAVING count(*) > 1
  UNION ALL
  -- useAuth reads the role with .single(), which ERRORS on two rows and falls
  -- through to treating the person as an applicant. A second role makes the
  -- applicant portal reappear at random — the "different view day to day"
  -- complaint.
  SELECT 'FAULT', '1 login', 'account has more than one role',
         coalesce(max(p.email), ur.user_id::text) || ' → ' || string_agg(ur.role::text, ' + ' ORDER BY ur.role::text)
    FROM user_roles ur LEFT JOIN profiles p ON p.user_id = ur.user_id
   GROUP BY ur.user_id HAVING count(*) > 1
),

-- ── STUDENT IDENTITY. profiles carries TWO links to a student: student_id (the
--    human number) and student_ref (students.id). Different parts of the system
--    trust different ones, so a profile holding only one works in half of it.
identity AS (
  SELECT 'FAULT', '2 identity', 'student login not linked to a student record',
         coalesce(p.email, p.student_id, p.name)
    FROM profiles p
    JOIN user_roles r ON r.user_id = p.user_id AND r.role = 'student'
   WHERE p.student_ref IS NULL OR p.student_id IS NULL
  UNION ALL
  SELECT 'FAULT', '2 identity', 'student_ref points at no student', p.email
    FROM profiles p
   WHERE p.student_ref IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM students s WHERE s.id = p.student_ref)
  UNION ALL
  SELECT 'WARN', '2 identity', 'active student has no login yet',
         s.student_id || ' · ' || s.name
    FROM students s
   WHERE s.status = 'active'
     AND NOT EXISTS (SELECT 1 FROM profiles p WHERE p.student_ref = s.id)
  UNION ALL
  -- A stray space makes a different string, and assessment_marks keys on it.
  SELECT 'FAULT', '2 identity', 'student number contains a space',
         '"' || s.student_id || '" · ' || s.name
    FROM students s WHERE s.student_id ~ '\s'
),

-- ── CURRICULUM. A class with no modules is a dead end: no assignments, no
--    notes, no marks. Most downstream complaints trace back to here.
curriculum AS (
  SELECT 'FAULT', '3 curriculum', 'class has NO modules — these students see nothing',
         c.name || ' (' || count(s.id) || ' students)'
    FROM classes c
    LEFT JOIN students s ON s.class_id = c.id AND s.status = 'active'
   WHERE NOT EXISTS (SELECT 1 FROM module_classes mc WHERE mc.class_id = c.id)
   GROUP BY c.id, c.name
  UNION ALL
  SELECT 'FAULT', '3 curriculum', 'active student is in no class',
         s.student_id || ' · ' || s.name
    FROM students s
   WHERE s.status = 'active'
     AND (s.class_id IS NULL OR NOT EXISTS (SELECT 1 FROM classes c WHERE c.id = s.class_id))
  UNION ALL
  SELECT 'WARN', '3 curriculum', 'module belongs to no department',
         m.name || ' (' || m.code || ')'
    FROM modules m
   WHERE m.dept IS NULL OR NOT EXISTS (SELECT 1 FROM departments d WHERE d.id = m.dept)
),

-- ── ASSIGNMENTS. A student sees work for the class they attend for that
--    module. An assignment naming a class whose curriculum lacks the module is
--    invisible to exactly the people it was set for.
work AS (
  SELECT 'FAULT', '4 assignments', 'assignment set for a class that does not take the module',
         c.name || ' · ' || m.name || ' · ' || a.title
    FROM assignments a
    JOIN classes c ON c.id = a.class_id
    JOIN modules m ON m.id = a.module_id
   WHERE NOT EXISTS (SELECT 1 FROM module_classes mc
                      WHERE mc.class_id = a.class_id AND mc.module_id = a.module_id)
  UNION ALL
  SELECT 'WARN', '4 assignments', 'module has work set but nobody teaching it',
         m.name || ' · ' || count(a.id) || ' assignment(s)'
    FROM modules m JOIN assignments a ON a.module_id = m.id
   WHERE NOT EXISTS (SELECT 1 FROM lecturer_modules lm WHERE lm.module_id = m.id)
   GROUP BY m.id, m.name
),

-- ── MARKS. assessment_marks.student_id holds the student NUMBER, while
--    attendance.student_id holds students.id. The two tables disagree by
--    design; code assuming either one everywhere is the largest source of
--    faults in this system.
marks AS (
  SELECT 'FAULT', '5 marks', 'mark recorded against an unknown student number',
         am.student_id || ' · ' || count(*) || ' mark(s)'
    FROM assessment_marks am
   WHERE NOT EXISTS (SELECT 1 FROM students s WHERE s.student_id = am.student_id)
   GROUP BY am.student_id
  UNION ALL
  SELECT 'FAULT', '5 marks', 'mark recorded against no known assessment',
         am.assessment_id || ' · ' || count(*) || ' mark(s)'
    FROM assessment_marks am
   WHERE NOT EXISTS (SELECT 1 FROM assignments a WHERE a.id = am.assessment_id)
     AND NOT EXISTS (SELECT 1 FROM exams e WHERE e.id = am.assessment_id)
   GROUP BY am.assessment_id
  UNION ALL
  SELECT 'FAULT', '5 marks', 'mark outside 0–100',
         am.student_id || ' · ' || am.score::text
    FROM assessment_marks am WHERE am.score < 0 OR am.score > 100
),

-- ── ATTENDANCE. attendance.student_id holds students.id, NOT the number.
attend AS (
  SELECT 'FAULT', '6 attendance', 'attendance row belongs to no student',
         a.student_id || ' on ' || a.date::text
    FROM attendance a
   WHERE NOT EXISTS (SELECT 1 FROM students s WHERE s.id = a.student_id)
  UNION ALL
  -- The register upserts with onConflict on these five columns. Without a
  -- unique index across exactly them, EVERY save fails for everyone.
  SELECT 'FAULT', '6 attendance',
         'no unique index for the register upsert — every save will fail',
         'needs UNIQUE (student_id, class_id, module_id, date, session)'
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_index ix
      JOIN pg_class t ON t.oid = ix.indrelid AND t.relname = 'attendance'
     WHERE ix.indisunique
       AND (SELECT array_agg(a.attname::text ORDER BY a.attname)
              FROM unnest(ix.indkey) k(attnum)
              JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum)
           = ARRAY['class_id','date','module_id','session','student_id'])
  UNION ALL
  SELECT 'WARN', '6 attendance', 'no registers have been taken at all',
         'the attendance table is empty, so every attendance figure is meaningless'
   WHERE NOT EXISTS (SELECT 1 FROM attendance)
),

-- ── STAFF. A lecturer with no modules sees an empty system and reports it as
--    broken; the cause is an unfinished setup step, not a bug.
staff AS (
  SELECT 'WARN', '7 staff', 'teaching staff with no modules assigned',
         p.name || ' (' || r.role || ')'
    FROM profiles p
    JOIN user_roles r ON r.user_id = p.user_id
   WHERE r.role IN ('lecturer', 'hod')
     AND NOT EXISTS (SELECT 1 FROM lecturer_modules lm WHERE lm.lecturer_id = p.user_id::text)
  UNION ALL
  SELECT 'WARN', '7 staff', 'department has no head',
         d.name
    FROM departments d
   WHERE d.hod IS NULL OR d.hod = ''
),

-- ── SECURITY. A write policy naming 'admin' without 'super_admin' fails
--    SILENTLY: PostgREST returns success with zero rows changed, so the UI
--    reports nothing and the record never moves. This one pattern caused the
--    stalled admissions chain, the swallowed notifications, and the enrolled
--    students trapped in the applicant portal.
security AS (
  SELECT 'FAULT', '8 security', 'write policy excludes super_admin — fails silently',
         tablename || ' · ' || policyname
    FROM pg_policies
   WHERE schemaname = 'public' AND cmd <> 'SELECT'
     AND coalesce(qual,'') || coalesce(with_check,'') LIKE '%''admin''%'
     AND coalesce(qual,'') || coalesce(with_check,'') NOT LIKE '%super_admin%'
  UNION ALL
  SELECT 'FAULT', '8 security', 'personal-data table has RLS switched OFF', c.relname
    FROM pg_class c
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
     AND NOT c.relrowsecurity
     AND c.relname IN ('students','profiles','user_roles','assessment_marks',
                       'attendance','submissions','applications','applicants')
  UNION ALL
  -- A policy with no TO clause applies to PUBLIC, which includes anonymous
  -- visitors. On personal data that is broader than intended.
  SELECT 'WARN', '8 security', 'policy applies to PUBLIC (includes anonymous)',
         tablename || ' · ' || policyname
    FROM pg_policies
   WHERE schemaname = 'public' AND 'public' = ANY(roles)
     AND tablename IN ('students','profiles','user_roles','assessment_marks',
                       'attendance','submissions','applications','applicants')
),

-- ── ADMISSIONS → STUDENT. An enrolled applicant whose role never flipped keeps
--    landing on the application page every time they sign in.
enrolment AS (
  SELECT 'FAULT', '9 enrolment', 'enrolled, but still lands on the applicant portal',
         coalesce(a.name, a.user_id::text)
    FROM applicants a
    JOIN applications ap ON ap.applicant_id = a.id AND ap.status = 'enrolled'
    LEFT JOIN user_roles ur ON ur.user_id = a.user_id
   WHERE a.user_id IS NOT NULL AND (ur.role IS DISTINCT FROM 'student'::app_role)
),

-- ── The shape of the school. Never a fault; context for everything above.
shape AS (
  SELECT 'INFO', '0 totals', 'auth accounts',      count(*)::text FROM auth.users
  UNION ALL SELECT 'INFO','0 totals','profiles',        count(*)::text FROM profiles
  UNION ALL SELECT 'INFO','0 totals','roles',           count(*)::text FROM user_roles
  UNION ALL SELECT 'INFO','0 totals','students active', count(*)::text FROM students WHERE status='active'
  UNION ALL SELECT 'INFO','0 totals','classes',         count(*)::text FROM classes
  UNION ALL SELECT 'INFO','0 totals','modules',         count(*)::text FROM modules
  UNION ALL SELECT 'INFO','0 totals','assignments',     count(*)::text FROM assignments
  UNION ALL SELECT 'INFO','0 totals','marks',           count(*)::text FROM assessment_marks
  UNION ALL SELECT 'INFO','0 totals','attendance rows', count(*)::text FROM attendance
)

SELECT severity, area, finding, detail
  FROM (
    SELECT * FROM login      UNION ALL SELECT * FROM identity
    UNION ALL SELECT * FROM curriculum UNION ALL SELECT * FROM work
    UNION ALL SELECT * FROM marks      UNION ALL SELECT * FROM attend
    UNION ALL SELECT * FROM staff      UNION ALL SELECT * FROM security
    UNION ALL SELECT * FROM enrolment  UNION ALL SELECT * FROM shape
  ) all_findings
 ORDER BY CASE severity WHEN 'FAULT' THEN 1 WHEN 'WARN' THEN 2 ELSE 3 END,
          area, finding, detail;
