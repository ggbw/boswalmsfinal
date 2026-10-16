-- Exam attendance on assessment marks.
--
-- Until now the exam marks sheet saved 0 for every blank box, so "absent",
-- "scored 0" and "not marked yet" were indistinguishable — and a blank that
-- should have been left out of a coursework average pulled it down instead.
--
-- From now on: no row = not marked yet (left out of averages, as moduleMark.ts
-- already expects); a row with attendance = 'absent' = the student missed the
-- exam (score 0); attendance = 'present' = sat it, score as entered.
-- Existing rows are all treated as present, which is what they recorded.

alter table public.assessment_marks
  add column if not exists attendance text not null default 'present';

alter table public.assessment_marks
  drop constraint if exists assessment_marks_attendance_check;

alter table public.assessment_marks
  add constraint assessment_marks_attendance_check
  check (attendance in ('present', 'absent'));
