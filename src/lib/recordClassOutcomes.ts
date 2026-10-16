/**
 * Settle module outcomes for a whole class, from a staff screen.
 *
 * Outcomes used to be recorded only from the student's own dashboard — and the
 * module_outcomes policies let only staff write, so that path was silently
 * refused and outcomes were never stored. Running it here, as the staff member
 * who has just saved marks (or asked for it), records them as soon as the
 * results are in, whether or not the student ever logs in.
 *
 * Same rules as the dashboard (buildStudentProgress + recordOutcomes): only a
 * settled semester is recorded, only changed outcomes are written, and a
 * supplementary is announced to the student once.
 */

import { supabase } from '@/integrations/supabase/client';
import type { DB, Student } from '@/data/db';
import { buildStudentProgress, loadRegisteredModuleIds } from '@/hooks/useStudentProgress';
import { recordOutcomes } from '@/lib/recordOutcomes';

export interface ClassOutcomeResult {
  studentsSettled: number;
  outcomesWritten: number;
  suppsNotified: number;
  errors: string[];
}

/** Each student's login, for supplementary notices; missing logins are skipped. */
async function studentAuthIds(students: Student[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const { data } = await supabase
    .from('profiles')
    .select('user_id,student_ref,student_id')
    .or(`student_ref.in.(${students.map(s => `"${s.id}"`).join(',')}),student_id.in.(${students.map(s => `"${s.studentId}"`).join(',')})`);
  ((data || []) as { user_id: string; student_ref: string | null; student_id: string | null }[]).forEach(p => {
    const byRef = students.find(s => s.id === p.student_ref?.trim());
    const byNumber = students.find(s => s.studentId === p.student_id?.trim());
    const student = byRef || byNumber;
    if (student && !map.has(student.id)) map.set(student.id, p.user_id);
  });
  return map;
}

export async function recordClassOutcomes(db: DB, classId: string, decidedBy: string | null): Promise<ClassOutcomeResult> {
  const result: ClassOutcomeResult = { studentsSettled: 0, outcomesWritten: 0, suppsNotified: 0, errors: [] };
  const students = db.students.filter(s => s.classId === classId);
  if (students.length === 0) return result;

  // Every mark these students hold, across all their modules — the semester
  // verdict needs the whole picture, not just the exam just saved.
  const { data, error } = await supabase
    .from('assessment_marks')
    .select('student_id,assessment_id,score')
    .in('student_id', students.map(s => s.studentId));
  if (error) return { ...result, errors: [error.message] };
  const scores = new Map<string, number>();
  (data || []).forEach(r => scores.set(`${r.student_id}|${r.assessment_id}`, Number(r.score)));
  const scoreOf = (studentNumber: string, assessmentId: string) => {
    const v = scores.get(`${studentNumber}|${assessmentId}`);
    return v === undefined ? null : v;
  };

  const authIds = await studentAuthIds(students);

  for (const student of students) {
    const registered = await loadRegisteredModuleIds(student);
    const progress = buildStudentProgress(db, student, scoreOf, registered);
    if (!progress.settled) continue;
    result.studentsSettled++;
    const res = await recordOutcomes({
      student,
      standings: progress.standings,
      authUserId: authIds.get(student.id) ?? null,
      decidedBy,
    });
    if (res.error) result.errors.push(`${student.name}: ${res.error}`);
    result.outcomesWritten += res.written;
    result.suppsNotified += res.suppsNotified;
  }
  return result;
}
