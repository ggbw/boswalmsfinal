-- ============================================================================
-- One student account linked to no student record
-- ============================================================================
-- Omaatla Tlhabanelo's profile carries neither student_id nor student_ref, so
-- my_student_ref() and my_student_number() both resolve to NULL. That account
-- currently cannot:
--
--   • see their own marks, attendance or submissions (the ownership policies
--     from 20260812070000 match nothing)
--   • submit coursework — the storage policy refuses the upload
--   • see their assignments — AssignmentsPage finds no student record, and
--     deliberately shows nothing rather than everything
--
-- Both links are set. profiles carries two — the human number and the record key
-- — and different parts of the system read different ones, so setting only one
-- would leave half the symptoms in place.
--
-- Identified by matching on BOTH email and name, which agreed:
--   someblackanesenyana@gmail.com / "Omaatla Tlhabanelo"
--     → students.id s1777014822232, student_id BCI2024D-46
--
-- Idempotent: the WHERE clause matches nothing once applied.
-- ============================================================================

UPDATE public.profiles p
   SET student_id  = s.student_id,
       student_ref = s.id
  FROM public.students s
 WHERE p.user_id = 'f80d0563-02ac-4ca4-b4bc-c63e93be6e1d'
   AND s.id = 's1777014822232'
   AND (p.student_id IS NULL OR p.student_ref IS NULL);


-- ── Verify ──────────────────────────────────────────────────────────────────
-- Expect Omaatla resolved, and student accounts with no usable link back to 0.
SELECT p.name,
       p.email,
       coalesce(p.student_id, '—')                 AS number,
       coalesce(p.student_ref, '—')                AS record_key,
       coalesce(public.my_student_ref(p.user_id), 'STILL UNRESOLVED') AS resolves_to
  FROM public.profiles p
 WHERE p.user_id = 'f80d0563-02ac-4ca4-b4bc-c63e93be6e1d'
UNION ALL
SELECT '— student accounts with no usable link —',
       (SELECT count(*)::text FROM public.profiles p2
          JOIN public.user_roles r ON r.user_id = p2.user_id AND r.role = 'student'::app_role
         WHERE public.my_student_ref(p2.user_id) IS NULL),
       '', '', '';
