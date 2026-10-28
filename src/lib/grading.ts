// Shared grading scale — the single source of truth for the academic transcript
// (TranscriptsPage) and the class report (ReportsPage), so the two can never show
// a different grade for the same mark.
//
// Boswa uses TWO award classifications, chosen by the student's programme level
// (confirmed 28 Oct 2026, from the "Award Classification" tables at the foot of
// the official transcript templates):
//
//   • DIPLOMA, Level 6  — A / B / C / D / F on a 5.0 grade-point scale.
//       80–100 A·5.0·Distinction · 70–79 B·4.0·Merit · 60–69 C·3.0·Credit
//       50–59 D·2.0·Pass        · below 50 F·0.0·Fail
//   • CERTIFICATE, Level 5 — D / M / C / P / F (no grade points, no GPA).
//       80–100 D·Distinction · 70–79 M·Merit · 60–69 C·Credit
//       50–59 P·Pass         · 0–49 F·Fail / Not Yet Competent
//
// WATCH OUT: "D" is a PASS on the Diploma scale but a DISTINCTION on the
// Certificate scale. Never mix them up — every function here takes the scale.
//
// A module is passed at 50% on both scales (PASS_MARK, shared with progression).
// Marks are rounded to a whole number BEFORE the grade is given (confirmed Q3),
// half up (69.5 → 70).
//
// The scales live here as DATA (GRADING_SCALES), not scattered constants, so the
// transcript, the report, exports and the student view all read one definition.

import { PASS_MARK } from "./progression";

export { PASS_MARK };

export type ScaleKey = "diploma" | "certificate" | "legacy";

// Which grading system is in force, system-wide. "boswa" = the two award scales
// chosen by programme level (the new, confirmed system). "legacy" = the old
// university letter scale (A, A-, B+ … F on 4.0) applied to every programme.
// A super-admin can switch back to "legacy" from the Transcripts page as a
// safety net. Stored in school_config.grading_system; defaults to "boswa".
export type GradingSystem = "boswa" | "legacy";

export interface GradeBand {
  /** Inclusive lower bound, on the ROUNDED whole-number mark. */
  min: number;
  /** Letter shown in the Grade column (A/B/C/D/F or D/M/C/P/F). */
  letter: string;
  /** Grade point on the 5.0 scale. Diploma only; undefined for Certificate. */
  point?: number;
  /** Academic standing word (Distinction / Merit / Credit / Pass / Fail). */
  standing: string;
  /** Long descriptor from the template's classification table. */
  descriptor: string;
}

export interface Scale {
  key: ScaleKey;
  /** Column headers used by the foot-of-transcript classification table. */
  headers: string[];
  /** Bands, HIGHEST first (so the first band whose `min` is met wins). */
  bands: GradeBand[];
  /** Whether a GPA is shown (Diploma only). */
  hasGpa: boolean;
}

// ── The two scales, taken word-for-word from the transcript templates ──────────

const DIPLOMA_SCALE: Scale = {
  key: "diploma",
  hasGpa: true,
  headers: ["Percentage Range", "Letter Grade", "Grade Point Value", "Academic Standing", "Practical Competence Level"],
  bands: [
    { min: 80, letter: "A", point: 5.0, standing: "Distinction", descriptor: "Excellent: Mastered technique; works independently with zero waste." },
    { min: 70, letter: "B", point: 4.0, standing: "Merit", descriptor: "Very Good: Confident execution; minimal supervisor correction." },
    { min: 60, letter: "C", point: 3.0, standing: "Credit", descriptor: "Good: Solid baseline execution; meets all safety and recipe codes." },
    { min: 50, letter: "D", point: 2.0, standing: "Pass", descriptor: "Competent: Satisfies minimum standards; requires supervision." },
    { min: 0, letter: "F", point: 0.0, standing: "Fail", descriptor: "Not Yet Competent: Safety risk / high waste / fails methods." },
  ],
};

const CERTIFICATE_SCALE: Scale = {
  key: "certificate",
  hasGpa: false,
  headers: ["Mark Range (%)", "Letter Grade", "Descriptor", "Definition for level 5 Competency"],
  bands: [
    { min: 80, letter: "D", standing: "Distinction", descriptor: "Demonstrates exceptional technical mastery, autonomy, and advanced trouble-shooting capacity." },
    { min: 70, letter: "M", standing: "Merit", descriptor: "Exceeds basic requirements with strong operational independence and analytical skills." },
    { min: 60, letter: "C", standing: "Credit", descriptor: "Demonstrated ability to independently apply specialized technical knowledge, execute complex operational procedures, and meeting all defined module learning outcomes without requiring constant direct supervision." },
    { min: 50, letter: "P", standing: "Pass", descriptor: "Minimum Competency Achieved. Can perform Level 5 tasks safely and correctly under broad supervision." },
    { min: 0, letter: "F", standing: "Fail / Not Yet Competent", descriptor: "Has not achieved the required module learning outcomes or failed critical safety benchmarks." },
  ],
};

// The OLD scale, kept so a super-admin can switch the whole system back to it.
// University letter grades with +/- bands on a 4.0 scale; a module passes at 50%
// (C-). Standings drive the badge colours exactly as the old letterBadgeClass
// did (A-family → distinction, B → merit, C → credit, F → fail).
const LEGACY_SCALE: Scale = {
  key: "legacy",
  hasGpa: true,
  headers: ["Percentage Range", "Letter Grade", "Grade Point Value", "Academic Standing"],
  bands: [
    { min: 86, letter: "A", point: 4.0, standing: "Distinction", descriptor: "" },
    { min: 80, letter: "A-", point: 3.7, standing: "Distinction", descriptor: "" },
    { min: 75, letter: "B+", point: 3.3, standing: "Merit", descriptor: "" },
    { min: 70, letter: "B", point: 3.0, standing: "Merit", descriptor: "" },
    { min: 65, letter: "B-", point: 2.7, standing: "Merit", descriptor: "" },
    { min: 60, letter: "C+", point: 2.3, standing: "Credit", descriptor: "" },
    { min: 55, letter: "C", point: 2.0, standing: "Credit", descriptor: "" },
    { min: 50, letter: "C-", point: 1.7, standing: "Credit", descriptor: "" },
    { min: 0, letter: "F", point: 0.0, standing: "Fail", descriptor: "" },
  ],
};

export const GRADING_SCALES: Record<ScaleKey, Scale> = {
  diploma: DIPLOMA_SCALE,
  certificate: CERTIFICATE_SCALE,
  legacy: LEGACY_SCALE,
};

export function getScale(scale: ScaleKey): Scale {
  return GRADING_SCALES[scale];
}

// ── Scale selection by programme ───────────────────────────────────────────────
// The scale depends on the PROGRAMME/LEVEL stored in the system, not the student
// number. Level 6 → Diploma, Level 5 → Certificate. The programme type/name is a
// fallback hint only. Defaults to Diploma when nothing else decides, and that
// default is flagged in the handover report as a "needs Boswa" item.
export function scaleForProgramme(prog?: { level?: number | null; type?: string | null; name?: string | null }): ScaleKey {
  if (prog?.level === 5) return "certificate";
  if (prog?.level === 6) return "diploma";
  const hint = `${prog?.type || ""} ${prog?.name || ""}`.toLowerCase();
  if (hint.includes("certificate")) return "certificate";
  if (hint.includes("diploma")) return "diploma";
  return "diploma";
}

/**
 * The scale actually in force for a programme, honouring the system-wide toggle.
 * When the super-admin has switched to the legacy system every programme uses the
 * old letter scale; otherwise the scale is chosen by programme level as above.
 */
export function activeScale(
  prog: { level?: number | null; type?: string | null; name?: string | null } | undefined,
  system: GradingSystem | undefined | null,
): ScaleKey {
  if (system === "legacy") return "legacy";
  return scaleForProgramme(prog);
}

// ── Rounding ───────────────────────────────────────────────────────────────────
/**
 * Round a mark to a whole number, half UP (69.5 → 70, 49.5 → 50).
 *
 * Pre-rounds to 6 decimal places first so binary-float dust (a value stored as
 * 69.49999999999999 that is really 69.5) rounds the way a human reading the
 * spreadsheet would expect. JS `Math.round` already rounds half up for positive
 * numbers, but `floor(x + 0.5)` on the cleaned value is explicit about it.
 */
export function roundMark(mark: number): number {
  const cleaned = Math.round(mark * 1e6) / 1e6;
  return Math.floor(cleaned + 0.5);
}

// ── Grading ────────────────────────────────────────────────────────────────────

/** The band a mark falls in on the given scale. Rounds the mark first. */
export function gradeBand(mark: number, scale: ScaleKey): GradeBand {
  const rounded = roundMark(mark);
  const bands = getScale(scale).bands;
  return bands.find((b) => rounded >= b.min) ?? bands[bands.length - 1];
}

/** The letter grade for a mark on the given scale (rounds the mark first). */
export function letterGrade(mark: number, scale: ScaleKey): string {
  return gradeBand(mark, scale).letter;
}

/** The academic standing word (Distinction / Merit / …) for a mark. */
export function standingFor(mark: number, scale: ScaleKey): string {
  return gradeBand(mark, scale).standing;
}

/**
 * Grade points for a letter on the given scale (Diploma 5.0 scale).
 * The Certificate scale has no grade points, so this returns 0 there.
 */
export function gradePoint(letter: string, scale: ScaleKey): number {
  const band = getScale(scale).bands.find((b) => b.letter === letter);
  return band?.point ?? 0;
}

/** All letter grades for a scale, best → worst (grade-distribution columns). */
export function letterOrder(scale: ScaleKey): string[] {
  return getScale(scale).bands.map((b) => b.letter);
}

/**
 * The grading scale shown to users as [label, range-text] pairs, matching the
 * foot of the transcript. Diploma rows include the grade point.
 */
export function gradeScaleDisplay(scale: ScaleKey): [string, string][] {
  const bands = getScale(scale).bands;
  return bands.map((b, i) => {
    const hi = i === 0 ? 100 : bands[i - 1].min - 1;
    const range = b.min === 0 ? `0–${hi}%` : `${b.min}–${hi}%`;
    const pt = b.point !== undefined ? ` · ${b.point.toFixed(1)}` : "";
    return [b.letter, `${range}${pt} · ${b.standing}`] as [string, string];
  });
}

/**
 * Badge CSS class for a mark/standing, grouped into the report's colour tiers.
 * Driven by the band's standing so it is correct on BOTH scales (Certificate
 * "D" = Distinction is gold; Diploma "D" = Pass is not).
 */
export function badgeClassFor(mark: number, scale: ScaleKey): string {
  return badgeForStanding(gradeBand(mark, scale).standing);
}

/** Badge class for a letter on a given scale. */
export function letterBadgeClass(letter: string, scale: ScaleKey): string {
  const band = getScale(scale).bands.find((b) => b.letter === letter);
  return badgeForStanding(band?.standing ?? "Fail");
}

// The five canonical standings, shared by both scales — used where one table
// spans classes on different scales (the Grade Overview), since the letters
// differ between scales but the standings do not.
export const STANDING_ORDER = ["Distinction", "Merit", "Credit", "Pass", "Fail"] as const;

/** The canonical standing bucket for a mark on a scale (rounds first). */
export function standingBucket(mark: number, scale: ScaleKey): string {
  const s = standingFor(mark, scale).toLowerCase();
  if (s.startsWith("distinction")) return "Distinction";
  if (s.startsWith("merit")) return "Merit";
  if (s.startsWith("credit")) return "Credit";
  if (s.startsWith("pass")) return "Pass";
  return "Fail";
}

function badgeForStanding(standing: string): string {
  const s = standing.toLowerCase();
  if (s.startsWith("distinction")) return "badge-distinction";
  if (s.startsWith("merit")) return "badge-merit";
  if (s.startsWith("credit") || s.startsWith("pass")) return "badge-credit";
  return "badge-fail";
}

// ── Certificate overall ────────────────────────────────────────────────────────
/**
 * The Certificate transcript has no GPA. Instead it shows "Total Marks (%)" = the
 * SIMPLE average of the module marks, rounded, plus an overall grade WORD
 * (e.g. 78 → MERIT). Verified against Atang Thako.DOCX: 11 module marks average
 * 78.18 → 78 → MERIT. (A credit-weighted average would give 76.38, which does
 * not match, so the simple average is correct.)
 */
export function certificateOverall(moduleMarks: number[]): { mark: number; grade: string } {
  if (!moduleMarks.length) return { mark: 0, grade: "" };
  const mean = moduleMarks.reduce((a, b) => a + b, 0) / moduleMarks.length;
  const mark = roundMark(mean);
  return { mark, grade: standingFor(mark, "certificate").toUpperCase() };
}

// ── Diploma GPA ────────────────────────────────────────────────────────────────
/**
 * Credit-weighted GPA on the 5.0 scale: Σ(gradePoint × credits) / Σ(credits).
 * Diploma only. `credit-weighted vs simple average` is still unconfirmed by
 * Boswa (the template's GPA cell is blank); credit-weighted is kept as the
 * current behaviour and flagged in the report.
 */
export function computeGpa(mods: { mark: number; credits: number }[], scale: ScaleKey = "diploma"): string {
  const totalCredits = mods.reduce((s, m) => s + m.credits, 0);
  if (!totalCredits) return "—";
  const weighted = mods.reduce((s, m) => s + gradePoint(letterGrade(m.mark, scale), scale) * m.credits, 0);
  return (weighted / totalCredits).toFixed(2);
}

// ── Finalised / issued results are never regraded ──────────────────────────────
/**
 * The grade to DISPLAY for a module result.
 *
 * New rule (decided 27 Oct 2026): the grading SYSTEM changes, but results that
 * have already been finalised or issued keep their original grade — they are
 * never recalculated under the new scale. Grades are normally computed live from
 * marks, so a finalised result carries its own recorded letter/scale and we hand
 * that back verbatim; everything else is graded fresh on the current scale.
 */
export interface RecordedResult {
  mark: number;
  /** A letter recorded when the result was finalised/issued. */
  finalizedGrade?: string | null;
  /** The scale under which it was finalised (for context; not recomputed). */
  finalizedScale?: ScaleKey | null;
}

export function displayGrade(result: RecordedResult, currentScale: ScaleKey): string {
  if (result.finalizedGrade) return result.finalizedGrade;
  return letterGrade(result.mark, currentScale);
}
