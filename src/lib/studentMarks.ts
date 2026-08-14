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
  /** True when NO assessment in this module has been marked for this student. */
  unmarked: boolean;
  /**
   * True when EVERY assessment that exists for this module has a mark.
   *
   * This distinction matters far more than it looks. computeStudentModuleMark
   * treats a missing component as zero, so a student with coursework at 80% and
   * no final exam yet scores 32% — which reads as a fail. Fine on a report a
   * person interprets; catastrophic once that number decides progression and
   * discontinuation.
   *
   * So no outcome is decided until this is true. A partly-marked module is
   * "still being marked", not a failure.
   */
  fullyMarked: boolean;
  /** How many of this module's assessments have a mark, and how many exist. */
  markedCount: number;
  assessmentCount: number;
}

/**
 * Which class's offering of a module this student attends.
 *
 * Normally their own class. For a retake it is a DIFFERENT class — the student
 * stays in their cohort but sits that one module with whichever class is running
 * it. The enrolment row records which.
 *
 * This resolution is why retakes work at all: assessments belong to a class, so
 * looking them up against the student's own class found nothing and the module
 * read as unmarked. That applied to every per-student override too, not just
 * retakes.
 */
export function classForModule(db: DB, student: Student, moduleId: string): string {
  const enrolment = (db.studentModules || []).find(
    sm => sm.studentId === student.id && sm.moduleId === moduleId,
  );
  return enrolment?.classId || student.classId;
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

      // Assessments belong to a class, so scope to the class the student
      // actually attends for THIS module — their own, or another cohort's when
      // they are retaking.
      const classId = classForModule(db, student, moduleId);
      const exams = db.exams.filter(e => e.classId === classId && e.moduleId === moduleId);
      const assignments = db.assignments.filter(
        a => a.classId === classId && a.moduleId === moduleId,
      );

      const cat = categorizeModuleAssessments(exams, assignments);
      const mark = computeStudentModuleMark({
        studentId: student.studentId,
        hasPractical: module.hasPractical !== false,
        cat,
        scoreOf,
      });

      const all = [...exams, ...assignments];
      const markedCount = all.filter(a => scoreOf(student.studentId, a.id) !== null).length;

      return {
        module, mark,
        unmarked: markedCount === 0,
        // A module with no assessments at all is not "fully marked" — there is
        // nothing to have marked, so it cannot produce a result.
        fullyMarked: all.length > 0 && markedCount === all.length,
        markedCount,
        assessmentCount: all.length,
      };
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
