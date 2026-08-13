/**
 * Where a student stands this semester: what they passed, what they owe, and
 * whether they may move on.
 *
 * The grading weights live in one place (moduleMark.ts) and the pass/supp/retake
 * rules in another (progression.ts). This joins them to marks and answers the
 * question every screen actually asks.
 *
 * NOTE ON WHERE THE DECISION IS MADE
 *   Progression is automatic — nobody approves it. But the arithmetic stays in
 *   TypeScript rather than being duplicated into a database function or an edge
 *   function, because two implementations of the same weighting WILL drift, and
 *   this system already has scars from exactly that. So the student is told they
 *   have progressed as soon as their marks settle, and the year/semester field
 *   is written when an admin approves their registration — a step already being
 *   taken, by someone who can see what they are approving.
 */

import { useMemo } from 'react';
import type { DB, Student } from '@/data/db';
import { useAssessmentMarks } from './useAssessmentMarks';
import { studentModuleResults, classForModule, type StudentModuleResult } from '@/lib/studentMarks';
import {
  moduleOutcome, semesterIsSettled, semesterVerdict,
  SUPP_EXAM_TYPE, type Outcome, type SemesterVerdict,
} from '@/lib/progression';

export interface ModuleStanding {
  result: StudentModuleResult;
  /** null when nothing has been marked — deliberately not treated as a failure. */
  outcome: Outcome | null;
  /** The final-exam component the 45% rule is judged on. */
  examMark: number | null;
  /** True when a supplementary assessment exists for this module. */
  suppOffered: boolean;
  suppMark: number | null;
}

export interface StudentProgress {
  loading: boolean;
  error: string | null;
  standings: ModuleStanding[];
  /** Modules not yet passed — what the student owes. */
  owed: ModuleStanding[];
  settled: boolean;
  settledReason: string;
  verdict: SemesterVerdict | null;
}

export function useStudentProgress(db: DB, student: Student | null): StudentProgress {
  const { scoreOf, loading, error } = useAssessmentMarks({
    studentNumbers: student ? [student.studentId] : [],
  });

  return useMemo(() => {
    if (!student || loading) {
      return {
        loading, error, standings: [], owed: [],
        settled: false, settledReason: 'Loading…', verdict: null,
      };
    }

    const results = studentModuleResults(db, student, scoreOf);

    const standings: ModuleStanding[] = results.map(result => {
      // The 45% rule is judged on the FINAL exams — Written and Oral count
      // toward coursework and are deliberately excluded.
      //
      // NOT averaged. Where a module carries both a Final Theory and a Final
      // Practical, EITHER falling below 45 earns a supplementary — you resit the
      // exam you failed, and a strong mark in one does not cancel a weak mark in
      // the other. The lowest is reported, because that is the one that
      // triggered it.
      const finals = [result.mark.finalTheory, result.mark.finalPrac]
        .filter((v): v is number => v !== null && v !== undefined);
      const examMark = finals.length ? Math.min(...finals) : null;

      // A supplementary is an ordinary exam row typed 'Supplementary Exam', so
      // it needs no special storage — only recognising here.
      // Same class resolution as the marks — a supplementary set for the class
      // the student is retaking with must be found, not just their own class's.
      const moduleClassId = classForModule(db, student, result.module.id);
      const supp = db.exams.find(
        e => e.moduleId === result.module.id
          && e.classId === moduleClassId
          && e.type === SUPP_EXAM_TYPE,
      );
      const suppMark = supp ? scoreOf(student.studentId, supp.id) : null;

      return {
        result,
        outcome: result.unmarked ? null : moduleOutcome(result.mark.moduleMark, examMark),
        examMark,
        suppOffered: !!supp,
        suppMark,
      };
    });

    const decided = standings.filter(s => s.outcome !== null).map(s => s.outcome as Outcome);
    const settledCheck = semesterIsSettled(decided, standings.length);

    return {
      loading, error, standings,
      owed: standings.filter(s => s.outcome === 'supp' || s.outcome === 'retake'),
      settled: settledCheck.settled,
      settledReason: settledCheck.reason,
      // Only meaningful once settled — a verdict mid-marking would be wrong.
      verdict: settledCheck.settled ? semesterVerdict(decided) : null,
    };
  }, [db, student, scoreOf, loading, error]);
}
