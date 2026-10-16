-- ════════════════════════════════════════════════════════════════════════════
-- Boswa LMS — UAT step 4: remove the snapshot   (about two weeks after go-live)
-- ════════════════════════════════════════════════════════════════════════════
--
-- The snapshot holds a second copy of student, staff and payroll data. Once
-- the system has run cleanly after go-live, remove it. This cannot be undone.

drop schema uat_snapshot cascade;
