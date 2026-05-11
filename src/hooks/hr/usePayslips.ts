import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface PayslipBreakdownLine {
  description: string;
  code: string;
  amount: number;
  hours?: number | null;
  isTaxable?: boolean;
}

export interface Payslip {
  id: string;
  reference: string;
  employee_id: string | null;
  period_from: string;
  period_to: string;
  payslip_name: string | null;
  basic_salary: number;
  gross_salary: number;
  total_deductions: number;
  paye_tax: number;
  net_salary: number;
  earnings_breakdown: PayslipBreakdownLine[];
  deductions_breakdown: PayslipBreakdownLine[];
  benefits_breakdown: PayslipBreakdownLine[];
  status: 'draft' | 'confirmed' | 'cancelled';
  notes: string | null;
  created_at: string;
}

export interface PayslipWithEmployee extends Payslip {
  employee_name?: string | null;
  employee_code?: string | null;
}

export function usePayslips(opts?: { employeeId?: string }) {
  const [payslips, setPayslips] = useState<PayslipWithEmployee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    let q = supabase
      .from('payslips')
      .select('*, employees(employee_name, employee_code)')
      .order('period_to', { ascending: false });
    if (opts?.employeeId) q = q.eq('employee_id', opts.employeeId);
    const { data, error: err } = await q;
    if (err) {
      setError(err.message);
      setPayslips([]);
    } else {
      setPayslips(
        (data ?? []).map((r: Record<string, unknown>) => ({
          ...(r as unknown as Payslip),
          employee_name: (r.employees as { employee_name?: string } | null)?.employee_name ?? null,
          employee_code: (r.employees as { employee_code?: string } | null)?.employee_code ?? null,
        })),
      );
    }
    setLoading(false);
  }, [opts?.employeeId]);

  useEffect(() => { void refetch(); }, [refetch]);

  return { payslips, loading, error, refetch };
}

export async function nextPayslipReference(): Promise<string> {
  const { data } = await supabase
    .from('payslips')
    .select('reference')
    .order('created_at', { ascending: false })
    .limit(1);
  const last = (data?.[0]?.reference as string | undefined) ?? null;
  if (!last) return 'PAY/0001';
  const m = /PAY\/(\d+)/.exec(last);
  if (!m) return `PAY/${String(Date.now()).slice(-4)}`;
  const n = Number(m[1]) + 1;
  return `PAY/${String(n).padStart(4, '0')}`;
}
