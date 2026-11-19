/**
 * Marks, from the table that actually holds them.
 *
 * There are two marks tables. `marks` is the original design — one wide row per
 * student per module (test1, test2, pract_test, ind_ass, grp_ass, final_exam).
 * `assessment_marks` replaced it: one row per student per individual assessment,
 * and it is where every mark entered through Exams or Assignments now goes.
 *
 * `marks` was never retired, and every screen still reading it filters by the
 * human student number while its rows are keyed by `students.id` — so those
 * filters match nothing and the screens show blanks. ReportsPage hit this,
 * diagnosed it in a comment, and moved itself to `assessment_marks`;
 * TranscriptsPage followed. The rest never did.
 *
 * Verified 2026-08-12: all 20 rows in `marks` are duplicated in
 * `assessment_marks`, so nothing is lost by reading only the latter.
 *
 * NOTE the key: `assessment_marks.student_id` holds the human student NUMBER
 * (e.g. BCI2025D-52), not `students.id`. That disagrees with `marks`,
 * `attendance` and `submissions`, which all use the record key. Pass
 * `student.studentId` here, never `student.id`.
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface Row { student_id: string; assessment_id: string; score: number }

/**
 * Supabase returns at most 1,000 rows per request. The staff Results, Grades
 * Overview and Progression pages ask for every class at once — well over 1,000
 * marks — and a single request was silently cut off there, so those pages saw
 * only part of the marks: whole modules and new marks were simply missing
 * (UAT 6.1 "marks not visible"; Results not showing a newly marked student).
 * Page through, ordered, until a short page says there is no more.
 */
const PAGE = 1000;
const HARD_CAP = 200_000;

/** Every assessment_marks row matching the filter, paged past the 1,000 cap. */
export async function fetchAssessmentMarks(filter: { classIds?: string[]; studentNumbers?: string[] }): Promise<{
  data: Row[]; error: { message: string } | null;
}> {
  const data: Row[] = [];
  for (let from = 0; from < HARD_CAP; from += PAGE) {
    let q = supabase.from('assessment_marks').select('id,student_id,assessment_id,score');
    if (filter.classIds?.length) q = q.in('class_id', filter.classIds);
    if (filter.studentNumbers?.length) q = q.in('student_id', filter.studentNumbers);
    const { data: page, error } = await q.order('id', { ascending: true }).range(from, from + PAGE - 1);
    if (error) return { data, error };
    (page || []).forEach((x: Record<string, unknown>) => data.push({
      student_id: String(x.student_id), assessment_id: String(x.assessment_id), score: Number(x.score),
    }));
    if (!page || page.length < PAGE) break;
  }
  return { data, error: null };
}

/**
 * Fetch the assessment marks needed by a screen.
 *
 * Scoped rather than loading everything: `assessment_marks` is the largest table
 * in the system (3,200+ rows and growing with every assessment), so pulling all
 * of it into a page that shows one student would be wasteful and would hit the
 * same row cap that made the bulk loader unreliable.
 */
export function useAssessmentMarks(filter: { classIds?: string[]; studentNumbers?: string[] }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Arrays are new objects on every render, so depend on their contents.
  const classKey = (filter.classIds || []).join(',');
  const studentKey = (filter.studentNumbers || []).join(',');

  useEffect(() => {
    // Nothing to scope by means nothing to fetch — avoids accidentally
    // selecting the whole table when a caller's ids haven't loaded yet.
    if (!classKey && !studentKey) {
      setRows([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error: err } = await fetchAssessmentMarks({
        classIds: classKey ? classKey.split(',') : undefined,
        studentNumbers: studentKey ? studentKey.split(',') : undefined,
      });
      if (cancelled) return;
      // Surfaced rather than swallowed — an empty list and a failed query must
      // not look the same, which is what made these faults so hard to place.
      setError(err?.message ?? null);
      setRows(data);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [classKey, studentKey]);

  const scoreMap = useMemo(() => {
    const m = new Map<string, number>();
    rows.forEach(r => m.set(`${r.student_id}|${r.assessment_id}`, r.score));
    return m;
  }, [rows]);

  /** Score for a student on one assessment, or null when not yet marked. */
  const scoreOf = useCallback(
    (studentNumber: string, assessmentId: string) => {
      const v = scoreMap.get(`${studentNumber}|${assessmentId}`);
      return v === undefined ? null : v;
    },
    [scoreMap],
  );

  return { scoreOf, loading, error, markCount: rows.length };
}
