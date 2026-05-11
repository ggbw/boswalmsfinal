import { useEffect, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { useUserRole } from '@/hooks/hr/useUserRole';
import { supabase } from '@/integrations/supabase/client';
import type { Employee } from '@/hooks/hr/useEmployees';
import { fmtCurrency, fmtDate } from '@/lib/hr/leaveUtils';

const statusClass = (status: string | null): string => {
  const s = status ?? 'active';
  if (s === 'active') return 'badge badge-active';
  if (s === 'inactive') return 'badge badge-pending';
  return 'badge badge-fail';
};

export default function EmployeeDetailPage() {
  const { navigate, pageParams, toast } = useApp();
  const { can } = useUserRole();
  const employeeId = pageParams.employeeId as string | undefined;

  const [employee, setEmployee] = useState<Employee | null>(null);
  const [manager, setManager] = useState<Employee | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!employeeId) return;
    let active = true;
    setLoading(true);
    void (async () => {
      const { data, error } = await supabase
        .from('employees')
        .select('*')
        .eq('id', employeeId)
        .maybeSingle();
      if (!active) return;
      if (error) {
        toast(error.message, 'error');
        setLoading(false);
        return;
      }
      setEmployee((data ?? null) as Employee | null);
      if (data?.manager_id) {
        const { data: mgr } = await supabase
          .from('employees')
          .select('*')
          .eq('id', data.manager_id)
          .maybeSingle();
        if (active) setManager((mgr ?? null) as Employee | null);
      }
      setLoading(false);
    })();
    return () => { active = false; };
  }, [employeeId, toast]);

  if (!employeeId) {
    return (
      <div className="card" style={{ padding: 32, textAlign: 'center' }}>
        <div style={{ marginBottom: 16 }}>No employee selected.</div>
        <button className="btn btn-primary btn-sm" onClick={() => navigate('hr-employees')}>
          Back to Employees
        </button>
      </div>
    );
  }

  if (loading) {
    return <div className="card" style={{ padding: 32, textAlign: 'center', color: 'var(--text2)' }}>Loading…</div>;
  }

  if (!employee) {
    return <div className="card" style={{ padding: 32, textAlign: 'center' }}>Employee not found.</div>;
  }

  const Row = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div className="info-row">
      <div className="info-label">{label}</div>
      <div className="info-val" style={{ fontFamily: 'inherit' }}>{value ?? '—'}</div>
    </div>
  );

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">{employee.employee_name}</div>
          <div className="page-sub">HR Management · {employee.employee_code}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-outline btn-sm" onClick={() => navigate('hr-employees')}>
            <i className="fa-solid fa-arrow-left" /> Back
          </button>
          {can('employees', 'write') && (
            <button
              className="btn btn-primary btn-sm"
              onClick={() => navigate('hr-employee-form', { mode: 'edit', employeeId: employee.id })}
            >
              <i className="fa-solid fa-pen" /> Edit
            </button>
          )}
        </div>
      </div>

      <div className="two-col">
        <div className="card">
          <div className="card-title"><span>Personal & Job</span></div>
          <Row label="Full Name" value={employee.employee_name} />
          <Row label="Employee Code" value={<code style={{ fontFamily: 'JetBrains Mono, monospace' }}>{employee.employee_code}</code>} />
          <Row label="Job Title" value={employee.job_title} />
          <Row label="Department" value={employee.department} />
          <Row label="Gender" value={employee.gender} />
          <Row label="Status" value={<span className={statusClass(employee.status)}>{employee.status ?? 'active'}</span>} />
          <Row label="Joining Date" value={fmtDate(employee.joining_date)} />
          <Row label="Manager" value={manager ? `${manager.employee_name} (${manager.employee_code})` : '—'} />
          <Row label="Branch" value={employee.branch_name} />
        </div>

        <div className="card">
          <div className="card-title"><span>Contact</span></div>
          <Row label="Email" value={employee.email} />
          <Row label="Mobile" value={employee.mobile_number} />
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-title"><span>Banking & Salary</span></div>
        <Row label="Basic Salary" value={fmtCurrency(employee.basic_salary)} />
        <Row label="Bank Name" value={employee.bank_name} />
        <Row label="Bank Branch Name" value={employee.bank_branch_name} />
        <Row label="Bank Branch Code" value={employee.bank_branch_code} />
        <Row label="Account Number" value={<code style={{ fontFamily: 'JetBrains Mono, monospace' }}>{employee.account_no ?? ''}</code>} />
        <Row label="Payslip Date" value={fmtDate(employee.payslip_date)} />
      </div>
    </>
  );
}
