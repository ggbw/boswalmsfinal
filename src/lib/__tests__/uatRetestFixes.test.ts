// Fixes for the Boswa UAT retest report (Nov 2026): rounding (R1/M1),
// supplementary/retake (M3), progression (M4 / 6.2).
import { describe, it, expect } from 'vitest';
import type { DB, Student } from '@/data/db';
import { grade } from '@/data/db';
import { categorizeModuleAssessments, computeStudentModuleMark } from '../moduleMark';
import { studentModuleResults } from '../studentMarks';
import { outcomeAfterSupp, isAllowedPeriodMove, SUPP_EXAM_TYPE } from '../progression';
import { buildStudentProgress } from '@/hooks/useStudentProgress';

const scoresFrom = (m: Record<string, number>) =>
  (_s: string, id: string) => (id in m ? m[id] : null);

describe('R1/M1 — one rounded module mark everywhere', () => {
  // Coursework 62.5 × 0.6 = 37.5 + final 30 × 0.4 = 12 → 49.5
  const cat = categorizeModuleAssessments(
    [{ id: 'cw1', type: 'Written Exam' }, { id: 'cw2', type: 'Written Exam' }, { id: 'fin', type: 'Final Theory Exam' }],
    [],
  );
  const mk = computeStudentModuleMark({
    studentId: 'S1', hasPractical: false, cat,
    scoreOf: scoresFrom({ cw1: 60, cw2: 65, fin: 30 }),
  });

  it('keeps the unrounded figure for breakdowns', () => {
    expect(mk.rawModuleMark).toBeCloseTo(49.5, 2);
  });
  it('rounds the module mark half up, once (49.5 → 50)', () => {
    expect(mk.moduleMark).toBe(50);
  });
  it('the student-facing grade() rounds too, so 49.5 is a Pass, not a Fail', () => {
    expect(grade(49.5)).toBe('Pass');
    expect(grade(49.4)).toBe('Fail');
    expect(grade(69.5)).toBe('Merit');
  });
});

describe('M3 — supplementary applied, capped at 50', () => {
  const base = computeStudentModuleMark({
    studentId: 'S1', hasPractical: false,
    cat: categorizeModuleAssessments(
      [{ id: 'cw', type: 'Written Exam' }, { id: 'fin', type: 'Final Theory Exam' }], []),
    scoreOf: scoresFrom({ cw: 70, fin: 30 }),       // 70×.6 = 42 + 30×.4 = 12 → 54
  });
  it('a passed supp recalculates the module with the exam at 50', () => {
    const weak = { ...base, theoryCWAvg: 60 };        // 60×.6 = 36 + 50×.4 = 20 → 56
    expect(outcomeAfterSupp(weak, 90, false)).toEqual({ moduleMark: 56, outcome: 'passed' });
  });
  it('a failed supp means retake', () => {
    expect(outcomeAfterSupp(base, 40, false).outcome).toBe('retake');
  });
});

// A tiny school: one Diploma class in Year 1 Semester 1 with one theory module.
function school(exams: { id: string; type: string }[], opts: { year?: number; semester?: number } = {}) {
  const student = {
    id: 'stu1', studentId: 'BCI-1', name: 'Test', classId: 'c1', programme: 'p1',
    year: opts.year ?? 1, semester: opts.semester ?? 1,
  } as unknown as Student;
  const db = {
    students: [student],
    classes: [{ id: 'c1', programme: 'p1', year: 1, semester: 1 }],
    modules: [
      { id: 'm1', name: 'Module One', classes: ['c1'], hasPractical: false },
      { id: 'm2', name: 'Module Two (Sem 2)', classes: ['c1'], hasPractical: false },
    ],
    programmeModules: [
      { programmeId: 'p1', moduleId: 'm1', year: 1, semester: 1 },
      { programmeId: 'p1', moduleId: 'm2', year: 1, semester: 2 },
    ],
    studentModules: [],
    exams: exams.map(e => ({ ...e, moduleId: 'm1', classId: 'c1', name: e.id })),
    assignments: [],
    config: { programmes: [{ id: 'p1', semesters: 2, years: 2 }] },
  } as unknown as DB;
  return { db, student };
}

describe('M3 / dashboard — no outcome before the final exam', () => {
  it('coursework alone gives no outcome (used to say "retake")', () => {
    const { db, student } = school([{ id: 'cw', type: 'Written Exam' }]);
    const p = buildStudentProgress(db, student, scoresFrom({ cw: 20 }), null);
    expect(p.standings.find(s => s.result.module.id === 'm1')?.outcome).toBeNull();
    expect(p.owed).toHaveLength(0);
  });

  it('final exam under 45 → supplementary, and it is recordable straight away', () => {
    const { db, student } = school([{ id: 'cw', type: 'Written Exam' }, { id: 'fin', type: 'Final Theory Exam' }]);
    const p = buildStudentProgress(db, student, scoresFrom({ cw: 60, fin: 30 }), null); // 36 + 12 = 48
    expect(p.standings[0].outcome).toBe('supp');
    expect(p.allDecided).toBe(true);   // recorded even though not "settled"
    expect(p.settled).toBe(false);
  });

  it('a sat supplementary decides the module, and does not un-mark classmates', () => {
    const { db, student } = school([
      { id: 'cw', type: 'Written Exam' }, { id: 'fin', type: 'Final Theory Exam' },
      { id: 'sup', type: SUPP_EXAM_TYPE },
    ]);
    const results = studentModuleResults(db, student, scoresFrom({ cw: 60, fin: 30 }));
    expect(results.find(r => r.module.id === 'm1')?.fullyMarked).toBe(true); // supp row not counted
    const p = buildStudentProgress(db, student, scoresFrom({ cw: 60, fin: 30, sup: 75 }), null);
    expect(p.standings[0].outcome).toBe('passed');          // 36 + 50×.4 = 56
    expect(p.standings[0].moduleMark).toBe(56);
  });
});

describe('M4 / 6.2 — progression', () => {
  it('judges only the current semester\'s curriculum modules', () => {
    const { db, student } = school([{ id: 'fin', type: 'Final Theory Exam' }], { semester: 2 });
    const p = buildStudentProgress(db, student, scoresFrom({ fin: 10 }), null);
    // m1 belongs to semester 1 — after promotion to semester 2 it is not re-judged.
    expect(p.standings.map(s => s.result.module.id)).toEqual(['m2']);
  });

  it('allows one semester forward, never a jump', () => {
    expect(isAllowedPeriodMove({ year: 1, semester: 1 }, { year: 1, semester: 2 }, 2)).toBe(true);
    expect(isAllowedPeriodMove({ year: 1, semester: 2 }, { year: 2, semester: 1 }, 2)).toBe(true);
    expect(isAllowedPeriodMove({ year: 1, semester: 1 }, { year: 3, semester: 1 }, 2)).toBe(false);
    expect(isAllowedPeriodMove({ year: 1, semester: 1 }, { year: 2, semester: 1 }, 2)).toBe(false);
    expect(isAllowedPeriodMove({ year: 2, semester: 1 }, { year: 1, semester: 2 }, 2)).toBe(true); // repeat/correction
  });
});

describe('Sheet A — "Retake: the latest attempt counts" (transcript)', () => {
  // flagSuperseded is imported lazily so this block stays self-contained.
  it('the retake enrolment wins, even when its class period looks older or equal', async () => {
    const { flagSuperseded } = await import('../transcriptAttempts');
    const out = flagSuperseded([
      // Original attempt: own class, which has since moved on to Y2S1.
      { moduleId: 'm1', mark: 30, year: 1, semester: 1, attemptYear: 2, attemptSem: 1 },
      // Retake with the next intake, still at Y1S1.
      { moduleId: 'm1', mark: 62, year: 1, semester: 1, attemptYear: 1, attemptSem: 1, retakeAttempt: true },
    ]);
    expect(out.map(m => m.superseded)).toEqual([true, false]);
  });

  it('never counts both attempts when their periods are equal', async () => {
    const { flagSuperseded } = await import('../transcriptAttempts');
    const out = flagSuperseded([
      { moduleId: 'm1', mark: 40, year: 1, semester: 1, attemptYear: 1, attemptSem: 1 },
      { moduleId: 'm1', mark: 55, year: 1, semester: 1, attemptYear: 1, attemptSem: 1 },
    ]);
    expect(out.filter(m => !m.superseded)).toHaveLength(1);
  });

  it('otherwise the later period counts', async () => {
    const { flagSuperseded } = await import('../transcriptAttempts');
    const out = flagSuperseded([
      { moduleId: 'm1', mark: 70, year: 1, semester: 1, attemptYear: 1, attemptSem: 1 },
      { moduleId: 'm1', mark: 52, year: 1, semester: 1, attemptYear: 1, attemptSem: 2 },
    ]);
    expect(out.map(m => m.superseded)).toEqual([true, false]);
  });
});
