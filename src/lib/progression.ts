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
 *   End of semester: pass at least HALF the semester's modules (retakes
 *   excluded) and the student moves on, carrying what they did not pass. Fall
 *   short and they REPEAT the semester — taking only the modules they failed,
 *   not the whole curriculum. Nobody is excluded by this rule.
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

/**
 * A student must pass at least HALF the modules they took this semester.
 *
 * Retakes are excluded from the count — the rule is about the semester's own
 * curriculum, not modules being carried from earlier. Half is rounded UP: with
 * five modules a student must pass three, not two and a half.
 */
export const PASS_FRACTION = 0.5;

export function requiredPasses(moduleCount: number): number {
  return Math.ceil(moduleCount * PASS_FRACTION);
}

/**
 * How many times a student may attempt the same semester before it is referred.
 *
 * The system does NOT exclude anyone. Reaching this simply flags the student for
 * academic review — a person decides what happens, because ending someone's
 * studies is not a decision an automatic rule should make on its own. Set it to
 * 0 to turn the flag off entirely.
 */
export const MAX_SEMESTER_ATTEMPTS = 3;

/**
 * Has this student repeated a semester often enough to need reviewing?
 *
 * `attempts` is how many times they have registered for this same year and
 * semester, including the current one.
 */
export function needsAcademicReview(attempts: number): boolean {
  return MAX_SEMESTER_ATTEMPTS > 0 && attempts >= MAX_SEMESTER_ATTEMPTS;
}

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
  /** Modules counted toward the rule — this semester's own, excluding retakes. */
  counted: number;
  passed: number;
  supp: number;
  retake: number;
  /** How many passes were needed. */
  required: number;
  /** Modules not yet passed — supps and retakes together. */
  outstanding: number;
  /** May move to the next semester, carrying anything not passed. */
  mayProgress: boolean;
  /**
   * Must take this semester again — but ONLY the modules not passed, not the
   * whole curriculum. This is not an exclusion: the student stays enrolled and
   * repeats, which is why there is no "discontinued" outcome anywhere.
   */
  mustRepeat: boolean;
  reason: string;
}

/**
 * Whether a student may move on at the end of a semester.
 *
 * The rule: pass at least half the modules taken this semester, retakes
 * excluded. Fall short and the student REPEATS the semester, taking only the
 * modules they did not pass.
 *
 * `outcomes` must be the outcomes of THIS semester's own modules. Retakes being
 * carried are passed separately as `carriedOutcomes` — they are shown to the
 * student and stay owed, but they do not count for or against the rule.
 *
 * IMPORTANT: only call this once every module is fully marked and any
 * supplementary has been sat. A module awaiting a supp is not yet failed, and
 * judging early would discontinue students who go on to pass.
 */
export function semesterVerdict(
  outcomes: Outcome[],
  carriedOutcomes: Outcome[] = [],
): SemesterVerdict {
  const counted = outcomes.length;
  const passed = outcomes.filter(o => o === 'passed').length;
  const supp = [...outcomes, ...carriedOutcomes].filter(o => o === 'supp').length;
  const retake = [...outcomes, ...carriedOutcomes].filter(o => o === 'retake').length;
  const required = requiredPasses(counted);
  const outstanding = supp + retake;

  const base = { counted, passed, supp, retake, required, outstanding };

  // Nothing is settled while a supplementary is outstanding — it may yet pass.
  if (supp > 0) {
    return {
      ...base, mayProgress: false, mustRepeat: false,
      reason: `${supp} supplementary exam(s) outstanding — the result is not settled until those are sat.`,
    };
  }

  if (counted === 0) {
    return {
      ...base, mayProgress: false, mustRepeat: false,
      reason: 'No modules recorded for this semester.',
    };
  }

  if (passed < required) {
    // Repeat the semester, taking ONLY what was not passed. The student is not
    // excluded and does not redo modules they already passed.
    return {
      ...base, mayProgress: false, mustRepeat: true,
      reason: `Passed ${passed} of ${counted} modules — at least ${required} are needed to move on. `
            + `This semester is repeated, taking only the ${counted - passed} module(s) not passed.`,
    };
  }

  return {
    ...base, mayProgress: true, mustRepeat: false,
    reason: passed === counted
      ? `All ${counted} modules passed.`
      : `Passed ${passed} of ${counted} (${required} required). ${counted - passed} module(s) carried as retakes.`,
  };
}
