import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/hooks/useAuth';
import { useLeaveTypes, type LeaveAllocation } from '@/hooks/hr/useLeaves';
import { calcLeaveDays, BOTSWANA_HOLIDAYS_2026 } from '@/lib/hr/payrollEngine';
import { fmtDate } from '@/lib/hr/leaveUtils';
import { useWorkflowAccess } from '@/hooks/hr/useWorkflowAccess';
import WorkflowStepper from '@/components/hr/workflow/WorkflowStepper';
import { resolveWorkflowForRequest, startWorkflowInstance } from '@/lib/hr/workflowEngine';
import { supabase } from '@/integrations/supabase/client';

const statusBadge = (s: string): string => {
  if (s === 'approved') return 'badge badge-active';
  if (s === 'rejected') return 'badge badge-fail';
  if (s === 'cancelled') return 'badge badge-inactive';
  return 'badge badge-pending';
};

interface LeaveRequest {
  id: string;
  leave_ref: string | null;
  leave_type_id: string | null;
  start_date: string;
  end_date: string;
  num_days: number | null;
  number_of_days: number;
  reason: string | null;
  handover_notes: string | null;
  admin_notes: string | null;
  rejection_reason: string | null;
  approver_comment: string | null;
  certificate_filename: string | null;
  certificate_url: string | null;
  status: string;
  created_at: string;
  leave_types?: { name?: string; color?: string; code?: string } | null;
}

export default function MyLeavesPage() {
  const { toast } = useApp();
  const { user } = useAuth();
  const { types: leaveTypes } = useLeaveTypes();

  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [employeeLoaded, setEmployeeLoaded] = useState(false);

  const [allocations, setAllocations] = useState<LeaveAllocation[]>([]);
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [holidays, setHolidays] = useState<string[]>(BOTSWANA_HOLIDAYS_2026);

  const [step, setStep] = useState(1);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState<{ ref: string } | null>(null);

  // Wizard form
  const [selType, setSelType] = useState<typeof leaveTypes[0] | null>(null);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');
  const [handover, setHandover] = useState('');
  const [confirmed, setConfirmed] = useState(false);

  const [expanded, setExpanded] = useState<string | null>(null);

  // ─── Load employee record ──────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    void supabase.from('employees').select('id').eq('auth_user_id', user.id).maybeSingle().then(({ data }) => {
      setEmployeeId((data?.id as string) ?? null);
      setEmployeeLoaded(true);
    });
  }, [user]);

  // ─── Load data ─────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!employeeId) return;
    setLoading(true);
    const year = new Date().getFullYear();
    const [allocRes, reqRes, holRes] = await Promise.all([
      supabase.from('leave_allocations').select('*, leave_types(name, color, code)').eq('employee_id', employeeId).eq('year', year),
      supabase.from('leave_requests').select('*, leave_types(name, color, code)').eq('employee_id', employeeId).order('created_at', { ascending: false }),
      supabase.from('public_holidays').select('holiday_date').eq('year', year),
    ]);
    if ((holRes.data ?? []).length > 0) {
      setHolidays((holRes.data ?? []).map((h: any) => h.holiday_date));
    }
    setAllocations((allocRes.data ?? []).map((r: Record<string, unknown>) => ({
      ...(r as unknown as LeaveAllocation),
      leave_type_name: (r.leave_types as any)?.name ?? null,
      leave_type_color: (r.leave_types as any)?.color ?? null,
      leave_type_code: (r.leave_types as any)?.code ?? null,
    })));
    setRequests((reqRes.data ?? []) as LeaveRequest[]);
    setLoading(false);
  }, [employeeId]);

  useEffect(() => { void load(); }, [load]);

  // ─── Wizard helpers ────────────────────────────────────────────────────
  const numDays = useMemo(() => {
    if (!startDate || !endDate) return 0;
    return calcLeaveDays(startDate, endDate, holidays);
  }, [startDate, endDate, holidays]);

  const selAlloc = selType ? allocations.find(a => a.leave_type_id === selType.id) : null;
  const remaining = selAlloc ? (selAlloc.remaining_days ?? 0) : (selType?.max_days ?? 0);
  const balanceAfter = remaining - numDays;

  const openWizard = () => {
    setStep(1); setSelType(null); setStartDate(''); setEndDate('');
    setReason(''); setHandover(''); setConfirmed(false);
    setSubmitSuccess(null); setWizardOpen(true);
  };

  const handleSubmit = async () => {
    if (!employeeId || !selType) return;
    setSubmitting(true);
    try {
      const { data: lr, error } = await supabase.from('leave_requests').insert({
        employee_id: employeeId,
        leave_type_id: selType.id,
        start_date: startDate,
        end_date: endDate,
        number_of_days: numDays,
        num_days: numDays,
        reason,
        handover_notes: handover || null,
        status: 'pending',
        applied_date: new Date().toISOString().slice(0, 10),
      } as never).select('*, leave_types(name)').single();
      if (error) throw error;
      const ref = (lr as any).leave_ref ?? (lr as any).id?.slice(0, 8).toUpperCase();
      // Bump pending on allocation
      if (selAlloc) {
        await supabase.from('leave_allocations').update({ pending_days: (selAlloc.pending_days ?? 0) + numDays } as never).eq('id', selAlloc.id);
      }
      // Notification
      await supabase.from('notifications').insert({ title: 'New Leave Request', message: `Leave request ${ref}: ${selType.name} from ${fmtDate(startDate)} to ${fmtDate(endDate)} (${numDays} days)`, type: 'leave', is_read: false } as never);
      // Try workflow
      void (async () => {
        const matched = await resolveWorkflowForRequest('leave', { leaveTypeId: selType.id, departmentId: null, employeeId });
        if (matched && (lr as any)?.id) await startWorkflowInstance('leave', (lr as any).id, matched.id);
      })();
      setSubmitSuccess({ ref });
      void load();
    } catch (e: any) {
      toast(e.message ?? 'Failed to submit', 'error');
    }
    setSubmitting(false);
  };

  const handleCancel = async (id: string) => {
    if (!window.confirm('Cancel this leave request?')) return;
    const req = requests.find(r => r.id === id);
    await supabase.from('leave_requests').update({ status: 'cancelled' } as never).eq('id', id);
    if (req && req.status === 'pending') {
      const a = allocations.find(a => a.leave_type_id === req.leave_type_id);
      if (a) await supabase.from('leave_allocations').update({ pending_days: Math.max(0, (a.pending_days ?? 0) - (req.num_days ?? req.number_of_days ?? 0)) } as never).eq('id', a.id);
    }
    toast('Request cancelled', 'info');
    void load();
  };

  const requestIdList = useMemo(() => requests.map(r => r.id), [requests]);
  const { engineRequestIds } = useWorkflowAccess('leave', requestIdList, user?.id ?? null);

  if (employeeLoaded && !employeeId) {
    return (
      <>
        <div className="page-header"><div><div className="page-title">My Leaves</div><div className="page-sub">Self-service</div></div></div>
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
        <button className="btn btn-primary btn-sm" onClick={openWizard}>
          <i className="fa-solid fa-plus" /> Apply for Leave
        </button>
      </div>

      {/* Balance Cards */}
      {allocations.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12, marginBottom: 20 }}>
          {allocations.map(a => {
            const color = a.leave_type_color ?? '#0D9488';
            const total = (a.opening_balance ?? 0) + a.allocated_days;
            const used  = a.used_days ?? 0;
            const pct   = total > 0 ? Math.min(100, Math.round(used / total * 100)) : 0;
            return (
              <div key={a.id} className="card" style={{ borderLeft: `4px solid ${color}`, padding: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>{a.leave_type_name}</div>
                <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--text)', lineHeight: 1 }}>
                  {a.remaining_days ?? 0}
                  <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text3)', marginLeft: 4 }}>days left</span>
                </div>
                <div style={{ display: 'flex', gap: 10, fontSize: 11, color: 'var(--text2)', marginTop: 6 }}>
                  <span>Used: <b>{used}</b></span>
                  <span>Pending: <b>{a.pending_days ?? 0}</b></span>
                  <span>Total: <b>{total}</b></span>
                </div>
                <div style={{ width: '100%', background: 'var(--border)', borderRadius: 4, height: 4, marginTop: 8 }}>
                  <div style={{ width: `${pct}%`, background: color, borderRadius: 4, height: 4 }} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Leave History */}
      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '14px 20px 12px', borderBottom: '1px solid var(--border)', fontSize: 13, fontWeight: 600 }}>Leave History</div>
        {loading ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text2)' }}>Loading…</div>
        ) : requests.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text2)' }}>No leave requests yet.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Ref</th>
                  <th>Type</th>
                  <th>Period</th>
                  <th>Days</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {requests.map(r => {
                  const isEngine = engineRequestIds.has(r.id);
                  return (
                    <Fragment key={r.id}>
                      <tr>
                        <td style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text3)' }}>{r.leave_ref ?? r.id.slice(0, 8)}</td>
                        <td>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                            <span style={{ width: 8, height: 8, borderRadius: 2, background: r.leave_types?.color ?? '#0D9488' }} />
                            {r.leave_types?.name ?? '—'}
                          </span>
                        </td>
                        <td>{fmtDate(r.start_date)} → {fmtDate(r.end_date)}</td>
                        <td>{r.num_days ?? r.number_of_days}</td>
                        <td>
                          <span className={statusBadge(r.status)}>{r.status}</span>
                          {isEngine && (
                            <button onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                              style={{ fontSize: 10, color: 'var(--accent)', marginTop: 2, background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'block' }}>
                              {expanded === r.id ? 'Hide progress' : 'View progress'}
                            </button>
                          )}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <button onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                            className="btn btn-outline btn-sm" style={{ marginRight: 4 }} title="Details">
                            <i className="fa-solid fa-eye" />
                          </button>
                          {r.status === 'pending' && (
                            <button className="btn btn-danger btn-sm" onClick={() => void handleCancel(r.id)}>
                              <i className="fa-solid fa-ban" />
                            </button>
                          )}
                        </td>
                      </tr>
                      {expanded === r.id && (
                        <tr>
                          <td colSpan={6} style={{ background: 'var(--surface2)', padding: '10px 20px', fontSize: 12 }}>
                            {isEngine && <div style={{ marginBottom: 10 }}><WorkflowStepper requestType="leave" requestId={r.id} /></div>}
                            {r.reason && <p style={{ margin: '4px 0' }}><b>Reason:</b> {r.reason}</p>}
                            {r.handover_notes && <p style={{ margin: '4px 0' }}><b>Handover:</b> {r.handover_notes}</p>}
                            {r.admin_notes && <p style={{ margin: '4px 0' }}><b>Admin Notes:</b> {r.admin_notes}</p>}
                            {r.rejection_reason && <p style={{ margin: '4px 0', color: '#dc2626' }}><b>Rejection:</b> {r.rejection_reason}</p>}
                            {r.approver_comment && <p style={{ margin: '4px 0' }}><b>Approver Comment:</b> {r.approver_comment}</p>}
                            {r.certificate_filename && (
                              <p style={{ margin: '4px 0' }}><b>Certificate:</b>{' '}
                                {r.certificate_url ? <a href={r.certificate_url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>{r.certificate_filename}</a> : r.certificate_filename}
                              </p>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Apply Wizard Modal ── */}
      {wizardOpen && (
        <div className="modal-overlay open" onClick={e => { if (e.target === e.currentTarget && !submitting) setWizardOpen(false); }}>
          <div className="modal" style={{ maxWidth: 520 }}>
            <div className="modal-header">
              <div className="modal-title">
                {submitSuccess ? 'Leave Applied!' : `Apply for Leave — Step ${step} of 3`}
              </div>
              {!submitting && !submitSuccess && (
                <button className="modal-close" onClick={() => setWizardOpen(false)}>✕</button>
              )}
            </div>

            {submitSuccess ? (
              <div style={{ textAlign: 'center', padding: '24px 0' }}>
                <i className="fa-solid fa-circle-check" style={{ fontSize: 48, color: '#059669', marginBottom: 12 }} />
                <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>Application Submitted</div>
                <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 20 }}>Your reference: <b>{submitSuccess.ref}</b></div>
                <button className="btn btn-primary btn-sm" onClick={() => setWizardOpen(false)}>Close</button>
              </div>
            ) : (
              <>
                {/* Step 1: Select leave type */}
                {step === 1 && (
                  <div>
                    <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 14 }}>Select the type of leave:</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      {leaveTypes.map(lt => {
                        const a = allocations.find(x => x.leave_type_id === lt.id);
                        const rem = a ? (a.remaining_days ?? 0) : (lt.max_days ?? 0);
                        const disabled = rem <= 0;
                        return (
                          <button key={lt.id}
                            onClick={() => !disabled && setSelType(lt)}
                            disabled={disabled}
                            style={{
                              padding: '12px 14px', borderRadius: 8, textAlign: 'left', cursor: disabled ? 'not-allowed' : 'pointer',
                              border: `2px solid ${selType?.id === lt.id ? 'var(--accent)' : disabled ? 'var(--border)' : 'var(--border)'}`,
                              background: selType?.id === lt.id ? 'var(--surface2)' : 'var(--surface)',
                              opacity: disabled ? 0.5 : 1, transition: 'all .15s',
                            }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                              <span style={{ fontWeight: 600, fontSize: 13, color: lt.color ?? 'var(--accent)' }}>{lt.name}</span>
                              {lt.requires_certificate && <span style={{ fontSize: 9, background: '#fef3c7', color: '#92400e', padding: '2px 5px', borderRadius: 3 }}>Cert req.</span>}
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--text2)' }}>{rem} days available</div>
                            {lt.is_paid === false && <div style={{ fontSize: 10, color: '#dc2626', marginTop: 2 }}>Unpaid</div>}
                          </button>
                        );
                      })}
                    </div>
                    <div style={{ textAlign: 'right', marginTop: 16 }}>
                      <button className="btn btn-primary btn-sm" onClick={() => selType && setStep(2)} disabled={!selType}>Next →</button>
                    </div>
                  </div>
                )}

                {/* Step 2: Dates & reason */}
                {step === 2 && selType && (
                  <div>
                    <div className="form-row cols2">
                      <div className="form-group"><label>Start Date *</label><input type="date" className="form-input" value={startDate} onChange={e => setStartDate(e.target.value)} /></div>
                      <div className="form-group"><label>End Date *</label><input type="date" className="form-input" value={endDate} min={startDate} onChange={e => setEndDate(e.target.value)} /></div>
                    </div>

                    {startDate && endDate && numDays >= 0 && (
                      <div style={{ borderRadius: 8, padding: '10px 14px', marginBottom: 12, fontSize: 12, background: balanceAfter < 0 ? '#fef2f2' : 'var(--surface2)', border: `1px solid ${balanceAfter < 0 ? '#fca5a5' : 'var(--border)'}` }}>
                        <div style={{ fontWeight: 600, marginBottom: 4 }}>
                          {balanceAfter < 0 && <i className="fa-solid fa-triangle-exclamation" style={{ color: '#dc2626', marginRight: 6 }} />}
                          {numDays} working day{numDays !== 1 ? 's' : ''}
                        </div>
                        <div style={{ color: 'var(--text2)' }}>Remaining before: <b>{remaining}</b> days</div>
                        <div style={{ color: balanceAfter < 0 ? '#dc2626' : 'var(--text2)', fontWeight: balanceAfter < 0 ? 700 : 400 }}>
                          Balance after: <b>{balanceAfter}</b> days {balanceAfter < 0 ? '⚠ Insufficient' : ''}
                        </div>
                      </div>
                    )}

                    <div className="form-group">
                      <label>Reason * <span style={{ fontSize: 10, color: 'var(--text3)' }}>(min 20 chars)</span></label>
                      <textarea rows={3} className="form-textarea" value={reason} onChange={e => setReason(e.target.value)} placeholder="Describe the reason for your leave…" />
                      <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>{reason.length} / 20</div>
                    </div>

                    <div className="form-group">
                      <label>Handover Notes</label>
                      <textarea rows={2} className="form-textarea" value={handover} onChange={e => setHandover(e.target.value)} placeholder="Who will cover your responsibilities?" />
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16 }}>
                      <button className="btn btn-outline btn-sm" onClick={() => setStep(1)}>← Back</button>
                      <button className="btn btn-primary btn-sm"
                        onClick={() => setStep(3)}
                        disabled={!startDate || !endDate || numDays <= 0 || reason.length < 20 || balanceAfter < 0}>
                        Review →
                      </button>
                    </div>
                  </div>
                )}

                {/* Step 3: Review & confirm */}
                {step === 3 && selType && (
                  <div>
                    <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: '14px 16px', fontSize: 13, marginBottom: 14 }}>
                      {[
                        ['Leave Type', selType.name],
                        ['From', fmtDate(startDate)],
                        ['To', fmtDate(endDate)],
                        ['Working Days', String(numDays)],
                        ['Balance After', `${balanceAfter} days`],
                      ].map(([label, val]) => (
                        <div key={label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                          <span style={{ color: 'var(--text2)' }}>{label}</span>
                          <span style={{ fontWeight: 600 }}>{val}</span>
                        </div>
                      ))}
                    </div>
                    <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: 'var(--text2)', marginBottom: 14 }}>
                      <b>Reason:</b> {reason}
                    </div>
                    {handover && (
                      <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: 'var(--text2)', marginBottom: 14 }}>
                        <b>Handover:</b> {handover}
                      </div>
                    )}
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer', marginBottom: 16 }}>
                      <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />
                      I confirm all details are correct.
                    </label>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <button className="btn btn-outline btn-sm" onClick={() => setStep(2)}>← Back</button>
                      <button className="btn btn-primary btn-sm" onClick={() => void handleSubmit()} disabled={!confirmed || submitting}>
                        <i className="fa-solid fa-paper-plane" /> {submitting ? 'Submitting…' : 'Submit Application'}
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
