import { useEffect, useMemo, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/hooks/useAuth';
import { useLeaveRequests, useLeaveTypes } from '@/hooks/hr/useLeaves';
import { calcLeaveDays, BOTSWANA_HOLIDAYS_2026 } from '@/lib/hr/payrollEngine';
import { fmtDate } from '@/lib/hr/leaveUtils';
import { supabase } from '@/integrations/supabase/client';

const statusBadge = (s: string): string => {
  if (s === 'approved') return 'badge badge-active';
  if (s === 'rejected') return 'badge badge-fail';
  if (s === 'cancelled') return 'badge badge-inactive';
  return 'badge badge-pending';
};

export default function MyLeavesPage() {
  const { toast } = useApp();
  const { user } = useAuth();
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [employeeLoaded, setEmployeeLoaded] = useState(false);

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

  const { types: leaveTypes } = useLeaveTypes();
  const { requests, loading, refetch } = useLeaveRequests(employeeId ? { employeeId } : undefined);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    leave_type_id: '',
    start_date: '',
    end_date: '',
    reason: '',
  });

  const computedDays = useMemo(() => {
    if (!form.start_date || !form.end_date) return 0;
    return calcLeaveDays(form.start_date, form.end_date, BOTSWANA_HOLIDAYS_2026);
  }, [form.start_date, form.end_date]);

  const handleCreate = async () => {
    if (!employeeId) { toast('No employee record linked to your account', 'error'); return; }
    if (!form.leave_type_id || !form.start_date || !form.end_date) { toast('Please fill required fields', 'error'); return; }
    if (computedDays <= 0) { toast('End date must be on or after start date', 'error'); return; }
    const { error } = await supabase.from('leave_requests').insert({
      employee_id: employeeId,
      leave_type_id: form.leave_type_id,
      start_date: form.start_date,
      end_date: form.end_date,
      number_of_days: computedDays,
      reason: form.reason.trim() || null,
      status: 'pending',
    });
    if (error) { toast(error.message, 'error'); return; }
    toast('Leave request submitted', 'success');
    setForm({ leave_type_id: '', start_date: '', end_date: '', reason: '' });
    setCreating(false);
    void refetch();
  };

  const handleCancel = async (id: string) => {
    if (!window.confirm('Cancel this leave request?')) return;
    const { error } = await supabase.from('leave_requests').update({ status: 'cancelled' }).eq('id', id);
    if (error) { toast(error.message, 'error'); return; }
    toast('Request cancelled', 'info');
    void refetch();
  };

  if (employeeLoaded && !employeeId) {
    return (
      <>
        <div className="page-header">
          <div>
            <div className="page-title">My Leaves</div>
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
          <div className="page-title">My Leaves</div>
          <div className="page-sub">Self-service · {requests.length} requests</div>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => setCreating((c) => !c)}>
          <i className="fa-solid fa-plus" /> {creating ? 'Cancel' : 'Request Leave'}
        </button>
      </div>

      {creating && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-title"><span>New Leave Request</span></div>
          <div className="form-group">
            <label>Leave Type *</label>
            <select className="form-select" value={form.leave_type_id} onChange={(e) => setForm({ ...form, leave_type_id: e.target.value })}>
              <option value="">— Select —</option>
              {leaveTypes.map((t) => (
                <option key={t.id} value={t.id}>{t.name} ({t.max_days} days/year)</option>
              ))}
            </select>
          </div>
          <div className="form-row cols2">
            <div className="form-group">
              <label>Start Date *</label>
              <input type="date" className="form-input" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
            </div>
            <div className="form-group">
              <label>End Date *</label>
              <input type="date" className="form-input" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
            </div>
          </div>
          <div className="form-group">
            <label>
              Reason {computedDays > 0 && <span style={{ color: '#1a7f37', marginLeft: 8 }}>· {computedDays} working days</span>}
            </label>
            <textarea rows={2} className="form-textarea" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          </div>
          <div style={{ textAlign: 'right' }}>
            <button className="btn btn-primary btn-sm" onClick={() => void handleCreate()}>
              <i className="fa-solid fa-paper-plane" /> Submit Request
            </button>
          </div>
        </div>
      )}

      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid var(--border)', fontSize: 13, fontWeight: 600 }}>
          My Requests
        </div>
        {loading ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text2)' }}>Loading…</div>
        ) : requests.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text2)' }}>No leave requests yet.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Period</th>
                  <th>Days</th>
                  <th>Status</th>
                  <th>Approver Note</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((r) => (
                  <tr key={r.id}>
                    <td>{r.leave_type_name ?? '—'}</td>
                    <td>{fmtDate(r.start_date)} → {fmtDate(r.end_date)}</td>
                    <td>{r.number_of_days}</td>
                    <td><span className={statusBadge(r.status)}>{r.status}</span></td>
                    <td style={{ maxWidth: 200 }}>{r.approver_comment ?? '—'}</td>
                    <td style={{ textAlign: 'right' }}>
                      {r.status === 'pending' && (
                        <button className="btn btn-danger btn-sm" onClick={() => void handleCancel(r.id)}>
                          <i className="fa-solid fa-ban" /> Cancel
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
