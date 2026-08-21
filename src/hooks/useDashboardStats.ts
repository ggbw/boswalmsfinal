/**
 * Dashboard figures, computed in the database.
 *
 * Each of these is a single small request returning already-summed numbers,
 * rather than downloading rows and reducing them in the browser. That matters
 * here: attendance grows by roughly 1,400 rows a week now that registers save,
 * and assessment_marks is already past 3,000 — a school-wide pass rate computed
 * client-side would get slower every term and would eventually be cut short by
 * the 1,000-row response cap.
 *
 * The functions are SECURITY DEFINER with a role check in their first statement,
 * so an aggregate can span rows the caller cannot read individually without
 * exposing those rows.
 */

import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface SchoolStats {
  active_students: number; total_students: number; teaching_staff: number;
  classes: number; modules: number; programmes: number;
  attendance_rate: number | null; registers_taken: number;
  assessments_set: number; assessments_marked: number;
  marks_recorded: number; pass_rate: number | null; at_risk_marks: number;
  applications: Record<string, number>;
  classes_no_modules: number; staff_no_modules: number; students_no_login: number;
}

export interface DepartmentStats {
  dept_id: string; dept_name: string;
  students: number; modules: number; lecturers: number;
  attendance_rate: number | null; pass_rate: number | null; marks_recorded: number;
}

export interface LecturerStats {
  classes: number; modules: number; students: number;
  ungraded_submissions: number; unmarked_assessments: number;
  registers_last_14d: number; attendance_rate: number | null;
}

export interface ModulePerformance {
  dept_id: string | null; dept_name: string | null;
  module_id: string; module_name: string;
  class_id: string; class_name: string;
  lecturers: string;
  students: number; marks_recorded: number;
  avg_mark: number | null; pass_rate: number | null; attendance_rate: number | null;
  unmarked_assessments: number;
}

export interface AttendanceTrendRow {
  week_start: string; dept_id: string | null; dept_name: string | null;
  present: number; sessions: number; rate: number | null;
}

export interface AtRiskRow {
  student_id: string; student_name: string;
  class_name: string; dept_name: string;
  avg_mark: number | null; attendance_rate: number | null;
  failing_marks: number; total_marks: number;
  reason: string;
}

function useRpc<T>(fn: string, enabled = true, args?: Record<string, unknown>) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data: res, error: err } = await supabase.rpc(fn as never, (args ?? undefined) as never);
      if (cancelled) return;
      // Surfaced, not swallowed — an empty dashboard and a failed one must not
      // look the same.
      setError(err?.message ?? null);
      setData((res as T) ?? null);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [fn, enabled, JSON.stringify(args ?? null)]);

  return { data, loading, error };
}

export const useSchoolStats     = (enabled = true) => useRpc<SchoolStats>('dashboard_school_stats', enabled);
export const useDepartmentStats = (enabled = true) => useRpc<DepartmentStats[]>('dashboard_department_stats', enabled);
export const useLecturerStats   = (enabled = true) => useRpc<LecturerStats>('dashboard_lecturer_stats', enabled);

export const useModulePerformance = (enabled = true) =>
  useRpc<ModulePerformance[]>('dashboard_module_performance', enabled);

export const useAttendanceTrend = (weeks = 12, enabled = true) =>
  useRpc<AttendanceTrendRow[]>('dashboard_attendance_trend', enabled, { weeks });

export const useAtRisk = (enabled = true) =>
  useRpc<AtRiskRow[]>('dashboard_at_risk', enabled);
