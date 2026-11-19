/**
 * How a module result is SHOWN — one rule for every student-facing screen
 * (dashboard, My Modules, My Results, the staff student panel).
 *
 * UAT retest 18 Nov, correction 4: the dashboard printed "45% Fail" for a
 * module while saying "0 of 6 modules marked". A module that is still being
 * marked has no grade yet; it is "In progress". Corrections 3, 5, 6: a sat
 * supplementary was invisible — the result now says so and shows the score.
 */
import { grade, gradeColor } from '@/data/db';
import type { StudentModuleResult } from './studentMarks';
import { PASS_MARK, SUPP_TRIGGER } from './progression';

export type DisplayKind = 'in-progress' | 'passed' | 'supp-due' | 'retake';

export interface ResultDisplay {
  kind: DisplayKind;
  /** Badge text: the grade word, "In progress" or "Supplementary due". */
  label: string;
  badgeClass: string;
  /** Short explanation shown under / beside the mark. */
  note: string | null;
  /** True once every assessment (final exam included) is marked. */
  final: boolean;
}

export function resultDisplay(r: StudentModuleResult): ResultDisplay {
  const m = r.mark;
  if (!r.fullyMarked) {
    const what = r.finalExamSet
      ? `${r.markedCount} of ${r.assessmentCount} assessments marked`
      : `${r.markedCount} of ${r.assessmentCount} marked · final exam not yet set`;
    return { kind: 'in-progress', label: 'In progress', badgeClass: 'badge-pending', note: `${what} — mark so far`, final: false };
  }
  if (m.suppOutcome === 'passed') {
    const g = grade(m.moduleMark);
    return {
      kind: 'passed', label: g, badgeClass: gradeColor(g), final: true,
      note: `Supplementary ${m.suppScore}% — passed, exam counted as 50% (was ${m.originalModuleMark}%)`,
    };
  }
  if (m.suppOutcome === 'retake') {
    return {
      kind: 'retake', label: 'Fail', badgeClass: 'badge-fail', final: true,
      note: `Supplementary ${m.suppScore}% — not passed, module to be retaken`,
    };
  }
  if (m.moduleMark < PASS_MARK) {
    if (m.finalTheory !== null && m.finalTheory < SUPP_TRIGGER) {
      return { kind: 'supp-due', label: 'Supplementary due', badgeClass: 'badge-active', final: true,
        note: `Final exam ${m.finalTheory}% — supplementary exam to be written` };
    }
    return { kind: 'retake', label: 'Fail', badgeClass: 'badge-fail', final: true, note: 'Module to be retaken' };
  }
  const g = grade(m.moduleMark);
  return { kind: 'passed', label: g, badgeClass: gradeColor(g), final: true, note: null };
}
