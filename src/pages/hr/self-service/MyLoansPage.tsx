import { useEffect, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/hooks/useAuth';
import { useAdvances, nextAdvanceReference } from '@/hooks/hr/useLoans';
import { fmtCurrency, fmtDate } from '@/lib/hr/leaveUtils';
import { supabase } from '@/integrations/supabase/client';

const statusBadge = (s: string): string => {
  if (s === 'Approved') return 'badge badge-active';
  if (s === 'Completed') return 'badge badge-pass';
  if (s === 'Rejected') return 'badge badge-fail';
  if (s === 'Submitted') return 'badge badge-pending';
  return 'badge badge-inactive';
};

export default function MyLoansPage() {
  const { toast } = useApp();
  const { user } = useAuth();
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [employeeLoaded, setEmployeeLoaded] = useState(false);
  const [loanTypes, setLoanTypes] = useState<Array<{ id: string; name: string }>>([]);

  useEffect(() => {
    if (!user) return;
    void supabase
      .from('employees')
      .select('id')
      .eq('auth_user_id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        setEmployeeId((data?.id as string) ?? null);
        setEmployeeLoaded(true);
      });
  }, [user]);

  useEffect(() => {
    void supabase
      .from('loan_types')
      .select('id, name')
      .eq('is_active', true)
      .order('name')
      .then(({ data }) => setLoanTypes((data ?? []) as Array<{ id: string; name: string }>));
  }, []);

  const { advances, loading, refetch } = useAdvances(employeeId ? { employeeId } : undefined);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    loan_type: 'Salary Advance',
    total_amount: '',
    installments: '1',
    notes: '',
  });

  const handleCreate = async () => {
    if (!employeeId) { toast('No employee record linked to your account', 'error'); return; }
    const total = Number(form.total_amount);
    const installments = Number(form.installments);
    if (total <= 0 || installments <= 0) { toast('Amount and installments must be > 0', 'error'); return; }
    const monthly = Math.round((total / installments) * 100) / 100;
    const reference = await nextAdvanceReference();
    const { error } = await supabase.from('advance_salaries').insert({
      reference,
      employee_id: employeeId,
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
    setForm({ loan_type: 'Salary Advance', total_amount: '', installments: '1', notes: '' });
    setCreating(false);
    void refetch();
  };

  if (employeeLoaded && !employeeId) {
    return (
      <>
        <div className="page-header">
          <div>
            <div className="page-title">My Loans</div>
            <div className="page-sub">Self-service</div>
          </div>
        </div>
        <div className="card" style={{ padding: 32, textAlign: 'center' }}>
          <i className="fa-solid fa-circle-info" style={{ fontSize: 24, color: '#d4920a', marginBottom: 12 }} />
          <div style={{ marginBottom: 8 }}>Your account is not linked to an employee record.</div>
          <div style={{ fontSize: 12, color: 'var(--text2)' }}>Contact HR to enable self-service features.</div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">My Loans</div>
          <div className="page-sub">Self-service · {advances.length} records</div>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => setCreating((c) => !c)}>
          <i className="fa-solid fa-plus" /> {creating ? 'Cancel' : 'Request Loan'}
        </button>
      </div>

      {creating && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-title"><span>New Loan Request</span></div>
          <div className="form-row cols2">
            <div className="form-group">
              <label>Loan Type</label>
              <select className="form-select" value={form.loan_type} onChange={(e) => setForm({ ...form, loan_type: e.target.value })}>
                {loanTypes.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
                {loanTypes.length === 0 && <option value="Salary Advance">Salary Advance</option>}
              </select>
            </div>
            <div className="form-group">
              <label>Installments *</label>
              <input type="number" className="form-input" value={form.installments} onChange={(e) => setForm({ ...form, installments: e.target.value })} />
            </div>
          </div>
          <div className="form-group">
            <label>Total Amount *</label>
            <input type="number" step="0.01" className="form-input" value={form.total_amount} onChange={(e) => setForm({ ...form, total_amount: e.target.value })} />
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
          My Loan History
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
                  <th>Type</th>
                  <th style={{ textAlign: 'right' }}>Total</th>
                  <th style={{ textAlign: 'right' }}>Monthly</th>
                  <th style={{ textAlign: 'right' }}>Outstanding</th>
                  <th>Date</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {advances.map((a) => (
                  <tr key={a.id}>
                    <td style={{ fontFamily: 'JetBrains Mono, monospace' }}>{a.reference}</td>
                    <td>{a.loan_type ?? '—'}</td>
                    <td style={{ textAlign: 'right' }}>{fmtCurrency(a.total_amount)}</td>
                    <td style={{ textAlign: 'right' }}>{fmtCurrency(a.monthly_installment)}</td>
                    <td style={{ textAlign: 'right' }}>{fmtCurrency(a.remaining_amount)}</td>
                    <td>{fmtDate(a.request_date)}</td>
                    <td><span className={statusBadge(a.status)}>{a.status}</span></td>
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
