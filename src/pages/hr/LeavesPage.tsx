import { Fragment, useMemo, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/hooks/useAuth';
import { useUserRole } from '@/hooks/hr/useUserRole';
import { useLeaveRequests, useLeaveTypes, type LeaveRequestWithJoins } from '@/hooks/hr/useLeaves';
import { useEmployees } from '@/hooks/hr/useEmployees';
import { calcLeaveDays, BOTSWANA_HOLIDAYS_2026 } from '@/lib/hr/payrollEngine';
import { fmtDate } from '@/lib/hr/leaveUtils';
import {
  type ApprovalStage,
  canActOnStage,
  COMPANY_SETTING_KEYS,
  isStageColumnMissingError,
  LEAVE_SUPER_ADMIN_THRESHOLD_DAYS,
  leaveRequiredStages,
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
  if (s === 'approved') return 'badge badge-active';
  if (s === 'rejected') return 'badge badge-fail';
  if (s === 'cancelled') return 'badge badge-inactive';
  return 'badge badge-pending';
};

export default function LeavesPage() {
  const { toast } = useApp();
  const { user } = useAuth();
  const { can, isHR, isAdmin, isSuperAdmin } = useUserRole();
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
  const userId = user?.id ?? null;
  const roleFlags = { isHR, isAdmin, isSuperAdmin };

  // Workflow-engine access lookup — tells us which rows are driven by a
  // configurable workflow and which the current user can act on. Engine
  // takes precedence over the legacy canActOnStage() role gate.
  const requestIdList = useMemo(() => requests.map((r) => r.id), [requests]);
  const { engineRequestIds, actionableRequestIds } = useWorkflowAccess(
    'leave',
    requestIdList,
    userId,
  );

  // Per-row "show approval timeline" toggle.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const toggleExpand = (id: string) =>
    setExpanded((p) => ({ ...p, [id]: !p[id] }));

  const computedDays = useMemo(() => {
    if (!form.start_date || !form.end_date) return 0;
    return calcLeaveDays(form.start_date, form.end_date, BOTSWANA_HOLIDAYS_2026);
  }, [form.start_date, form.end_date]);

  const buildLeaveCtx = (r: LeaveRequestWithJoins): RequestContext => ({
    requestType: 'leave',
    requestId: r.id,
    requestRef: r.id.slice(0, 8),
    employeeId: r.employee_id ?? '',
    employeeName: r.employee_name ?? null,
    typeLabel: r.leave_type_name ?? 'Leave',
    summary: `${r.number_of_days} day${r.number_of_days === 1 ? '' : 's'} (${fmtDate(r.start_date)} → ${fmtDate(r.end_date)})`,
  });

  const handleCreate = async () => {
    if (!form.employee_id || !form.leave_type_id || !form.start_date || !form.end_date) {
      toast('Please fill required fields', 'error');
      return;
    }
    if (computedDays <= 0) { toast('End date must be on or after start date', 'error'); return; }

    const threshold = await getCompanySettingNumber(
      COMPANY_SETTING_KEYS.LEAVE_THRESHOLD,
      LEAVE_SUPER_ADMIN_THRESHOLD_DAYS,
    );
    const stages = leaveRequiredStages(computedDays, threshold);
    const basePayload: Record<string, unknown> = {
      employee_id: form.employee_id,
      leave_type_id: form.leave_type_id,
      start_date: form.start_date,
      end_date: form.end_date,
      number_of_days: computedDays,
      reason: form.reason.trim() || null,
      status: 'pending',
      current_stage: stages[0],
      required_stages: stages,
    };

    let { data: inserted, error } = await supabase
      .from('leave_requests')
      .insert(basePayload)
      .select('*, leave_types(name)')
      .single();
    if (error && isStageColumnMissingError(error)) {
      // Pre-migration fallback: insert without stage columns.
      const legacy = stripStageFields(basePayload);
      const retry = await supabase
        .from('leave_requests')
        .insert(legacy)
        .select('*, leave_types(name)')
        .single();
      inserted = retry.data;
      error = retry.error;
    }
    if (error) { toast(error.message, 'error'); return; }

    // Fire-and-forget notification fan-out. If a workflow is assigned to this
    // leave type / department / employee group / globally, start an engine
    // instance and emit workflow-aware notifications. Otherwise stay on the
    // legacy 3-stage path.
    if (inserted) {
      const insertedId = (inserted as { id: string }).id;
      const emp = employees.find((e) => e.id === form.employee_id);
      const lt = leaveTypes.find((t) => t.id === form.leave_type_id);
      const ctx: RequestContext = {
        requestType: 'leave',
        requestId: insertedId,
        requestRef: insertedId.slice(0, 8),
        employeeId: form.employee_id,
        employeeName: emp?.employee_name ?? null,
        typeLabel: lt?.name ?? 'Leave',
        summary: `${computedDays} day${computedDays === 1 ? '' : 's'} (${form.start_date} → ${form.end_date})`,
      };
      void (async () => {
        const matched = await resolveWorkflowForRequest('leave', {
          leaveTypeId: form.leave_type_id,
          departmentId: emp?.hr_department_id ?? null,
          employeeId: form.employee_id,
        });
        if (matched) {
          const started = await startWorkflowInstance('leave', insertedId, matched.id);
          if (started) {
            void notifyWorkflowSubmitted({
              ctx,
              stage: started.firstStage,
              actorUserId: userId,
            });
            return;
          }
        }
        void notifySubmitted(ctx, stages[0], userId);
      })();
    }

    toast('Leave request created', 'success');
    setForm({ employee_id: '', leave_type_id: '', start_date: '', end_date: '', reason: '' });
    setCreating(false);
    void refetch();
  };

  const handleApprove = async (r: LeaveRequestWithJoins) => {
    // Engine path first: if this request has a workflow_instance, route the
    // decision through actOnStage and bail out before touching the legacy
    // logic.
    if (engineRequestIds.has(r.id) && userId) {
      const inst = await getActiveInstance('leave', r.id);
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
        // Mirror final status onto the parent row for the legacy bell + lists.
        if (result.outcome === 'completed') {
          await supabase
            .from('leave_requests')
            .update({
              status: 'approved',
              current_stage: null,
              approved_at: new Date().toISOString(),
              approved_by: userId,
            } as never)
            .eq('id', r.id);
        }
        void notifyWorkflowStageApproved({
          ctx: buildLeaveCtx(r),
          stage: result.actedStage,
          nextStage: result.nextStage,
          actorUserId: userId,
        });
        toast(
          result.outcome === 'completed'
            ? 'Leave fully approved.'
            : result.outcome === 'advanced' && result.nextStage
              ? `Approved — forwarded to ${result.nextStage.stage_name}.`
              : result.outcome === 'waiting'
                ? 'Your approval recorded — waiting on the remaining approvers for this stage.'
                : 'Approval recorded.',
          'success',
        );
        void refetch();
        return;
      }
    }

    // Legacy 3-stage path
    const stages = (r.required_stages ?? null) as ApprovalStage[] | null;
    const currentStage = (r.current_stage ?? null) as ApprovalStage | null;
    if (currentStage && !canActOnStage(currentStage, roleFlags)) {
      toast(`Only ${stageLabel(currentStage)} can approve this stage.`, 'error');
      return;
    }
    const next = nextStage(stages, currentStage);
    const updates: Record<string, unknown> = next
      ? { current_stage: next }
      : {
          status: 'approved',
          current_stage: null,
          approved_at: new Date().toISOString(),
          approved_by: userId,
        };

    let { error } = await supabase
      .from('leave_requests')
      .update(updates)
      .eq('id', r.id);
    if (error && isStageColumnMissingError(error)) {
      // Pre-migration fallback: jump straight to fully approved.
      const legacy = stripStageFields({
        status: 'approved',
        approved_at: new Date().toISOString(),
        approved_by: userId,
      });
      ({ error } = await supabase.from('leave_requests').update(legacy).eq('id', r.id));
    }
    if (error) { toast(error.message, 'error'); return; }

    void notifyStageApproved(
      buildLeaveCtx(r),
      (currentStage ?? 'hr') as ApprovalStage,
      next,
      userId,
    );
    toast(
      next ? `Approved — forwarded to ${stageLabel(next)}.` : 'Leave fully approved.',
      'success',
    );
    void refetch();
  };

  const handleReject = async (r: LeaveRequestWithJoins) => {
    const reason = window.prompt('Reason for rejection:')?.trim() ?? '';
    if (!reason) { toast('A rejection reason is required.', 'error'); return; }

    // Engine path
    if (engineRequestIds.has(r.id) && userId) {
      const inst = await getActiveInstance('leave', r.id);
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
          .from('leave_requests')
          .update({
            status: 'rejected',
            approver_comment: reason,
            rejection_reason: reason,
            approved_at: new Date().toISOString(),
            approved_by: userId,
          } as never)
          .eq('id', r.id);
        void notifyWorkflowRejected({
          ctx: buildLeaveCtx(r),
          stage: result.actedStage,
          actorUserId: userId,
          reason,
        });
        toast('Leave rejected.', 'info');
        void refetch();
        return;
      }
    }

    // Legacy path
    const currentStage = (r.current_stage ?? null) as ApprovalStage | null;
    if (currentStage && !canActOnStage(currentStage, roleFlags)) {
      toast(`Only ${stageLabel(currentStage)} can reject this stage.`, 'error');
      return;
    }
    const payload: Record<string, unknown> = {
      status: 'rejected',
      approver_comment: reason,
      rejection_reason: reason,
      approved_at: new Date().toISOString(),
      approved_by: userId,
    };
    let { error } = await supabase.from('leave_requests').update(payload).eq('id', r.id);
    if (error && isStageColumnMissingError(error)) {
      const legacy = stripStageFields(payload);
      ({ error } = await supabase.from('leave_requests').update(legacy).eq('id', r.id));
    }
    if (error) { toast(error.message, 'error'); return; }

    void notifyRejected(buildLeaveCtx(r), (currentStage ?? 'hr') as ApprovalStage, userId, reason);
    toast('Leave rejected.', 'info');
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
                {requests.map((r) => {
                  const isEngine = engineRequestIds.has(r.id);
                  const canActOnRow = isEngine
                    ? actionableRequestIds.has(r.id)
                    : canActOnStage((r.current_stage ?? null) as ApprovalStage | null, roleFlags);
                  return (
                    <Fragment key={r.id}>
                      <tr>
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
                        <td>
                          <span className={statusBadge(r.status)}>{r.status}</span>
                          {r.status === 'pending' && r.current_stage && (
                            <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>
                              {isEngine ? 'In workflow' : `Awaiting ${stageLabel(r.current_stage as ApprovalStage)}`}
                            </div>
                          )}
                          {isEngine && (
                            <button
                              onClick={() => toggleExpand(r.id)}
                              style={{ fontSize: 10, color: '#2563eb', marginTop: 2, background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                            >
                              {expanded[r.id] ? 'Hide progress' : 'View progress'}
                            </button>
                          )}
                        </td>
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                          {writeOk && r.status === 'pending' && canActOnRow && (
                            <>
                              <button className="btn btn-green btn-sm" onClick={() => void handleApprove(r)} style={{ marginRight: 4 }} title="Approve">
                                <i className="fa-solid fa-check" />
                              </button>
                              <button className="btn btn-danger btn-sm" onClick={() => void handleReject(r)} title="Reject">
                                <i className="fa-solid fa-xmark" />
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                      {isEngine && expanded[r.id] && (
                        <tr>
                          <td colSpan={7} style={{ background: '#fafbfc', padding: 12 }}>
                            <WorkflowStepper requestType="leave" requestId={r.id} />
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
