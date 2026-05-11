import { useEffect, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { useUserRole } from '@/hooks/hr/useUserRole';
import { useAdvances, nextAdvanceReference, type AdvanceSalaryWithEmployee } from '@/hooks/hr/useLoans';
import { useEmployees } from '@/hooks/hr/useEmployees';
import { fmtCurrency, fmtDate } from '@/lib/hr/leaveUtils';
import { supabase } from '@/integrations/supabase/client';

const statusBadge = (s: string): string => {
  if (s === 'Approved') return 'badge badge-active';
  if (s === 'Completed') return 'badge badge-pass';
  if (s === 'Rejected') return 'badge badge-fail';
  if (s === 'Submitted') return 'badge badge-pending';
  return 'badge badge-inactive';
};

export default function LoansPage() {
  const { toast } = useApp();
  const { can } = useUserRole();
  const { employees } = useEmployees();
  const [loanTypes, setLoanTypes] = useState<Array<{ id: string; name: string }>>([]);
  const { advances, loading, refetch } = useAdvances();
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    employee_id: '',
    loan_type: 'Salary Advance',
    total_amount: '',
    monthly_installment: '',
    installments: '1',
    notes: '',
  });

  const writeOk = can('loans', 'write');

  useEffect(() => {
    void supabase
      .from('loan_types')
      .select('id, name')
      .eq('is_active', true)
      .order('name')
      .then(({ data }) => setLoanTypes((data ?? []) as Array<{ id: string; name: string }>));
  }, []);

  const handleCreate = async () => {
    if (!form.employee_id || !form.total_amount || !form.installments) {
      toast('Please fill required fields', 'error');
      return;
    }
    const total = Number(form.total_amount);
    const installments = Number(form.installments);
    if (total <= 0 || installments <= 0) { toast('Amount and installments must be > 0', 'error'); return; }
    const monthly = form.monthly_installment ? Number(form.monthly_installment) : Math.round((total / installments) * 100) / 100;

    const reference = await nextAdvanceReference();
    const { error } = await supabase.from('advance_salaries').insert({
      reference,
      employee_id: form.employee_id,
      loan_type: form.loan_type,
      total_amount: total,
      monthly_installment: monthly,
      installments,
      remaining_amount: total,
      status: 'Submitted',
      notes: form.notes.trim() || null,
    });
    if (error) { toast(error.message, 'error'); return; }
    toast(`Loan ${reference} submitted`, 'success');
    setForm({ employee_id: '', loan_type: 'Salary Advance', total_amount: '', monthly_installment: '', installments: '1', notes: '' });
    setCreating(false);
    void refetch();
  };

  const handleStatus = async (a: AdvanceSalaryWithEmployee, status: AdvanceSalaryWithEmployee['status']) => {
    const { error } = await supabase
      .from('advance_salaries')
      .update({ status })
      .eq('id', a.id);
    if (error) { toast(error.message, 'error'); return; }
    toast(`Loan ${a.reference} → ${status}`, 'info');
    void refetch();
  };

  const totalOutstanding = advances
    .filter((a) => a.status === 'Approved')
    .reduce((s, a) => s + (a.remaining_amount ?? 0), 0);

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Loans / Advance Salaries</div>
          <div className="page-sub">HR Management · {advances.length} records</div>
        </div>
        {writeOk && (
          <button className="btn btn-primary btn-sm" onClick={() => setCreating((c) => !c)}>
            <i className="fa-solid fa-plus" /> {creating ? 'Cancel' : 'New Loan'}
          </button>
        )}
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(37,99,235,0.13)', color: '#2563eb' }}>
            <i className="fa-solid fa-list" />
          </div>
          <div>
            <div className="stat-val">{advances.length}</div>
            <div className="stat-label">Total Records</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(26,127,55,0.13)', color: '#1a7f37' }}>
            <i className="fa-solid fa-circle-check" />
          </div>
          <div>
            <div className="stat-val">{advances.filter((a) => a.status === 'Approved').length}</div>
            <div className="stat-label">Approved</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(212,146,10,0.13)', color: '#d4920a' }}>
            <i className="fa-solid fa-clock" />
          </div>
          <div>
            <div className="stat-val">{advances.filter((a) => a.status === 'Submitted').length}</div>
            <div className="stat-label">Pending</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(207,34,46,0.13)', color: '#cf222e' }}>
            <i className="fa-solid fa-hand-holding-dollar" />
          </div>
          <div>
            <div className="stat-val" style={{ fontSize: 16 }}>{fmtCurrency(totalOutstanding)}</div>
            <div className="stat-label">Outstanding</div>
          </div>
        </div>
      </div>

      {creating && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-title"><span>New Loan Request</span></div>
          <div className="form-row cols3">
            <div className="form-group">
              <label>Employee *</label>
              <select className="form-select" value={form.employee_id} onChange={(e) => setForm({ ...form, employee_id: e.target.value })}>
                <option value="">— Select —</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>{e.employee_name} ({e.employee_code})</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Loan Type</label>
              <select className="form-select" value={form.loan_type} onChange={(e) => setForm({ ...form, loan_type: e.target.value })}>
                {loanTypes.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
                {loanTypes.length === 0 && <option value="Salary Advance">Salary Advance</option>}
              </select>
            </div>
            <div className="form-group">
              <label>Total Amount *</label>
              <input type="number" step="0.01" className="form-input" value={form.total_amount} onChange={(e) => setForm({ ...form, total_amount: e.target.value })} />
            </div>
          </div>
          <div className="form-row cols2">
            <div className="form-group">
              <label>Installments *</label>
              <input type="number" className="form-input" value={form.installments} onChange={(e) => setForm({ ...form, installments: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Monthly (auto if blank)</label>
              <input type="number" step="0.01" className="form-input" value={form.monthly_installment} onChange={(e) => setForm({ ...form, monthly_installment: e.target.value })} />
            </div>
          </div>
          <div className="form-group">
            <label>Notes</label>
            <textarea rows={2} className="form-textarea" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
          <div style={{ textAlign: 'right' }}>
            <button className="btn btn-primary btn-sm" onClick={() => void handleCreate()}>
              <i className="fa-solid fa-paper-plane" /> Submit
            </button>
          </div>
        </div>
      )}

      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid var(--border)', fontSize: 13, fontWeight: 600 }}>
          All Loans
        </div>
        {loading ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text2)' }}>Loading…</div>
        ) : advances.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text2)' }}>No loans yet.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Employee</th>
                  <th>Type</th>
                  <th style={{ textAlign: 'right' }}>Total</th>
                  <th style={{ textAlign: 'right' }}>Monthly</th>
                  <th>Inst.</th>
                  <th style={{ textAlign: 'right' }}>Outstanding</th>
                  <th>Date</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {advances.map((a) => (
                  <tr key={a.id}>
                    <td style={{ fontFamily: 'JetBrains Mono, monospace' }}>{a.reference}</td>
                    <td>
                      <div className="td-name">{a.employee_name ?? '—'}</div>
                      <div style={{ fontSize: 10, color: 'var(--text3)' }}>{a.employee_code}</div>
                    </td>
                    <td>{a.loan_type ?? '—'}</td>
                    <td style={{ textAlign: 'right' }}>{fmtCurrency(a.total_amount)}</td>
                    <td style={{ textAlign: 'right' }}>{fmtCurrency(a.monthly_installment)}</td>
                    <td>{a.installments}</td>
                    <td style={{ textAlign: 'right' }}>{fmtCurrency(a.remaining_amount)}</td>
                    <td>{fmtDate(a.request_date)}</td>
                    <td><span className={statusBadge(a.status)}>{a.status}</span></td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {writeOk && a.status === 'Submitted' && (
                        <>
                          <button className="btn btn-green btn-sm" onClick={() => void handleStatus(a, 'Approved')} style={{ marginRight: 4 }} title="Approve">
                            <i className="fa-solid fa-check" />
                          </button>
                          <button className="btn btn-danger btn-sm" onClick={() => void handleStatus(a, 'Rejected')} title="Reject">
                            <i className="fa-solid fa-xmark" />
                          </button>
                        </>
                      )}
                      {writeOk && a.status === 'Approved' && (
                        <button className="btn btn-outline btn-sm" onClick={() => void handleStatus(a, 'Completed')} title="Mark completed">
                          <i className="fa-solid fa-flag-checkered" />
                        </button>
                      )}
                    </td>
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
