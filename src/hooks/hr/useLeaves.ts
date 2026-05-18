import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface LeaveType {
  id: string;
  name: string;
  code: string | null;
  max_days: number;
  requires_approval: boolean;
  carry_forward: boolean;
  color: string | null;
  is_active: boolean;
  is_paid: boolean | null;
  requires_certificate: boolean | null;
  description: string | null;
  min_days_notice: number | null;
}

export interface LeaveAllocation {
  id: string;
  employee_id: string;
  leave_type_id: string;
  year: number;
  opening_balance: number;
  allocated_days: number;
  used_days: number;
  pending_days: number;
  remaining_days: number;
  updated_at: string | null;
  // joins
  employee_name?: string | null;
  employee_code?: string | null;
  leave_type_name?: string | null;
  leave_type_color?: string | null;
  leave_type_code?: string | null;
}

export interface LeaveRequest {
  id: string;
  employee_id: string | null;
  leave_type_id: string | null;
  start_date: string;
  end_date: string;
  number_of_days: number;
  num_days: number | null;
  reason: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  approved_by: string | null;
  approver_comment: string | null;
  approved_at: string | null;
  created_at: string;
  // Enhanced fields (from leave_enhancements migration)
  leave_ref: string | null;
  handover_notes: string | null;
  admin_notes: string | null;
  certificate_url: string | null;
  certificate_filename: string | null;
  applied_date: string | null;
  approved_date: string | null;
  // Multi-stage approval
  current_stage: string | null;
  required_stages: string[] | null;
  rejection_reason: string | null;
}

export interface LeaveRequestWithJoins extends LeaveRequest {
  employee_name?: string | null;
  employee_code?: string | null;
  leave_type_name?: string | null;
  leave_type_color?: string | null;
}

export function useLeaveTypes() {
  const [types, setTypes] = useState<LeaveType[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('leave_types')
      .select('*')
      .eq('is_active', true)
      .order('name');
    setTypes((data ?? []) as LeaveType[]);
    setLoading(false);
  }, []);

  useEffect(() => { void refetch(); }, [refetch]);

  return { types, loading, refetch };
}

export function useLeaveRequests(opts?: { employeeId?: string; status?: string }) {
  const [requests, setRequests] = useState<LeaveRequestWithJoins[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    // Disambiguate the employees embed — leave_requests has two FKs
    // to employees (employee_id and approved_by), so PostgREST needs
    // the explicit FK constraint name. Use the auto-generated name
    // `leave_requests_employee_id_fkey` (matches the migration's
    // REFERENCES clause). We only want the requesting employee here.
    let q = supabase
      .from('leave_requests')
      .select(
        '*, employees!leave_requests_employee_id_fkey(employee_name, employee_code), leave_types(name, color)',
      )
      .order('created_at', { ascending: false });
    if (opts?.employeeId) q = q.eq('employee_id', opts.employeeId);
    if (opts?.status && opts.status !== 'all') q = q.eq('status', opts.status);
    const { data, error: err } = await q;
    if (err) {
      setError(err.message);
      setRequests([]);
    } else {
      setRequests(
        (data ?? []).map((r: Record<string, unknown>) => ({
          ...(r as unknown as LeaveRequest),
          employee_name: (r.employees as { employee_name?: string } | null)?.employee_name ?? null,
          employee_code: (r.employees as { employee_code?: string } | null)?.employee_code ?? null,
          leave_type_name: (r.leave_types as { name?: string } | null)?.name ?? null,
          leave_type_color: (r.leave_types as { color?: string } | null)?.color ?? null,
        })),
      );
    }
    setLoading(false);
  }, [opts?.employeeId, opts?.status]);

  useEffect(() => { void refetch(); }, [refetch]);

  return { requests, loading, error, refetch };
}

export function useLeaveAllocations(opts?: { employeeId?: string; year?: number }) {
  const [allocations, setAllocations] = useState<LeaveAllocation[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    setLoading(true);
    let q = supabase
      .from('leave_allocations')
      .select('*, employees(employee_name, employee_code), leave_types(name, color, code)')
      .order('employee_id');
    if (opts?.employeeId) q = q.eq('employee_id', opts.employeeId);
    if (opts?.year) q = q.eq('year', opts.year);
    const { data } = await q;
    setAllocations(
      (data ?? []).map((r: Record<string, unknown>) => ({
        ...(r as unknown as LeaveAllocation),
        employee_name: (r.employees as { employee_name?: string } | null)?.employee_name ?? null,
        employee_code: (r.employees as { employee_code?: string } | null)?.employee_code ?? null,
        leave_type_name: (r.leave_types as { name?: string } | null)?.name ?? null,
        leave_type_color: (r.leave_types as { color?: string } | null)?.color ?? null,
        leave_type_code: (r.leave_types as { code?: string } | null)?.code ?? null,
      })),
    );
    setLoading(false);
  }, [opts?.employeeId, opts?.year]);

  useEffect(() => { void refetch(); }, [refetch]);
  return { allocations, loading, refetch };
}
