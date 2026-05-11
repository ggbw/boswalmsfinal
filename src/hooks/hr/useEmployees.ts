// Fetches employees from Supabase. Mirrors the data shape used by motho2
// HR pages but without depending on motho2's generated `Tables<>` types.
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface Employee {
  id: string;
  employee_name: string;
  job_title: string | null;
  employee_code: string;
  department: string | null;
  hr_department_id: string | null;
  branch_name: string | null;
  bank_name: string | null;
  joining_date: string | null;
  bank_branch_code: string | null;
  bank_branch_name: string | null;
  account_no: string | null;
  payslip_date: string | null;
  email: string | null;
  mobile_number: string | null;
  basic_salary: number | null;
  gender: string | null;
  status: string | null;
  manager_id: string | null;
  auth_user_id: string | null;
  biometric_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface UseEmployeesResult {
  employees: Employee[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

// Generates the next employee_code by inspecting all existing codes
// that match `EMP-NNNN` and returning EMP-(max+1). Defensive:
//   * If the SELECT errors (RLS broken, network, table missing),
//     returns a timestamp-suffix code so we never collide with
//     hidden rows the unique constraint can still see.
//   * If existing codes don't match EMP-NNNN, also use a timestamp
//     suffix to avoid colliding with non-standard legacy codes.
export async function nextEmployeeCode(): Promise<string> {
  const { data, error } = await supabase
    .from('employees')
    .select('employee_code')
    .ilike('employee_code', 'EMP-%');
  // If we can't read existing codes, fall back to a timestamp-based
  // code that's astronomically unlikely to collide. The user can
  // still edit it before saving.
  if (error) {
    return `EMP-${String(Date.now()).slice(-6)}`;
  }
  const rows = (data ?? []) as Array<{ employee_code: string }>;
  let max = 0;
  for (const r of rows) {
    const m = /^EMP-(\d+)$/i.exec(r.employee_code);
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  if (max === 0 && rows.length > 0) {
    // Existing codes don't match EMP-NNNN format — use a timestamp suffix
    return `EMP-${String(Date.now()).slice(-6)}`;
  }
  return `EMP-${String(max + 1).padStart(4, '0')}`;
}

export function useEmployees(): UseEmployeesResult {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase
      .from('employees')
      .select('*')
      .order('employee_name', { ascending: true });
    if (err) {
      setError(err.message);
      setEmployees([]);
    } else {
      setEmployees((data ?? []) as Employee[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { employees, loading, error, refetch };
}
