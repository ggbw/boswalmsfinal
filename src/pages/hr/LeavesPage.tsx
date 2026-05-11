import { useMemo, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { useUserRole } from '@/hooks/hr/useUserRole';
import { useLeaveRequests, useLeaveTypes, type LeaveRequestWithJoins } from '@/hooks/hr/useLeaves';
import { useEmployees } from '@/hooks/hr/useEmployees';
import { calcLeaveDays, BOTSWANA_HOLIDAYS_2026 } from '@/lib/hr/payrollEngine';
import { fmtDate } from '@/lib/hr/leaveUtils';
import { supabase } from '@/integrations/supabase/client';

const statusBadge = (s: string): string => {
  if (s === 'approved') return 'badge badge-active';
  if (s === 'rejected') return 'badge badge-fail';
  if (s === 'cancelled') return 'badge badge-inactive';
  return 'badge badge-pending';
};

export default function LeavesPage() {
  const { toast } = useApp();
  const { can } = useUserRole();
  const { employees } = useEmployees();
  const { types: leaveTypes } = useLeaveTypes();
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const { requests, loading, refetch } = useLeaveRequests({ status: statusFilter });
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    employee_id: '',
    leave_type_id: '',
    start_date: '',
    end_date: '',
    reason: '',
  });

  const writeOk = can('leaves', 'write');

  const computedDays = useMemo(() => {
    if (!form.start_date || !form.end_date) return 0;
    return calcLeaveDays(form.start_date, form.end_date, BOTSWANA_HOLIDAYS_2026);
  }, [form.start_date, form.end_date]);

  const handleCreate = async () => {
    if (!form.employee_id || !form.leave_type_id || !form.start_date || !form.end_date) {
      toast('Please fill required fields', 'error');
      return;
    }
    if (computedDays <= 0) { toast('End date must be on or after start date', 'error'); return; }
    const { error } = await supabase.from('leave_requests').insert({
      employee_id: form.employee_id,
      leave_type_id: form.leave_type_id,
      start_date: form.start_date,
      end_date: form.end_date,
      number_of_days: computedDays,
      reason: form.reason.trim() || null,
      status: 'pending',
    });
    if (error) { toast(error.message, 'error'); return; }
    toast('Leave request created', 'success');
    setForm({ employee_id: '', leave_type_id: '', start_date: '', end_date: '', reason: '' });
    setCreating(false);
    void refetch();
  };

  const handleAction = async (r: LeaveRequestWithJoins, status: 'approved' | 'rejected') => {
    const comment = status === 'rejected' ? window.prompt('Rejection reason (optional):') ?? null : null;
    const { error } = await supabase
      .from('leave_requests')
      .update({
        status,
        approver_comment: comment,
        approved_at: new Date().toISOString(),
      })
      .eq('id', r.id);
    if (error) { toast(error.message, 'error'); return; }
    toast(`Request ${status}`, status === 'approved' ? 'success' : 'info');
    void refetch();
  };

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Leaves</div>
          <div className="page-sub">HR Management · {requests.length} requests</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <select className="filter-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">All</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="cancelled">Cancelled</option>
          </select>
          {writeOk && (
            <button className="btn btn-primary btn-sm" onClick={() => setCreating((c) => !c)}>
              <i className="fa-solid fa-plus" /> {creating ? 'Cancel' : 'New Request'}
            </button>
          )}
        </div>
      </div>

      {creating && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-title"><span>New Leave Request</span></div>
          <div className="form-row cols2">
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
              <label>Leave Type *</label>
              <select className="form-select" value={form.leave_type_id} onChange={(e) => setForm({ ...form, leave_type_id: e.target.value })}>
                <option value="">— Select —</option>
                {leaveTypes.map((t) => (
                  <option key={t.id} value={t.id}>{t.name} ({t.max_days} days/year)</option>
                ))}
              </select>
            </div>
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
              <i className="fa-solid fa-paper-plane" /> Submit
            </button>
          </div>
        </div>
      )}

      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid var(--border)', fontSize: 13, fontWeight: 600 }}>
          Leave Requests
        </div>
        {loading ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text2)' }}>Loading…</div>
        ) : requests.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text2)' }}>No requests.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Type</th>
                  <th>Period</th>
                  <th>Days</th>
                  <th>Reason</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <div className="td-name">{r.employee_name ?? '—'}</div>
                      <div style={{ fontSize: 10, color: 'var(--text3)' }}>{r.employee_code}</div>
                    </td>
                    <td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 8, height: 8, borderRadius: 2, background: r.leave_type_color ?? '#0D9488' }} />
                        {r.leave_type_name ?? '—'}
                      </span>
                    </td>
                    <td>{fmtDate(r.start_date)} → {fmtDate(r.end_date)}</td>
                    <td>{r.number_of_days}</td>
                    <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.reason ?? ''}>
                      {r.reason ?? '—'}
                    </td>
                    <td><span className={statusBadge(r.status)}>{r.status}</span></td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {writeOk && r.status === 'pending' && (
                        <>
                          <button className="btn btn-green btn-sm" onClick={() => void handleAction(r, 'approved')} style={{ marginRight: 4 }} title="Approve">
                            <i className="fa-solid fa-check" />
                          </button>
                          <button className="btn btn-danger btn-sm" onClick={() => void handleAction(r, 'rejected')} title="Reject">
                            <i className="fa-solid fa-xmark" />
                          </button>
                        </>
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
