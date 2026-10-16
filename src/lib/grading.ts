// Shared grading scale — the single source of truth for both the academic
// transcript (TranscriptsPage) and the class report (ReportsPage), so the two can
// never show a different grade for the same mark.
//
// University letter-grade scale with +/- bands. A module is passed at 50% (C-),
// the same pass mark progression uses; below 50 is a fail (F).

import { PASS_MARK } from "./progression";

export { PASS_MARK };

export function letterGrade(pct: number): string {
  if (pct >= 86) return "A";
  if (pct >= 80) return "A-";
  if (pct >= 75) return "B+";
  if (pct >= 70) return "B";
  if (pct >= 65) return "B-";
  if (pct >= 60) return "C+";
  if (pct >= 55) return "C";
  if (pct >= PASS_MARK) return "C-";
  return "F";
}

// Grade points on a 4.0 scale.
export function gradePoint(letter: string): number {
  const m: Record<string, number> = {
    A: 4.0,
    "A-": 3.7,
    "B+": 3.3,
    B: 3.0,
    "B-": 2.7,
    "C+": 2.3,
    C: 2.0,
    "C-": 1.7,
    F: 0.0,
  };
  return m[letter] ?? 0;
}

// All letter grades, best → worst. Used to order grade-distribution columns.
export const LETTER_ORDER = ["A", "A-", "B+", "B", "B-", "C+", "C", "C-", "F"] as const;

// Grading scale shown to users (percentage band · grade point). Matches the
// scale printed at the foot of the transcript.
export const GRADE_SCALE: [string, string][] = [
  ["A", "86–100% · 4.0"],
  ["A-", "80–85% · 3.7"],
  ["B+", "75–79% · 3.3"],
  ["B", "70–74% · 3.0"],
  ["B-", "65–69% · 2.7"],
  ["C+", "60–64% · 2.3"],
  ["C", "55–59% · 2.0"],
  ["C-", "50–54% · 1.7"],
  ["F", "0–49% · 0.0 (Fail)"],
];

// Badge CSS class for a letter grade, grouped into the report's existing colour
// tiers (A family → distinction … F → fail).
export function letterBadgeClass(letter: string): string {
  if (letter === "A" || letter === "A-") return "badge-distinction";
  if (letter === "B+" || letter === "B" || letter === "B-") return "badge-merit";
  if (letter === "C+" || letter === "C" || letter === "C-") return "badge-credit";
  return "badge-fail";
}
