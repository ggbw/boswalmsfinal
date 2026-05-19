import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { reconcileStuckParentRows } from '@/lib/hr/workflowEngine';

export interface AdvanceSalary {
  id: string;
  reference: string;
  employee_id: string | null;
  request_date: string;
  loan_type: string | null;
  total_amount: number;
  monthly_installment: number;
  installments: number;
  remaining_amount: number | null;
  status: 'Draft' | 'Submitted' | 'Approved' | 'Rejected' | 'Completed';
  notes: string | null;
  created_at: string;
  // Multi-stage approval (see migration 20260514000002_approval_stages.sql).
  current_stage: string | null;
  required_stages: string[] | null;
  rejection_reason: string | null;
}

export interface AdvanceSalaryWithEmployee extends AdvanceSalary {
  employee_name?: string | null;
  employee_code?: string | null;
}

export function useAdvances(opts?: { employeeId?: string }) {
  const [advances, setAdvances] = useState<AdvanceSalaryWithEmployee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    const runQuery = async () => {
      let q = supabase
        .from('advance_salaries')
        .select('*, employees(employee_name, employee_code)')
        .order('created_at', { ascending: false });
      if (opts?.employeeId) q = q.eq('employee_id', opts.employeeId);
      return q;
    };
    let { data, error: err } = await runQuery();
    if (err) {
      setError(err.message);
      setAdvances([]);
      setLoading(false);
      return;
    }
    // Heal rows still marked 'Submitted' whose workflow instance is terminal.
    const stuckIds = ((data ?? []) as Array<{ id: string; status: string }>)
      .filter((r) => r.status === 'Submitted')
      .map((r) => r.id);
    if (stuckIds.length > 0) {
      const patched = await reconcileStuckParentRows('loan', stuckIds);
      if (patched.length > 0) {
        ({ data, error: err } = await runQuery());
        if (err) {
          setError(err.message);
          setAdvances([]);
          setLoading(false);
          return;
        }
      }
    }
    setAdvances(
      (data ?? []).map((r: Record<string, unknown>) => ({
        ...(r as unknown as AdvanceSalary),
        employee_name: (r.employees as { employee_name?: string } | null)?.employee_name ?? null,
        employee_code: (r.employees as { employee_code?: string } | null)?.employee_code ?? null,
      })),
    );
    setLoading(false);
  }, [opts?.employeeId]);

  useEffect(() => { void refetch(); }, [refetch]);

  return { advances, loading, error, refetch };
}

export async function nextAdvanceReference(): Promise<string> {
  const { data } = await supabase
    .from('advance_salaries')
    .select('reference')
    .order('created_at', { ascending: false })
    .limit(1);
  const last = (data?.[0]?.reference as string | undefined) ?? null;
  if (!last) return 'ADV/0001';
  const m = /ADV\/(\d+)/.exec(last);
  if (!m) return `ADV/${String(Date.now()).slice(-4)}`;
  const n = Number(m[1]) + 1;
  return `ADV/${String(n).padStart(4, '0')}`;
}
