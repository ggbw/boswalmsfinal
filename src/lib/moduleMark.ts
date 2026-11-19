// Shared module-mark computation.
//
// The institute's module mark is built from individual assessment scores stored
// in the `assessment_marks` table (one row per student per exam/assignment).
// This is the single source of truth used by the Class Report (ReportsPage) and
// the academic transcript (TranscriptsPage) so the two can never diverge.
//
// Weighting:
//   • Non-practical modules: Coursework 60% + Final Theory Exam 40%
//   • Practical modules:     Coursework 40% + Practical 20% + Final Theory Exam 40%
//   • Practical mark itself:  Practical CW (+ recipes) 70% + Final Practical 20%
//                             + Final Practical Theory 10%
//
// Coursework is FOUR slots — Test 1, Test 2, Individual Assignment and Group
// Assignment — each worth an equal share (15% of a theory module, 10% of a
// practical one). A slot with no mark yet counts as 0, exactly as the academic
// office's manual sheet does (UAT retest, Figure 13: 79, 45, 66 and no group
// assignment → 11.85 + 6.75 + 9.9 = 28.5, + 73 × 40% = 29.2 → 58). Averaging
// only the marks that existed gave 67. When more than four coursework
// assessments are set, the share is split across all of them.
//
// A passed supplementary is applied here too (exam counted as 50), so every
// screen that shows a module mark — results, dashboard, report, transcript —
// shows the same figure (UAT retest corrections 3, 5, 6, 8).

import { roundMark } from "./grading";
// (PASS/SUPP constants are mirrored from progression.ts to avoid an import cycle;
//  the tests assert they agree.)

// Exam type → which section of the report it feeds.
export const THEORY_TYPES = ["Written Exam", "Oral Exam"];
export const FINAL_THEORY = "Final Theory Exam";
export const RECIPE_TYPE = "Recipe";
export const FINAL_PRAC = "Final Practical Exam";
export const FINAL_PRAC_THEO = "Final Practical Theory Exam";
export const SUPP_TYPE = "Supplementary Exam";

/** Coursework slots in the institute's scheme (Test 1, Test 2, Indiv., Group). */
export const COURSEWORK_SLOTS = 4;
/** Supplementary: offered when the final exam is below this; pass recorded as 50. */
const SUPP_TRIGGER = 45;
const SUPP_CAPPED = 50;
const PASS = 50;

export function r2(n: number) {
  return Math.round(n * 100) / 100;
}
export function avg(nums: number[]) {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}

interface ExamLike {
  id: string;
  type?: string;
  name?: string;
}
interface AssignmentLike {
  id: string;
  title?: string;
}

export interface ModuleAssessments {
  theoryCWExams: ExamLike[];
  finalTheoryExam: ExamLike | undefined;
  practicalCWExams: ExamLike[];
  recipeExams: ExamLike[];
  finalPracExam: ExamLike | undefined;
  finalPracTheo: ExamLike | undefined;
  assignments: AssignmentLike[];
  /** The module's supplementary exam for this class, if one has been set. */
  suppExam?: ExamLike | undefined;
}

// Split a module's exams/assignments into the buckets the weighting needs.
export function categorizeModuleAssessments(
  exams: ExamLike[],
  assignments: AssignmentLike[],
): ModuleAssessments {
  return {
    theoryCWExams: exams.filter((e) => THEORY_TYPES.includes(e.type || "Written Exam")),
    finalTheoryExam: exams.find((e) => e.type === FINAL_THEORY),
    // All exams with "practical" in their type, excluding the specific final ones.
    practicalCWExams: exams.filter(
      (e) => (e.type || "").toLowerCase().includes("practical") && e.type !== FINAL_PRAC && e.type !== FINAL_PRAC_THEO,
    ),
    recipeExams: exams.filter((e) => e.type === RECIPE_TYPE),
    finalPracExam: exams.find((e) => e.type === FINAL_PRAC),
    finalPracTheo: exams.find((e) => e.type === FINAL_PRAC_THEO),
    assignments,
    suppExam: exams.find((e) => e.type === SUPP_TYPE),
  };
}

export interface StudentModuleMark {
  theoryCWAvg: number | null;
  theory40: number | null;
  finalTheory: number | null;
  final40: number | null;
  practicalCWAvg: number | null;
  recipeAvg: number | null;
  allPracCWAvg: number | null;
  pracCW70: number | null;
  finalPrac: number | null;
  finalPrac20: number | null;
  finalPracT: number | null;
  finalPracT10: number | null;
  practicalMark: number | null;
  prac20: number | null;
  /**
   * The module mark, rounded to a WHOLE number half up (69.5 → 70, 49.5 → 50).
   * This is the one figure every screen shows, grades and judges pass/fail on,
   * so the transcript, class report, student results and progression always
   * agree (UAT R1/M1). Rounded here, once, rather than by each caller.
   */
  moduleMark: number;
  /** The unrounded (2 dp) sum of the parts — for breakdown columns only. */
  rawModuleMark: number;
  /** The module mark before any supplementary was applied (rounded). */
  originalModuleMark: number;
  /** The student's supplementary exam score, when one has been sat. */
  suppScore: number | null;
  /** Result of a sat supplementary: passed (exam counted as 50) or retake. */
  suppOutcome: "passed" | "retake" | null;
}

// Compute one student's full module-mark breakdown. `scoreOf` returns the
// student's score for a given assessment id, or null when not yet marked.
export function computeStudentModuleMark(opts: {
  studentId: string;
  hasPractical: boolean;
  cat: ModuleAssessments;
  scoreOf: (studentId: string, assessmentId: string) => number | null;
  /** Coursework slots for this module (modules.coursework_items); default 4. */
  courseworkSlots?: number | null;
}): StudentModuleMark {
  const { studentId, hasPractical, cat, scoreOf } = opts;
  const configuredSlots = opts.courseworkSlots && opts.courseworkSlots > 0 ? opts.courseworkSlots : COURSEWORK_SLOTS;
  // Non-practical modules weight coursework 60%; practical modules 40%.
  const cwWeight = hasPractical ? 0.4 : 0.6;

  // Theory CW: theory exams + assignments over at least four slots; a slot
  // with no mark counts as 0 (see the header).
  const theoryCWItems = [...cat.theoryCWExams, ...cat.assignments];
  const theoryCWScores = theoryCWItems
    .map((a) => scoreOf(studentId, a.id))
    .filter((x) => x !== null) as number[];
  const slots = Math.max(configuredSlots, theoryCWItems.length);
  const theoryCWAvg = theoryCWScores.length
    ? theoryCWScores.reduce((a, b) => a + b, 0) / slots
    : null;
  const theory40 = theoryCWAvg !== null ? r2(theoryCWAvg * cwWeight) : null;

  // Final theory exam.
  const finalTheory = cat.finalTheoryExam ? scoreOf(studentId, cat.finalTheoryExam.id) : null;
  const final40 = finalTheory !== null ? r2(finalTheory * 0.4) : null;

  // Practical CW (non-final practical exams) and recipes.
  const practicalCWScores = cat.practicalCWExams
    .map((e) => scoreOf(studentId, e.id))
    .filter((x) => x !== null) as number[];
  const practicalCWAvg = practicalCWScores.length ? avg(practicalCWScores) : null;

  const recipeScores = cat.recipeExams.map((e) => scoreOf(studentId, e.id)).filter((x) => x !== null) as number[];
  const recipeAvg = recipeScores.length ? avg(recipeScores) : null;

  // Combined practical CW (practicalCW + recipes) → 70%.
  const allPracCWScores = [...practicalCWScores, ...recipeScores];
  const allPracCWAvg = allPracCWScores.length ? avg(allPracCWScores) : null;
  const pracCW70 = allPracCWAvg !== null ? r2(allPracCWAvg * 0.7) : null;

  // Final practical (20%) and final practical theory (10%).
  const finalPrac = cat.finalPracExam ? scoreOf(studentId, cat.finalPracExam.id) : null;
  const finalPrac20 = finalPrac !== null ? r2(finalPrac * 0.2) : null;
  const finalPracT = cat.finalPracTheo ? scoreOf(studentId, cat.finalPracTheo.id) : null;
  const finalPracT10 = finalPracT !== null ? r2(finalPracT * 0.1) : null;

  // Practical mark, then its 20% contribution to the module.
  const pracParts = [pracCW70, finalPrac20, finalPracT10].filter((x) => x !== null) as number[];
  const practicalMark = pracParts.length ? r2(pracParts.reduce((a, b) => a + b, 0)) : null;
  // Non-practical modules contribute nothing from the practical section.
  const prac20 = hasPractical && practicalMark !== null ? r2(practicalMark * 0.2) : null;

  // Module mark — always calculated, missing parts treated as 0.
  const rawModuleMark = r2((theory40 ?? 0) + (prac20 ?? 0) + (final40 ?? 0));
  const originalModuleMark = roundMark(rawModuleMark);
  let moduleMark = originalModuleMark;

  // Supplementary: only for a failed module whose final exam was below 45%.
  const suppScore = cat.suppExam ? scoreOf(studentId, cat.suppExam.id) : null;
  let suppOutcome: "passed" | "retake" | null = null;
  if (suppScore !== null && originalModuleMark < PASS && finalTheory !== null && finalTheory < SUPP_TRIGGER) {
    if (suppScore >= PASS) {
      // Exam counted as 50; coursework and practical kept as they were.
      moduleMark = roundMark((theory40 ?? 0) + (prac20 ?? 0) + SUPP_CAPPED * 0.4);
      suppOutcome = moduleMark >= PASS ? "passed" : "retake";
    } else {
      suppOutcome = "retake";
    }
  }

  return {
    theoryCWAvg,
    theory40,
    finalTheory,
    final40,
    practicalCWAvg,
    recipeAvg,
    allPracCWAvg,
    pracCW70,
    finalPrac,
    finalPrac20,
    finalPracT,
    finalPracT10,
    practicalMark,
    prac20,
    moduleMark,
    rawModuleMark,
    originalModuleMark,
    suppScore,
    suppOutcome,
  };
}
