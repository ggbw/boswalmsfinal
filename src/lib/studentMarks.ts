/**
 * One student's marks across every module they take.
 *
 * Wraps the weighting logic already proven in ReportsPage and TranscriptsPage
 * (`categorizeModuleAssessments` + `computeStudentModuleMark`) so the remaining
 * screens can show real marks instead of reading the abandoned `marks` table and
 * rendering blanks.
 *
 * Pass `scoreOf` from useAssessmentMarks.
 */

import type { DB, Module, Student } from '@/data/db';
import {
  categorizeModuleAssessments,
  computeStudentModuleMark,
  type StudentModuleMark,
} from './moduleMark';

export interface StudentModuleResult {
  module: Module;
  mark: StudentModuleMark;
  /** True when no assessment in this module has been marked for this student. */
  unmarked: boolean;
}

/** Modules a student takes: their class's linked modules, plus any per-student override. */
export function studentModuleIds(db: DB, student: Student): string[] {
  return [...new Set([
    ...db.modules.filter(m => (m.classes || []).includes(student.classId)).map(m => m.id),
    ...(db.studentModules || [])
      .filter(sm => sm.studentId === student.id)   // student_modules keys on students.id
      .map(sm => sm.moduleId),
  ])];
}

/**
 * Compute every module mark for one student.
 *
 * `scoreOf` takes the student NUMBER — assessment_marks keys on it, unlike the
 * other tables. Modules with nothing marked yet are returned with
 * `unmarked: true` rather than a misleading 0, so callers can show "—" instead
 * of implying the student scored zero.
 */
export function studentModuleResults(
  db: DB,
  student: Student,
  scoreOf: (studentNumber: string, assessmentId: string) => number | null,
): StudentModuleResult[] {
  return studentModuleIds(db, student)
    .map(moduleId => {
      const module = db.modules.find(m => m.id === moduleId);
      if (!module) return null;

      // Assessments are set per class, so scope to the student's own class.
      const exams = db.exams.filter(e => e.classId === student.classId && e.moduleId === moduleId);
      const assignments = db.assignments.filter(
        a => a.classId === student.classId && a.moduleId === moduleId,
      );

      const cat = categorizeModuleAssessments(exams, assignments);
      const mark = computeStudentModuleMark({
        studentId: student.studentId,
        hasPractical: module.hasPractical !== false,
        cat,
        scoreOf,
      });

      const unmarked = [...exams, ...assignments]
        .every(a => scoreOf(student.studentId, a.id) === null);

      return { module, mark, unmarked };
    })
    .filter((r): r is StudentModuleResult => r !== null)
    .sort((a, b) => a.module.name.localeCompare(b.module.name));
}

/** Average module mark across everything marked. Null when nothing is. */
export function studentAverage(results: StudentModuleResult[]): number | null {
  const marked = results.filter(r => !r.unmarked);
  if (marked.length === 0) return null;
  return Math.round(marked.reduce((sum, r) => sum + r.mark.moduleMark, 0) / marked.length);
}
