import { Fragment, useEffect, useMemo, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/hooks/useAuth';
import { useUserRole } from '@/hooks/hr/useUserRole';
import { useAdvances, nextAdvanceReference, type AdvanceSalaryWithEmployee } from '@/hooks/hr/useLoans';
import { useEmployees } from '@/hooks/hr/useEmployees';
import { fmtCurrency, fmtDate } from '@/lib/hr/leaveUtils';
import {
  type ApprovalStage,
  canActOnStage,
  COMPANY_SETTING_KEYS,
  isStageColumnMissingError,
  loanRequiredStages,
  LOAN_SUPER_ADMIN_THRESHOLD_AMOUNT,
  nextStage,
  stageLabel,
  stripStageFields,
} from '@/lib/hr/approvalWorkflow';
import { getCompanySettingNumber } from '@/lib/hr/companySettings';
import {
  notifyRejected,
  notifyStageApproved,
  notifySubmitted,
  type RequestContext,
} from '@/lib/hr/notificationService';
import {
  actOnStage,
  getActiveInstance,
  resolveWorkflowForRequest,
  startWorkflowInstance,
  notifyWorkflowSubmitted,
  notifyWorkflowStageApproved,
  notifyWorkflowRejected,
} from '@/lib/hr/workflowEngine';
import { useWorkflowAccess } from '@/hooks/hr/useWorkflowAccess';
import WorkflowStepper from '@/components/hr/workflow/WorkflowStepper';
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
  const { user } = useAuth();
  const { can, isHR, isAdmin, isSuperAdmin } = useUserRole();
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
  const userId = user?.id ?? null;
  const roleFlags = { isHR, isAdmin, isSuperAdmin };

  // Workflow-engine access lookup — see useWorkflowAccess header.
  const requestIdList = useMemo(() => advances.map((a) => a.id), [advances]);
  const { engineRequestIds, actionableRequestIds } = useWorkflowAccess(
    'loan',
    requestIdList,
    userId,
  );

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const toggleExpand = (id: string) =>
    setExpanded((p) => ({ ...p, [id]: !p[id] }));

  useEffect(() => {
    void supabase
      .from('loan_types')
      .select('id, name')
      .eq('is_active', true)
      .order('name')
      .then(({ data }) => setLoanTypes((data ?? []) as Array<{ id: string; name: string }>));
  }, []);

  const buildLoanCtx = (a: AdvanceSalaryWithEmployee): RequestContext => ({
    requestType: 'loan',
    requestId: a.id,
    requestRef: a.reference,
    employeeId: a.employee_id ?? '',
    employeeName: a.employee_name ?? null,
    typeLabel: a.loan_type ?? 'Loan',
    summary: `${fmtCurrency(a.total_amount)} · ${a.installments} installment${a.installments === 1 ? '' : 's'}`,
  });

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
    const threshold = await getCompanySettingNumber(
      COMPANY_SETTING_KEYS.LOAN_THRESHOLD,
      LOAN_SUPER_ADMIN_THRESHOLD_AMOUNT,
    );
    const stages = loanRequiredStages(total, threshold);
    const basePayload: Record<string, unknown> = {
      reference,
      employee_id: form.employee_id,
      loan_type: form.loan_type,
      total_amount: total,
      monthly_installment: monthly,
      installments,
      remaining_amount: total,
      status: 'Submitted',
      notes: form.notes.trim() || null,
      current_stage: stages[0],
      required_stages: stages,
    };

    let { data: inserted, error } = await supabase
      .from('advance_salaries')
      .insert(basePayload)
      .select('id')
      .single();
    if (error && isStageColumnMissingError(error)) {
      const legacy = stripStageFields(basePayload);
      const retry = await supabase
        .from('advance_salaries')
        .insert(legacy)
        .select('id')
        .single();
      inserted = retry.data;
      error = retry.error;
    }
    if (error) { toast(error.message, 'error'); return; }

    const insertedId = (inserted as { id: string } | null)?.id ?? null;
    const emp = employees.find((e) => e.id === form.employee_id);
    // workflow_instances.request_id should match advance_salaries.id so the
    // engine's mirror + lookups work; legacy ctx kept reference for the
    // notification body.
    const ctx: RequestContext = {
      requestType: 'loan',
      requestId: insertedId ?? reference,
      requestRef: reference,
      employeeId: form.employee_id,
      employeeName: emp?.employee_name ?? null,
      typeLabel: form.loan_type,
      summary: `${fmtCurrency(total)} · ${installments} installment${installments === 1 ? '' : 's'}`,
    };

    // Resolve workflow by loan_type id (advance_salaries.loan_type stores
    // the name, not the FK — look up the id by name).
    void (async () => {
      const matchedLoanType = loanTypes.find((t) => t.name === form.loan_type);
      if (insertedId) {
        const matched = await resolveWorkflowForRequest('loan', {
          loanTypeId: matchedLoanType?.id ?? null,
          departmentId: emp?.hr_department_id ?? null,
          employeeId: form.employee_id,
        });
        if (matched) {
          const started = await startWorkflowInstance('loan', insertedId, matched.id);
          if (started) {
            void notifyWorkflowSubmitted({
              ctx,
              stage: started.firstStage,
              actorUserId: userId,
            });
            return;
          }
        }
      }
      void notifySubmitted(ctx, stages[0], userId);
    })();

    toast(`Loan ${reference} submitted`, 'success');
    setForm({ employee_id: '', loan_type: 'Salary Advance', total_amount: '', monthly_installment: '', installments: '1', notes: '' });
    setCreating(false);
    void refetch();
  };

  const handleApprove = async (a: AdvanceSalaryWithEmployee) => {
    // Engine path
    if (engineRequestIds.has(a.id) && userId) {
      const inst = await getActiveInstance('loan', a.id);
      if (inst) {
        const result = await actOnStage({
          instanceId: inst.id,
          action: 'approved',
          userId,
        });
        if (!result) {
          toast('You are not authorised to approve this stage.', 'error');
          return;
        }
        if (result.outcome === 'completed') {
          await supabase
            .from('advance_salaries')
            .update({ status: 'Approved', current_stage: null } as never)
            .eq('id', a.id);
        }
        void notifyWorkflowStageApproved({
          ctx: buildLoanCtx(a),
          stage: result.actedStage,
          nextStage: result.nextStage,
          actorUserId: userId,
        });
        toast(
          result.outcome === 'completed'
            ? `Loan ${a.reference} fully approved.`
            : result.outcome === 'advanced' && result.nextStage
              ? `Loan ${a.reference} approved — forwarded to ${result.nextStage.stage_name}.`
              : result.outcome === 'waiting'
                ? 'Your approval recorded — waiting on remaining approvers.'
                : 'Approval recorded.',
          'success',
        );
        void refetch();
        return;
      }
    }

    // Legacy path
    const stages = (a.required_stages ?? null) as ApprovalStage[] | null;
    const currentStage = (a.current_stage ?? null) as ApprovalStage | null;
    if (currentStage && !canActOnStage(currentStage, roleFlags)) {
      toast(`Only ${stageLabel(currentStage)} can approve this stage.`, 'error');
      return;
    }
    const next = nextStage(stages, currentStage);
    const updates: Record<string, unknown> = next
      ? { current_stage: next }
      : { status: 'Approved', current_stage: null };

    let { error } = await supabase.from('advance_salaries').update(updates).eq('id', a.id);
    if (error && isStageColumnMissingError(error)) {
      const legacy = stripStageFields({ status: 'Approved' });
      ({ error } = await supabase.from('advance_salaries').update(legacy).eq('id', a.id));
    }
    if (error) { toast(error.message, 'error'); return; }

    void notifyStageApproved(
      buildLoanCtx(a),
      (currentStage ?? 'hr') as ApprovalStage,
      next,
      userId,
    );
    toast(
      next ? `Loan ${a.reference} approved — forwarded to ${stageLabel(next)}.` : `Loan ${a.reference} fully approved.`,
      'success',
    );
    void refetch();
  };

  const handleReject = async (a: AdvanceSalaryWithEmployee) => {
    const reason = window.prompt('Reason for rejection:')?.trim() ?? '';
    if (!reason) { toast('A rejection reason is required.', 'error'); return; }

    // Engine path
    if (engineRequestIds.has(a.id) && userId) {
      const inst = await getActiveInstance('loan', a.id);
      if (inst) {
        const result = await actOnStage({
          instanceId: inst.id,
          action: 'rejected',
          userId,
          comment: reason,
        });
        if (!result) {
          toast('You are not authorised to reject this stage.', 'error');
          return;
        }
        await supabase
          .from('advance_salaries')
          .update({ status: 'Rejected', rejection_reason: reason } as never)
          .eq('id', a.id);
        void notifyWorkflowRejected({
          ctx: buildLoanCtx(a),
          stage: result.actedStage,
          actorUserId: userId,
          reason,
        });
        toast(`Loan ${a.reference} rejected.`, 'info');
        void refetch();
        return;
      }
    }

    // Legacy path
    const currentStage = (a.current_stage ?? null) as ApprovalStage | null;
    if (currentStage && !canActOnStage(currentStage, roleFlags)) {
      toast(`Only ${stageLabel(currentStage)} can reject this stage.`, 'error');
      return;
    }
    const payload: Record<string, unknown> = {
      status: 'Rejected',
      rejection_reason: reason,
    };
    let { error } = await supabase.from('advance_salaries').update(payload).eq('id', a.id);
    if (error && isStageColumnMissingError(error)) {
      const legacy = stripStageFields(payload);
      ({ error } = await supabase.from('advance_salaries').update(legacy).eq('id', a.id));
    }
    if (error) { toast(error.message, 'error'); return; }

    void notifyRejected(buildLoanCtx(a), (currentStage ?? 'hr') as ApprovalStage, userId, reason);
    toast(`Loan ${a.reference} rejected.`, 'info');
    void refetch();
  };

  const handleComplete = async (a: AdvanceSalaryWithEmployee) => {
    const { error } = await supabase
      .from('advance_salaries')
      .update({ status: 'Completed' })
      .eq('id', a.id);
    if (error) { toast(error.message, 'error'); return; }
    toast(`Loan ${a.reference} marked completed.`, 'info');
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
                {advances.map((a) => {
                  const isEngine = engineRequestIds.has(a.id);
                  const canActOnRow = isEngine
                    ? actionableRequestIds.has(a.id)
                    : canActOnStage((a.current_stage ?? null) as ApprovalStage | null, roleFlags);
                  return (
                    <Fragment key={a.id}>
                      <tr>
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
                        <td>
                          <span className={statusBadge(a.status)}>{a.status}</span>
                          {a.status === 'Submitted' && a.current_stage && (
                            <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>
                              {isEngine ? 'In workflow' : `Awaiting ${stageLabel(a.current_stage as ApprovalStage)}`}
                            </div>
                          )}
                          {isEngine && (
                            <button
                              onClick={() => toggleExpand(a.id)}
                              style={{ fontSize: 10, color: '#2563eb', marginTop: 2, background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                            >
                              {expanded[a.id] ? 'Hide progress' : 'View progress'}
                            </button>
                          )}
                        </td>
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                          {writeOk && a.status === 'Submitted' && canActOnRow && (
                            <>
                              <button className="btn btn-green btn-sm" onClick={() => void handleApprove(a)} style={{ marginRight: 4 }} title="Approve">
                                <i className="fa-solid fa-check" />
                              </button>
                              <button className="btn btn-danger btn-sm" onClick={() => void handleReject(a)} title="Reject">
                                <i className="fa-solid fa-xmark" />
                              </button>
                            </>
                          )}
                          {writeOk && a.status === 'Approved' && (
                            <button className="btn btn-outline btn-sm" onClick={() => void handleComplete(a)} title="Mark completed">
                              <i className="fa-solid fa-flag-checkered" />
                            </button>
                          )}
                        </td>
                      </tr>
                      {isEngine && expanded[a.id] && (
                        <tr>
                          <td colSpan={10} style={{ background: '#fafbfc', padding: 12 }}>
                            <WorkflowStepper requestType="loan" requestId={a.id} />
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
    </>
  );
}
