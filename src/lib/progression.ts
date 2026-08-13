/**
 * Supplementary exams, retakes, and whether a student may progress.
 *
 * The rules, in one place, so every screen agrees:
 *
 *   Module result = coursework + practical + final exam (see moduleMark.ts)
 *
 *     ≥ PASS_MARK                        → passed
 *     < PASS_MARK and exam < SUPP_TRIGGER → supplementary (resit the exam only)
 *     < PASS_MARK and exam ≥ SUPP_TRIGGER → retake (they failed on coursework,
 *                                           so resitting the exam cannot fix it)
 *
 *   A supplementary pass is RECORDED AS 50 however well they did, and the module
 *   is recalculated with that. Weak coursework can still leave the module under
 *   50, in which case the supp was passed but the module is retaken anyway —
 *   that is intended, not a bug.
 *
 *   End of semester: up to MAX_CARRIED unpassed modules and the student may
 *   progress, carrying them. More than that and they are discontinued.
 *
 *   There is no limit on retake attempts.
 */

import type { StudentModuleMark } from './moduleMark';

/** A module is passed at 50%. */
export const PASS_MARK = 50;

/** Below this on the final exam, a failed module earns a supplementary. */
export const SUPP_TRIGGER = 45;

/** A passed supplementary is recorded as this, however high the actual score. */
export const SUPP_CAPPED_MARK = 50;

/** Unpassed modules a student may carry into the next semester. */
export const MAX_CARRIED_FAILURES = 2;

/** The exams.type value that marks an assessment as a supplementary. */
export const SUPP_EXAM_TYPE = 'Supplementary Exam';

export type Outcome = 'passed' | 'supp' | 'retake';

/**
 * What happens to a student on one module.
 *
 * `examMark` is the FINAL exam component — the 40% — not a coursework exam.
 * Written and Oral exams count toward coursework and are deliberately excluded:
 * the 45% rule is about the controlled final assessment.
 *
 * Returns null when nothing has been marked yet, so callers can distinguish
 * "not assessed" from "failed" — conflating those is how a student with no marks
 * ends up told to retake.
 */
export function moduleOutcome(moduleMark: number | null, examMark: number | null): Outcome | null {
  if (moduleMark === null) return null;
  if (moduleMark >= PASS_MARK) return 'passed';
  // Failed. A supplementary is only worth offering when the exam was the problem.
  if (examMark !== null && examMark < SUPP_TRIGGER) return 'supp';
  return 'retake';
}

/**
 * What a passed supplementary does to the module.
 *
 * The exam contribution is recomputed at the capped mark, keeping the original
 * coursework and practical. Passing the supp does NOT guarantee passing the
 * module — that depends on how weak the coursework was.
 */
export function outcomeAfterSupp(
  mark: StudentModuleMark,
  suppScore: number | null,
  hasPractical: boolean,
): { moduleMark: number; outcome: Outcome } {
  if (suppScore === null || suppScore < PASS_MARK) {
    // Supp not sat, or failed. The module is retaken.
    return { moduleMark: mark.moduleMark, outcome: 'retake' };
  }

  // Recalculate with the capped exam mark. Coursework weight is 40% when the
  // module has a practical component and 60% when it does not; the exam is
  // always 40%, and the practical the remaining 20%.
  const cwWeight = hasPractical ? 0.4 : 0.6;
  const cwPart = mark.theoryCWAvg === null ? 0 : mark.theoryCWAvg * cwWeight;
  const pracPart = hasPractical && mark.practicalMark !== null ? mark.practicalMark * 0.2 : 0;
  const examPart = SUPP_CAPPED_MARK * 0.4;

  const recalculated = Math.round(cwPart + pracPart + examPart);
  return {
    moduleMark: recalculated,
    outcome: recalculated >= PASS_MARK ? 'passed' : 'retake',
  };
}

/**
 * Is this semester's result settled enough to act on?
 *
 * Progression is automatic, so the moment it fires matters. A student must not
 * progress off the back of the first module a lecturer happens to mark — every
 * module they took that semester needs a settled outcome first, and any
 * supplementary must already have been sat.
 *
 * `outcomes` is what has been decided so far; `expectedModules` is how many
 * modules the student was taking. Fewer outcomes than modules means marking is
 * still in progress, whatever those outcomes say.
 */
export function semesterIsSettled(
  outcomes: Outcome[],
  expectedModules: number,
): { settled: boolean; reason: string } {
  if (expectedModules === 0) {
    return { settled: false, reason: 'No modules recorded for this semester.' };
  }
  if (outcomes.length < expectedModules) {
    return {
      settled: false,
      reason: `${outcomes.length} of ${expectedModules} modules marked — waiting on the rest.`,
    };
  }
  const pendingSupps = outcomes.filter(o => o === 'supp').length;
  if (pendingSupps > 0) {
    return {
      settled: false,
      reason: `${pendingSupps} supplementary exam(s) still to be sat.`,
    };
  }
  return { settled: true, reason: 'All modules settled.' };
}

export interface SemesterVerdict {
  passed: number;
  supp: number;
  retake: number;
  /** Modules not yet passed — supps and retakes together. */
  outstanding: number;
  /** True when the student may move to the next semester, carrying what they owe. */
  mayProgress: boolean;
  /** True when too many modules were failed and the student is discontinued. */
  discontinued: boolean;
  reason: string;
}

/**
 * Whether a student may move on at the end of a semester.
 *
 * IMPORTANT: only call this once supplementary results are in. A module awaiting
 * a supp is not yet failed, and counting it early would discontinue students who
 * go on to pass.
 */
export function semesterVerdict(outcomes: Outcome[]): SemesterVerdict {
  const passed = outcomes.filter(o => o === 'passed').length;
  const supp = outcomes.filter(o => o === 'supp').length;
  const retake = outcomes.filter(o => o === 'retake').length;
  const outstanding = supp + retake;

  if (supp > 0) {
    return {
      passed, supp, retake, outstanding,
      mayProgress: false,
      discontinued: false,
      reason: `${supp} supplementary exam(s) outstanding — the result is not settled until those are sat.`,
    };
  }

  if (retake > MAX_CARRIED_FAILURES) {
    return {
      passed, supp, retake, outstanding,
      mayProgress: false,
      discontinued: true,
      reason: `${retake} modules failed. More than ${MAX_CARRIED_FAILURES} is a discontinuation.`,
    };
  }

  return {
    passed, supp, retake, outstanding,
    mayProgress: true,
    discontinued: false,
    reason: retake === 0
      ? 'All modules passed.'
      : `${retake} module(s) to retake, carried into the next semester.`,
  };
}
