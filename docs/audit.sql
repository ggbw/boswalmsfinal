-- ============================================================================
-- Boswa CIB SMS — data-flow audit
-- ============================================================================
-- Run whole. Each section returns rows ONLY when something is wrong, except
-- section 0, which always reports and is the shape of the school.
--
-- The chain being audited, in the order data actually travels:
--
--   applicant → student → class → modules → assignments → marks → progression
--
-- A break anywhere upstream is invisible downstream: a class with no modules
-- produces students with no assignments and no marks, and every symptom is
-- reported as a different bug.
-- ============================================================================


-- 0 ── Shape of the school. Always returns; nothing here is an error.
SELECT 'accounts'  AS thing, count(*)::text AS n FROM auth.users
UNION ALL SELECT 'profiles',      count(*)::text FROM profiles
UNION ALL SELECT 'roles',         count(*)::text FROM user_roles
UNION ALL SELECT 'students (active)', count(*)::text FROM students WHERE status = 'active'
UNION ALL SELECT 'classes',       count(*)::text FROM classes
UNION ALL SELECT 'modules',       count(*)::text FROM modules
UNION ALL SELECT 'assignments',   count(*)::text FROM assignments
UNION ALL SELECT 'marks',         count(*)::text FROM assessment_marks
UNION ALL SELECT 'attendance',    count(*)::text FROM attendance;


-- 1 ── LOGIN. An account that cannot resolve to a person cannot sign in, and
--      the failure looks like a wrong password.
SELECT 'auth account with no profile' AS fault, u.email AS detail
  FROM auth.users u LEFT JOIN profiles p ON p.user_id = u.id
 WHERE p.user_id IS NULL
UNION ALL
SELECT 'profile with no role', p.email
  FROM profiles p LEFT JOIN user_roles r ON r.user_id = p.user_id
 WHERE r.user_id IS NULL
UNION ALL
SELECT 'two accounts, one email', lower(email) || ' ×' || count(*)
  FROM profiles GROUP BY lower(email) HAVING count(*) > 1;


-- 2 ── STUDENT IDENTITY. profiles carries TWO links to a student —
--      student_id (the human number) and student_ref (students.id). Code in
--      different places trusts different ones, so a profile holding only one
--      works in half the system. This was the single largest source of faults.
SELECT 'student login not linked to a student record' AS fault,
       coalesce(p.email, p.student_id) AS detail
  FROM profiles p
  JOIN user_roles r ON r.user_id = p.user_id AND r.role = 'student'
 WHERE p.student_ref IS NULL OR p.student_id IS NULL
UNION ALL
SELECT 'student_ref points at nothing', p.email
  FROM profiles p
 WHERE p.student_ref IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM students s WHERE s.id = p.student_ref)
UNION ALL
SELECT 'active student with no login', s.student_id || ' · ' || s.name
  FROM students s
 WHERE s.status = 'active'
   AND NOT EXISTS (SELECT 1 FROM profiles p WHERE p.student_ref = s.id);


-- 3 ── CURRICULUM. A class with no modules is a dead end: no assignments, no
--      notes, no marks. Every downstream complaint traces back here.
SELECT 'class has NO modules — students see nothing' AS fault,
       c.name || ' (' || count(s.id) || ' students)' AS detail
  FROM classes c
  LEFT JOIN students s ON s.class_id = c.id AND s.status = 'active'
 WHERE NOT EXISTS (SELECT 1 FROM module_classes mc WHERE mc.class_id = c.id)
 GROUP BY c.id, c.name
UNION ALL
SELECT 'active student in no class', s.student_id || ' · ' || s.name
  FROM students s
 WHERE s.status = 'active' AND (s.class_id IS NULL
   OR NOT EXISTS (SELECT 1 FROM classes c WHERE c.id = s.class_id));


-- 4 ── ASSIGNMENTS. A student sees work for the class they attend for that
--      module. An assignment naming a class whose curriculum lacks the module
--      is invisible to exactly the people it was set for.
SELECT 'assignment set for a class that does not take the module' AS fault,
       c.name || ' · ' || m.name || ' · ' || a.title AS detail
  FROM assignments a
  JOIN classes c ON c.id = a.class_id
  JOIN modules m ON m.id = a.module_id
 WHERE NOT EXISTS (SELECT 1 FROM module_classes mc
                    WHERE mc.class_id = a.class_id AND mc.module_id = a.module_id)
UNION ALL
SELECT 'module taught by nobody, but has work set',
       m.name || ' · ' || count(a.id) || ' assignment(s)'
  FROM modules m JOIN assignments a ON a.module_id = m.id
 WHERE NOT EXISTS (SELECT 1 FROM lecturer_modules lm WHERE lm.module_id = m.id)
 GROUP BY m.id, m.name;


-- 5 ── MARKS. computeStudentModuleMark ADDS the components, so a missing one
--      counts as zero. A part-marked cohort therefore reads as a failing one.
--      Progression must never judge a module in this state.
SELECT 'mark recorded against no known assessment' AS fault,
       am.assessment_id AS detail
  FROM assessment_marks am
 WHERE NOT EXISTS (SELECT 1 FROM assignments a WHERE a.id = am.assessment_id)
   AND NOT EXISTS (SELECT 1 FROM exams e      WHERE e.id = am.assessment_id)
UNION ALL
SELECT 'mark outside 0–100',
       am.student_id || ' · ' || am.score::text
  FROM assessment_marks am
 WHERE am.score < 0 OR am.score > 100;


-- 6 ── ATTENDANCE. attendance.student_id holds students.id, NOT the student
--      number. Writing the number produces rows that belong to nobody and a
--      register that silently records nothing.
SELECT 'attendance row belongs to no student' AS fault,
       a.student_id || ' on ' || a.date::text AS detail
  FROM attendance a
 WHERE NOT EXISTS (SELECT 1 FROM students s WHERE s.id = a.student_id)
 LIMIT 25;


-- 7 ── STAFF. A lecturer with no modules sees an empty system and reports it
--      as broken; the cause is an unfinished assignment step, not a bug.
-- lecturer_modules.lecturer_id is TEXT holding the auth user id, so it needs a
-- cast — profiles.id (the row PK) is NOT what it points at.
SELECT 'teaching staff with no modules assigned' AS fault,
       p.name || ' (' || r.role || ')' AS detail
  FROM profiles p
  JOIN user_roles r ON r.user_id = p.user_id
 WHERE r.role IN ('lecturer', 'hod')
   AND NOT EXISTS (SELECT 1 FROM lecturer_modules lm
                    WHERE lm.lecturer_id = p.user_id::text);


-- 8 ── SECURITY. A write policy naming 'admin' without 'super_admin' fails
--      SILENTLY: Supabase returns success with zero rows changed, so the UI
--      reports nothing and the record simply never moves. This is what stalled
--      admissions and swallowed timetable notifications.
SELECT 'write policy excludes super_admin — will fail silently' AS fault,
       tablename || ' · ' || policyname AS detail
  FROM pg_policies
 WHERE schemaname = 'public' AND cmd <> 'SELECT'
   AND coalesce(qual, '') || coalesce(with_check, '') LIKE '%''admin''%'
   AND coalesce(qual, '') || coalesce(with_check, '') NOT LIKE '%super_admin%'
UNION ALL
SELECT 'table holds personal data with RLS OFF',
       c.relname
  FROM pg_class c
 WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
   AND NOT c.relrowsecurity
   AND c.relname IN ('students','profiles','user_roles','assessment_marks',
                     'attendance','submissions','applications','applicants');


-- 9 ── PASSWORDS. profiles carries must_change_password but no timestamp, so
--      "already changed it" and "never asked" look identical once the flag is
--      false. The answerable question is who still owes a change. Informational.
SELECT r.role::text AS role,
       count(*) FILTER (WHERE coalesce(p.must_change_password, false)) AS still_to_change,
       count(*)                                                        AS accounts
  FROM profiles p
  JOIN user_roles r ON r.user_id = p.user_id
 GROUP BY r.role
 ORDER BY still_to_change DESC, role;


-- 10 ── MARKS ↔ STUDENTS. assessment_marks.student_id holds the student NUMBER
--       (what a lecturer types), while attendance.student_id holds students.id
--       (the record key). The two tables disagree by design, and code that
--       assumes either one everywhere is the single largest source of faults
--       in this system.
SELECT 'mark recorded against an unknown student number' AS fault,
       am.student_id AS detail, count(*) AS marks
  FROM assessment_marks am
 WHERE NOT EXISTS (SELECT 1 FROM students s WHERE s.student_id = am.student_id)
 GROUP BY am.student_id
 ORDER BY marks DESC
 LIMIT 25;
