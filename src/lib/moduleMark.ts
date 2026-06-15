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

// Exam type → which section of the report it feeds.
export const THEORY_TYPES = ["Written Exam", "Oral Exam"];
export const FINAL_THEORY = "Final Theory Exam";
export const RECIPE_TYPE = "Recipe";
export const FINAL_PRAC = "Final Practical Exam";
export const FINAL_PRAC_THEO = "Final Practical Theory Exam";

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
  moduleMark: number;
}

// Compute one student's full module-mark breakdown. `scoreOf` returns the
// student's score for a given assessment id, or null when not yet marked.
export function computeStudentModuleMark(opts: {
  studentId: string;
  hasPractical: boolean;
  cat: ModuleAssessments;
  scoreOf: (studentId: string, assessmentId: string) => number | null;
}): StudentModuleMark {
  const { studentId, hasPractical, cat, scoreOf } = opts;
  // Non-practical modules weight coursework 60%; practical modules 40%.
  const cwWeight = hasPractical ? 0.4 : 0.6;

  // Theory CW: theory exams + assignments, averaged.
  const theoryCWScores = [
    ...cat.theoryCWExams.map((e) => scoreOf(studentId, e.id)),
    ...cat.assignments.map((a) => scoreOf(studentId, a.id)),
  ].filter((x) => x !== null) as number[];
  const theoryCWAvg = theoryCWScores.length ? avg(theoryCWScores) : null;
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
  const moduleMark = r2((theory40 ?? 0) + (prac20 ?? 0) + (final40 ?? 0));

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
  };
}
