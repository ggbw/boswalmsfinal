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
  /**
   * True when this module is being RETAKEN — carried from an earlier semester.
   * Retakes are excluded from the pass-half rule: it measures this semester's
   * own curriculum, not what is being carried.
   */
  isRetake: boolean;
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
      // ONLY the Final Theory Exam can be supplemented.
      //
      // A practical cannot be resat as a supplementary — a kitchen assessment is
      // not something you sit again in an exam hall a fortnight later. So a
      // module is judged for supplementary eligibility on its Final Theory Exam
      // alone. A student who failed on the practical goes to a retake, where
      // they do the module again in full.
      //
      // Written and Oral exams are excluded too: those count toward coursework,
      // not the 40% exam component.
      const examMark = result.mark.finalTheory ?? null;

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

      // A retake is an enrolment carrying a class other than the student's own —
      // they sit that module with a different cohort.
      const isRetake = moduleClassId !== student.classId;

      return {
        result,
        isRetake,
        // No outcome until EVERY assessment is marked. computeStudentModuleMark
        // treats a missing component as zero, so a part-marked module scores far
        // below what the student has actually earned — 80% coursework with no
        // final exam yet reads as 32%. Deciding an outcome from that would tell
        // a mid-semester cohort they had failed.
        outcome: result.fullyMarked ? moduleOutcome(result.mark.moduleMark, examMark) : null,
        examMark,
        suppOffered: !!supp,
        suppMark,
      };
    });

    // Which modules the pass-half rule counts.
    //
    // Normally: this semester's own curriculum, excluding modules carried from
    // an earlier semester. A student progressing with 5 new modules and 2 carried
    // must pass 3 of the 5.
    //
    // BUT a student REPEATING a semester takes ONLY the modules they failed —
    // every one of which is carried. Excluding carried modules would leave
    // nothing to count, the verdict would read "no modules recorded", and they
    // could never progress again. So when there is no fresh curriculum, the
    // carried modules ARE the semester and the rule applies to them.
    const fresh = standings.filter(s => !s.isRetake);
    const isRepeatingSemester = fresh.length === 0 && standings.length > 0;

    const thisSemester = isRepeatingSemester ? standings : fresh;
    const carried = isRepeatingSemester ? [] : standings.filter(s => s.isRetake);

    const decided = thisSemester
      .filter(s => s.outcome !== null).map(s => s.outcome as Outcome);
    const carriedDecided = carried
      .filter(s => s.outcome !== null).map(s => s.outcome as Outcome);

    // Settled is judged on this semester's modules being FULLY marked.
    const settledCheck = semesterIsSettled(decided, thisSemester.length);

    return {
      loading, error, standings,
      owed: standings.filter(s => s.outcome === 'supp' || s.outcome === 'retake'),
      settled: settledCheck.settled,
      settledReason: settledCheck.reason,
      // Only meaningful once settled — a verdict mid-marking would be wrong.
      verdict: settledCheck.settled ? semesterVerdict(decided, carriedDecided) : null,
    };
  }, [db, student, scoreOf, loading, error]);
}
