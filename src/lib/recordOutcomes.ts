/**
 * Settling a student's module results, and telling them.
 *
 * WHY OUTCOMES ARE STORED RATHER THAN ALWAYS RECOMPUTED
 *   A module outcome is derived from marks, but it is a DECISION with
 *   consequences — it drives who sits a supplementary, what a student owes, and
 *   whether they are discontinued. If it were recalculated on every render, a
 *   late mark correction could silently un-fail a student who had already been
 *   told to retake, or re-fail one who had been cleared. Recording it means the
 *   decision is traceable and stable, and a later mark change is visible as a
 *   difference rather than an invisible reversal.
 *
 * WHY NOTIFICATIONS GO TO user_notifications
 *   The `notifications` table is a broadcast — every signed-in account reads
 *   every row — so it cannot carry "you have a supplementary in Pastry". Per-user
 *   notices need the per-user table.
 */

import { supabase } from '@/integrations/supabase/client';
import type { Student } from '@/data/db';
import type { ModuleStanding } from '@/hooks/useStudentProgress';

/** Existing outcome rows for a student, keyed module|year|semester. */
async function existingOutcomes(studentId: string) {
  const { data } = await supabase
    .from('module_outcomes' as never)
    .select('id,module_id,year,semester,outcome')
    .eq('student_id', studentId);
  const map = new Map<string, { id: string; outcome: string }>();
  ((data || []) as unknown as { id: string; module_id: string; year: number; semester: number; outcome: string }[])
    .forEach(r => map.set(`${r.module_id}|${r.year}|${r.semester}`, { id: r.id, outcome: r.outcome }));
  return map;
}

export interface RecordResult {
  written: number;
  suppsNotified: number;
  error: string | null;
}

/**
 * Write this student's settled outcomes, and notify them of any NEW supplementary.
 *
 * Only writes where the outcome has changed, so re-running is cheap and does not
 * re-notify. A student is told about a supplementary exactly once — being told
 * twice reads as two separate exams to sit.
 */
export async function recordOutcomes(opts: {
  student: Student;
  standings: ModuleStanding[];
  authUserId?: string | null;
  decidedBy?: string | null;
}): Promise<RecordResult> {
  const { student, standings, authUserId, decidedBy } = opts;

  // Only settled modules. An unmarked module has no outcome to record, and
  // writing one would assert a result nobody has decided.
  const decided = standings.filter(s => s.outcome !== null);
  if (decided.length === 0) return { written: 0, suppsNotified: 0, error: null };

  let existing: Map<string, { id: string; outcome: string }>;
  try {
    existing = await existingOutcomes(student.id);
  } catch (err) {
    return { written: 0, suppsNotified: 0, error: err instanceof Error ? err.message : 'Could not read outcomes' };
  }

  const rows: Record<string, unknown>[] = [];
  const newSupps: ModuleStanding[] = [];

  for (const s of decided) {
    const key = `${s.result.module.id}|${student.year}|${student.semester}`;
    const prev = existing.get(key);
    if (prev?.outcome === s.outcome) continue;   // unchanged — nothing to write

    rows.push({
      id: prev?.id || `mo_${student.id}_${s.result.module.id}_${student.year}_${student.semester}`,
      student_id: student.id,
      module_id: s.result.module.id,
      class_id: student.classId,
      year: student.year,
      semester: student.semester,
      module_mark: s.result.mark.moduleMark,
      exam_mark: s.examMark,
      outcome: s.outcome,
      supp_mark: s.suppMark,
      decided_by: decidedBy ?? null,
    });

    // Notify only on a NEW supplementary — not on every recalculation.
    if (s.outcome === 'supp' && prev?.outcome !== 'supp') newSupps.push(s);
  }

  if (rows.length === 0) return { written: 0, suppsNotified: 0, error: null };

  const { error } = await supabase.from('module_outcomes' as never).upsert(rows as never, { onConflict: 'id' } as never);
  if (error) return { written: 0, suppsNotified: 0, error: error.message };

  // The notification must not be able to fail the recording — the outcome is
  // the record of consequence; the notice is a courtesy on top of it.
  let notified = 0;
  if (authUserId && newSupps.length) {
    const notes = newSupps.map(s => ({
      user_id: authUserId,
      title: 'Supplementary exam',
      message:
        `You have a supplementary exam in ${s.result.module.name}. `
        + `Your module mark was ${s.result.mark.moduleMark}% and your exam mark `
        + `${s.examMark ?? '—'}%. The pass mark for a supplementary is 50%, and a `
        + `pass is recorded as 50%.`,
      type: 'supplementary',
      related_id: s.result.module.id,
    }));
    const { error: noteErr } = await supabase.from('user_notifications' as never).insert(notes as never);
    if (!noteErr) notified = notes.length;
  }

  return { written: rows.length, suppsNotified: notified, error: null };
}
