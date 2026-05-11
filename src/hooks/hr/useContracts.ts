import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface Contract {
  id: string;
  employee_id: string | null;
  contract_name: string | null;
  wage: number;
  start_date: string | null;
  end_date: string | null;
  salary_structure_type: string | null;
  department: string | null;
  job_position: string | null;
  status: 'active' | 'inactive' | 'suspended';
  template_id: string | null;
  medical_aid: number | null;
  staff_loan: number | null;
  other_loan: number | null;
  car_insurance: number | null;
  funeral_cover: number | null;
  rent: number | null;
  bank_loan: number | null;
  other_deduction: number | null;
  advance_deduction: number | null;
  created_at: string;
  updated_at: string;
}

export interface ContractWithEmployee extends Contract {
  employee_name?: string | null;
  employee_code?: string | null;
}

export interface ContractLine {
  id: string;
  contract_id: string;
  component_def_id: string | null;
  amount: number;
  sequence: number;
  is_earning: boolean;
  is_active: boolean;
  created_at: string;
}

export interface ContractTemplate {
  id: string;
  name: string;
  is_active: boolean;
  created_at: string;
}

export function useContracts(opts?: { employeeId?: string }) {
  const [contracts, setContracts] = useState<ContractWithEmployee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    let q = supabase
      .from('contracts')
      .select('*, employees(employee_name, employee_code)')
      .order('created_at', { ascending: false });
    if (opts?.employeeId) q = q.eq('employee_id', opts.employeeId);
    const { data, error: err } = await q;
    if (err) {
      setError(err.message);
      setContracts([]);
    } else {
      setContracts(
        (data ?? []).map((r: Record<string, unknown>) => ({
          ...(r as unknown as Contract),
          employee_name: (r.employees as { employee_name?: string } | null)?.employee_name ?? null,
          employee_code: (r.employees as { employee_code?: string } | null)?.employee_code ?? null,
        })),
      );
    }
    setLoading(false);
  }, [opts?.employeeId]);

  useEffect(() => { void refetch(); }, [refetch]);

  return { contracts, loading, error, refetch };
}

export function useContractTemplates() {
  const [templates, setTemplates] = useState<ContractTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('contract_templates').select('*').order('name');
    setTemplates((data ?? []) as ContractTemplate[]);
    setLoading(false);
  }, []);

  useEffect(() => { void refetch(); }, [refetch]);

  return { templates, loading, refetch };
}
