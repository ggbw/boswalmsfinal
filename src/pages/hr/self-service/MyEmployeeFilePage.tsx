import { useEffect, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/hooks/useAuth';
import type { Employee } from '@/hooks/hr/useEmployees';
import { fmtCurrency, fmtDate } from '@/lib/hr/leaveUtils';
import { supabase } from '@/integrations/supabase/client';

interface DocRow {
  id: string;
  document_name: string;
  document_type: string | null;
  expiry_date: string | null;
  file_path: string | null;
}

export default function MyEmployeeFilePage() {
  const { navigate } = useApp();
  const { user } = useAuth();
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let active = true;
    void (async () => {
      const { data: emp } = await supabase
        .from('employees')
        .select('*')
        .eq('auth_user_id', user.id)
        .maybeSingle();
      if (!active) return;
      setEmployee((emp ?? null) as Employee | null);
      if (emp?.id) {
        const { data: ds } = await supabase
          .from('employee_documents')
          .select('id, document_name, document_type, expiry_date, file_path')
          .eq('employee_id', emp.id as string)
          .order('expiry_date', { ascending: true, nullsFirst: false });
        if (active) setDocs((ds ?? []) as DocRow[]);
      }
      setLoading(false);
    })();
    return () => { active = false; };
  }, [user]);

  if (loading) {
    return <div className="card" style={{ padding: 32, textAlign: 'center', color: 'var(--text2)' }}>Loading…</div>;
  }

  if (!employee) {
    return (
      <>
        <div className="page-header">
          <div>
            <div className="page-title">My File</div>
            <div className="page-sub">Self-service</div>
          </div>
        </div>
        <div className="card" style={{ padding: 32, textAlign: 'center' }}>
          <i className="fa-solid fa-circle-info" style={{ fontSize: 24, color: '#d4920a', marginBottom: 12 }} />
          <div>Your account is not linked to an employee record.</div>
        </div>
      </>
    );
  }

  const Field = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div className="info-row">
      <div className="info-label">{label}</div>
      <div className="info-val" style={{ fontFamily: 'inherit' }}>{value || '—'}</div>
    </div>
  );

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">My File</div>
          <div className="page-sub">{employee.employee_name} · {employee.employee_code}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-outline btn-sm" onClick={() => navigate('my-payslips')}>
            <i className="fa-solid fa-receipt" /> My Payslips
          </button>
          <button className="btn btn-outline btn-sm" onClick={() => navigate('my-leaves')}>
            <i className="fa-solid fa-calendar" /> My Leaves
          </button>
        </div>
      </div>

      <div className="two-col">
        <div className="card">
          <div className="card-title"><span>Personal Info</span></div>
          <Field label="Full Name" value={employee.employee_name} />
          <Field label="Employee Code" value={employee.employee_code} />
          <Field label="Email" value={employee.email} />
          <Field label="Mobile" value={employee.mobile_number} />
          <Field label="Department" value={employee.department} />
          <Field label="Designation" value={employee.job_title} />
          <Field label="Joined" value={employee.joining_date ? fmtDate(employee.joining_date) : null} />
          <Field label="Status" value={<span style={{ textTransform: 'capitalize' }}>{employee.status}</span>} />
        </div>
        <div className="card">
          <div className="card-title"><span>Compensation</span></div>
          <Field label="Basic Salary" value={fmtCurrency(employee.basic_salary)} />
          <Field label="Bank" value={employee.bank_name} />
          <Field label="Branch" value={employee.bank_branch_name} />
          <Field label="Account" value={employee.account_no} />
        </div>
      </div>

      <div className="card" style={{ marginTop: 16, padding: 0 }}>
        <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid var(--border)', fontSize: 13, fontWeight: 600 }}>
          My Documents ({docs.length})
        </div>
        {docs.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--text2)', fontSize: 12 }}>No documents on file.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Document</th>
                  <th>Type</th>
                  <th>Expiry</th>
                </tr>
              </thead>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.id}>
                    <td>
                      {d.file_path ? (
                        <a href={d.file_path} target="_blank" rel="noreferrer" style={{ color: 'var(--accent2)' }}>
                          {d.document_name} <i className="fa-solid fa-up-right-from-square" style={{ fontSize: 9 }} />
                        </a>
                      ) : (
                        d.document_name
                      )}
                    </td>
                    <td>{d.document_type ?? '—'}</td>
                    <td>{d.expiry_date ? fmtDate(d.expiry_date) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
