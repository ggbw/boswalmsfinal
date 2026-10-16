-- ════════════════════════════════════════════════════════════════════════════
-- Boswa LMS — UAT step 2: see what UAT has changed   (read-only, any time)
-- ════════════════════════════════════════════════════════════════════════════
--
-- Safe to run as often as you like during UAT. It changes nothing.
-- Run all three queries on cleanup day, BEFORE 03_wipe_uat_data.sql, and read
-- them: this is the dry run.

-- 1. Per LMS table: rows UAT added, live rows UAT edited, live rows UAT deleted.
--    Lines in [brackets] are reports. Read them; the cleanup acts only on the
--    [accounts] it marks "will be deleted".
select * from uat_snapshot.diff();

-- 2. Every login account created since the snapshot, and what happens to it.
--    A real person on this list marked "delete" (for example a lecturer hired
--    during UAT who has no employee record yet) goes into keep_emails in step 3.
select * from uat_snapshot.new_accounts();

-- 3. Files uploaded to LMS buckets since the snapshot. Storage blocks deleting
--    files through SQL, so these are removed by hand in Lovable Cloud > Storage.
select * from uat_snapshot.new_files();
