/** One module attempt on a transcript — only what choosing the latest needs. */
export interface Attempt {
  moduleId: string;
  mark: number;
  year: number;
  semester: number;
  attemptYear?: number;
  attemptSem?: number;
  retakeAttempt?: boolean;
  superseded?: boolean;
}

// When a module was taken more than once (a retake), only the latest attempt
// (highest calendar year, then semester) counts toward GPA/credits; earlier
// attempts are flagged "superseded" so they still display but don't count.
//
// Confirmed rule (UAT Sheet A): "Retake — the latest attempt counts."
// The class period alone could not tell attempts apart: a retake is normally sat
// with the NEXT intake, at the same year/semester level (equal rank → both
// counted, the module double-counted in GPA and credits), and a class's period
// moves on with its cohort (the ORIGINAL class could even outrank the retake).
// So the retake enrolment wins outright; the period only decides otherwise, and
// a remaining tie keeps one attempt — the best mark — never both.
export function flagSuperseded<T extends Attempt>(mods: T[]): (T & { superseded: boolean })[] {
  const rank = (m: T) =>
    m.retakeAttempt ? Number.MAX_SAFE_INTEGER : (m.attemptYear ?? m.year) * 100 + (m.attemptSem ?? m.semester);
  const winner: Record<string, number> = {};
  mods.forEach((m, i) => {
    const w = winner[m.moduleId];
    if (w === undefined) { winner[m.moduleId] = i; return; }
    const cur = mods[w];
    if (rank(m) > rank(cur) || (rank(m) === rank(cur) && m.mark > cur.mark)) winner[m.moduleId] = i;
  });
  return mods.map((m, i) => ({ ...m, superseded: winner[m.moduleId] !== i }));
}
