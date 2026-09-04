-- ============================================================================
-- Which of this month's 35 migrations are actually applied?
-- ============================================================================
-- Migrations here are pasted into the SQL editor by hand, so Supabase's own
-- supabase_migrations.schema_migrations table does not record them. This
-- detects by EFFECT instead: for each migration, does a distinctive object it
-- creates exist right now? That is true regardless of how it was run.
--
-- Read `state`. MISSING rows sort to the top.
--
-- BEFORE RE-RUNNING ANYTHING, note that these four are NOT safe to re-run:
--   20260812110000  creates staff accounts   -> could duplicate people
--   20260812120000  renames an enum value    -> errors, aborts the batch
--   20260812130000  merges/deletes staff     -> destructive
--   20260812140000  deletes auth accounts    -> destructive
-- If any of those show MISSING, tell me before running them; they need
-- checking against live data first, not blind replay.
-- ============================================================================

WITH checks(migration, file, present) AS (
  SELECT '20260812000000', '20260812000000_close_open_data.sql', EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='employee_leave_balances' AND policyname='HR reads leave balances')
  UNION ALL
  SELECT '20260812010000', '20260812010000_require_password_change.sql', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles' AND column_name='must_change_password')
  UNION ALL
  SELECT '20260812020000', '20260812020000_super_admin_profiles_roles.sql', EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='user_roles' AND policyname='Super admins can view all roles')
  UNION ALL
  SELECT '20260812030000', '20260812030000_attendance_allow_whole_class_register', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='attendance' AND column_name='session')
  UNION ALL
  SELECT '20260812040000', '20260812040000_assignment_files_to_storage.sql', EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='storage' AND policyname='Read assignment briefs')
  UNION ALL
  SELECT '20260812050000', '20260812050000_assignment_write_roles.sql', EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='assignments' AND policyname='Teaching staff manage assignments')
  UNION ALL
  SELECT '20260812060000', '20260812060000_fix_public_apply_and_lecturer_modules', EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='lecturer_modules' AND policyname='Allow all for authenticated')
  UNION ALL
  SELECT '20260812070000', '20260812070000_close_lecturer_modules_public_write.s', EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='lecturer_modules' AND policyname='Authenticated read lecturer_modules')
  UNION ALL
  SELECT '20260812070000', '20260812070000_scope_personal_data.sql', EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='marks' AND policyname='Staff read marks')
  UNION ALL
  SELECT '20260812080000', '20260812080000_close_student_photos_bucket.sql', EXISTS (SELECT 1 FROM storage.buckets WHERE id='student-photos' AND public=false)
  UNION ALL
  SELECT '20260812090000', '20260812090000_timetable_documents.sql', EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='timetable_documents' AND policyname='Everyone reads timetable documents')
  UNION ALL
  SELECT '20260812110000', '20260812110000_repair_orphaned_staff_accounts.sql', NULL::boolean
  UNION ALL
  SELECT '20260812120000', '20260812120000_rename_hoy_to_hoa.sql', EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='app_role' AND e.enumlabel='hoa') AND NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='app_role' AND e.enumlabel='hoy')
  UNION ALL
  SELECT '20260812130000', '20260812130000_merge_duplicate_staff_accounts.sql', NULL::boolean
  UNION ALL
  SELECT '20260812140000', '20260812140000_delete_orphaned_accounts.sql', NULL::boolean
  UNION ALL
  SELECT '20260812150000', '20260812150000_fix_hoy_in_function_bodies.sql', EXISTS (SELECT 1 FROM pg_proc p WHERE p.proname='is_school_staff' AND p.pronamespace='public'::regnamespace)
  UNION ALL
  SELECT '20260812160000', '20260812160000_add_principal_roles.sql', EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='app_role' AND e.enumlabel='principal') AND EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='app_role' AND e.enumlabel='deputy_principal')
  UNION ALL
  SELECT '20260812170000', '20260812170000_dashboard_stats.sql', EXISTS (SELECT 1 FROM pg_proc p WHERE p.proname='can_view_school' AND p.pronamespace='public'::regnamespace)
  UNION ALL
  SELECT '20260812180000', '20260812180000_fix_student_ids_with_spaces.sql', NOT EXISTS (SELECT 1 FROM students WHERE student_id ~ '\s')
  UNION ALL
  SELECT '20260812190000', '20260812190000_registration_supp_retake.sql', EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='student_registrations' AND policyname='Students read own registrations')
  UNION ALL
  SELECT '20260812200000', '20260812200000_student_modules_class.sql', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='student_modules' AND column_name='class_id')
  UNION ALL
  SELECT '20260812210000', '20260812210000_submission_policies_use_helper.sql', EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='storage' AND policyname='Read submissions')
  UNION ALL
  SELECT '20260812220000', '20260812220000_fix_department_stats_ambiguity.sql', EXISTS (SELECT 1 FROM pg_proc p WHERE p.proname='dashboard_department_stats' AND p.pronamespace='public'::regnamespace)
  UNION ALL
  SELECT '20260812230000', '20260812230000_link_omaatla_profile.sql', NOT EXISTS (SELECT 1 FROM students s WHERE s.name ILIKE '%Omaatla%' AND s.status='active' AND NOT EXISTS (SELECT 1 FROM profiles p WHERE p.student_ref = s.id))
  UNION ALL
  SELECT '20260812240000', '20260812240000_module_notes_links.sql', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='module_notes' AND column_name='link_url')
  UNION ALL
  SELECT '20260812250000', '20260812250000_super_admin_policy_sweep.sql', EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='notifications' AND policyname='Admins can manage notifications')
  UNION ALL
  SELECT '20260812260000', '20260812260000_super_admin_admissions.sql', EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='applications' AND policyname='Admins manage applications')
  UNION ALL
  SELECT '20260814000000', '20260814000000_activate_student_account.sql', EXISTS (SELECT 1 FROM pg_proc p WHERE p.proname='activate_student_account' AND p.pronamespace='public'::regnamespace)
  UNION ALL
  SELECT '20260814010000', '20260814010000_dashboard_analytics.sql', EXISTS (SELECT 1 FROM pg_proc p WHERE p.proname='dashboard_department_stats' AND p.pronamespace='public'::regnamespace)
  UNION ALL
  SELECT '20260814020000', '20260814020000_audit_repairs.sql', NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND 'public'=ANY(roles) AND tablename IN ('students','profiles','user_roles','assessment_marks','attendance','submissions') AND policyname NOT IN ('applicants_read_own_record','applicants_read_own_application'))
  UNION ALL
  SELECT '20260819000000', '20260819000000_hoa_exam_assignment_writes.sql', EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='exams' AND policyname='HOA manages exams')
  UNION ALL
  SELECT '20260820142349', '20260820142349_45276b81-269e-4741-a130-d17985905be5.', EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='attendance_devices' AND policyname='att_devices_admin_all')
  UNION ALL
  SELECT '20260820142410', '20260820142410_31a8b681-6f7d-42e2-b69f-22f0435c7311.', NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.prosecdef AND has_function_privilege('anon', p.oid, 'EXECUTE'))
  UNION ALL
  SELECT '20260821120000', '20260821120000_leave_allocations_write_policy.sql', EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgname='trg_enforce_leave_allocation_floor' AND NOT t.tgisinternal)
  UNION ALL
  SELECT '20260821140000', '20260821140000_leave_allocation_column_guard.sql', EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgname='trg_enforce_leave_allocation_columns' AND NOT t.tgisinternal)
)
SELECT migration, file,
       CASE WHEN present IS NULL THEN 'no detectable artifact - check by hand'
            WHEN present THEN 'ok'
            ELSE '>>> MISSING' END AS state
  FROM checks
 ORDER BY (present IS NOT FALSE), migration;
