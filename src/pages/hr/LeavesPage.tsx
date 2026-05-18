import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/hooks/useAuth';
import { useUserRole } from '@/hooks/hr/useUserRole';
import { useLeaveTypes, type LeaveRequestWithJoins } from '@/hooks/hr/useLeaves';
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
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';

type Tab = 'dashboard' | 'requests' | 'balances' | 'calendar';

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const statusBadge = (s: string): string => {
  if (s === 'approved') return 'badge badge-active';
  if (s === 'rejected') return 'badge badge-fail';
  if (s === 'cancelled') return 'badge badge-inactive';
  return 'badge badge-pending';
};

interface Allocation {
  id: string;
  employee_id: string;
  leave_type_id: string;
  year: number;
  opening_balance: number;
  allocated_days: number;
  used_days: number;
  pending_days: number;
  remaining_days: number;
}

export default function LeavesPage() {
  const { toast, showModal } = useApp();
  const { user } = useAuth();
  const { can, isHR, isAdmin, isSuperAdmin } = useUserRole();
  const { employees } = useEmployees();
  const { types: leaveTypes } = useLeaveTypes();
  const writeOk = can('leaves', 'write');
  const userId = user?.id ?? null;
  const roleFlags = { isHR, isAdmin, isSuperAdmin };

  const [tab, setTab] = useState<Tab>('dashboard');
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [search, setSearch] = useState('');

  // Requests
  const [requests, setRequests] = useState<LeaveRequestWithJoins[]>([]);
  const [reqLoading, setReqLoading] = useState(true);

  // Allocations (balances)
  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const [allocLoading, setAllocLoading] = useState(true);

  // Expanded workflow rows
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const toggleExpand = (id: string) => setExpanded(p => ({ ...p, [id]: !p[id] }));

  const year = new Date().getFullYear();

  // ─── Load requests ────────────────────────────────────────────────────
  const loadRequests = useCallback(async () => {
    setReqLoading(true);
    let q = supabase
      .from('leave_requests')
      .select('*, employees!leave_requests_employee_id_fkey(employee_name, employee_code, branch_name, department), leave_types(name, color, code)')
      .order('created_at', { ascending: false });
    if (statusFilter !== 'all') q = q.eq('status', statusFilter);
    if (typeFilter !== 'all') q = q.eq('leave_type_id', typeFilter);
    const { data, error } = await q;
    if (error) { toast(error.message, 'error'); setReqLoading(false); return; }
    setRequests((data ?? []).map((r: Record<string, unknown>) => ({
      ...(r as unknown as LeaveRequestWithJoins),
      employee_name: (r.employees as any)?.employee_name ?? null,
      employee_code: (r.employees as any)?.employee_code ?? null,
      leave_type_name: (r.leave_types as any)?.name ?? null,
      leave_type_color: (r.leave_types as any)?.color ?? null,
    })));
    setReqLoading(false);
  }, [statusFilter, typeFilter, toast]);

  // ─── Load allocations ─────────────────────────────────────────────────
  const loadAllocations = useCallback(async () => {
    setAllocLoading(true);
    const { data } = await supabase
      .from('leave_allocations')
      .select('*, employees(employee_name, employee_code), leave_types(name, color, code)')
      .eq('year', year)
      .order('employee_id');
    setAllocations((data ?? []) as Allocation[]);
    setAllocLoading(false);
  }, [year]);

  useEffect(() => { void loadRequests(); }, [loadRequests]);
  useEffect(() => { void loadAllocations(); }, [loadAllocations]);

  // ─── Workflow access ──────────────────────────────────────────────────
  const requestIdList = useMemo(() => requests.map(r => r.id), [requests]);
  const { engineRequestIds, actionableRequestIds } = useWorkflowAccess('leave', requestIdList, userId);

  // ─── Filtered requests for table ─────────────────────────────────────
  const filtered = useMemo(() => requests.filter(r => {
    if (!search) return true;
    return (r.employee_name ?? '').toLowerCase().includes(search.toLowerCase()) ||
           (r.leave_type_name ?? '').toLowerCase().includes(search.toLowerCase());
  }), [requests, search]);

  // ─── Dashboard stats ──────────────────────────────────────────────────
  const stats = useMemo(() => {
    const total    = requests.length;
    const pending  = requests.filter(r => r.status === 'pending').length;
    const approved = requests.filter(r => r.status === 'approved').length;
    const rejected = requests.filter(r => r.status === 'rejected').length;
    const thisMonth = new Date().getMonth();
    const thisYear  = new Date().getFullYear();
    const onLeave = requests.filter(r => {
      if (r.status !== 'approved') return false;
      const s = new Date(r.start_date), e = new Date(r.end_date), now = new Date();
      return s <= now && e >= now;
    }).length;
    return { total, pending, approved, rejected, onLeave, thisMonth, thisYear };
  }, [requests]);

  // Monthly chart data
  const chartData = useMemo(() => MONTH_NAMES.map((m, mi) => {
    const row: Record<string, unknown> = { month: m };
    for (const lt of leaveTypes) {
      row[lt.code ?? lt.name] = requests.filter(r =>
        r.status === 'approved' &&
        r.leave_type_id === lt.id &&
        new Date(r.start_date).getMonth() === mi &&
        new Date(r.start_date).getFullYear() === year
      ).reduce((s, r) => s + (r.num_days ?? r.number_of_days ?? 0), 0);
    }
    return row;
  }), [requests, leaveTypes, year]);

  // ─── Approval helpers ─────────────────────────────────────────────────
  const buildCtx = (r: LeaveRequestWithJoins): RequestContext => ({
    requestType: 'leave',
    requestId: r.id,
    requestRef: r.leave_ref ?? r.id.slice(0, 8),
    employeeId: r.employee_id ?? '',
    employeeName: r.employee_name ?? null,
    typeLabel: r.leave_type_name ?? 'Leave',
    summary: `${r.num_days ?? r.number_of_days} day(s) (${fmtDate(r.start_date)} → ${fmtDate(r.end_date)})`,
  });

  const deductAllocation = async (r: LeaveRequestWithJoins) => {
    if (!r.employee_id || !r.leave_type_id) return;
    const days = r.num_days ?? r.number_of_days ?? 0;
    const alloc = allocations.find(a => a.employee_id === r.employee_id && a.leave_type_id === r.leave_type_id && a.year === year);
    if (alloc) {
      await supabase.from('leave_allocations').update({
        used_days: (alloc.used_days ?? 0) + days,
        pending_days: Math.max(0, (alloc.pending_days ?? 0) - days),
      } as never).eq('id', alloc.id);
    }
  };

  const reverseAllocationPending = async (r: LeaveRequestWithJoins) => {
    if (!r.employee_id || !r.leave_type_id) return;
    const days = r.num_days ?? r.number_of_days ?? 0;
    const alloc = allocations.find(a => a.employee_id === r.employee_id && a.leave_type_id === r.leave_type_id && a.year === year);
    if (alloc) {
      await supabase.from('leave_allocations').update({
        pending_days: Math.max(0, (alloc.pending_days ?? 0) - days),
      } as never).eq('id', alloc.id);
    }
  };

  const handleApprove = async (r: LeaveRequestWithJoins) => {
    if (engineRequestIds.has(r.id) && userId) {
      const inst = await getActiveInstance('leave', r.id);
      if (inst) {
        const result = await actOnStage({ instanceId: inst.id, action: 'approved', userId });
        if (!result) { toast('Not authorised to approve this stage.', 'error'); return; }
        if (result.outcome === 'completed') {
          await supabase.from('leave_requests').update({ status: 'approved', current_stage: null, approved_at: new Date().toISOString(), approved_by: userId, approved_date: new Date().toISOString().slice(0, 10) } as never).eq('id', r.id);
          await deductAllocation(r);
        }
        void notifyWorkflowStageApproved({ ctx: buildCtx(r), stage: result.actedStage, nextStage: result.nextStage, actorUserId: userId });
        toast(result.outcome === 'completed' ? 'Leave fully approved.' : result.outcome === 'advanced' && result.nextStage ? `Approved — forwarded to ${result.nextStage.stage_name}.` : 'Approval recorded.', 'success');
        void loadRequests(); void loadAllocations(); return;
      }
    }
    // Legacy path
    const stages = (r.required_stages ?? null) as ApprovalStage[] | null;
    const currentStage = (r.current_stage ?? null) as ApprovalStage | null;
    if (currentStage && !canActOnStage(currentStage, roleFlags)) { toast(`Only ${stageLabel(currentStage)} can approve this stage.`, 'error'); return; }
    const next = nextStage(stages, currentStage);
    const updates: Record<string, unknown> = next
      ? { current_stage: next }
      : { status: 'approved', current_stage: null, approved_at: new Date().toISOString(), approved_by: userId, approved_date: new Date().toISOString().slice(0, 10) };
    let { error } = await supabase.from('leave_requests').update(updates).eq('id', r.id);
    if (error && isStageColumnMissingError(error)) {
      const legacy = stripStageFields({ status: 'approved', approved_at: new Date().toISOString(), approved_by: userId, approved_date: new Date().toISOString().slice(0, 10) });
      ({ error } = await supabase.from('leave_requests').update(legacy).eq('id', r.id));
    }
    if (error) { toast(error.message, 'error'); return; }
    if (!next) await deductAllocation(r);
    void notifyStageApproved(buildCtx(r), (currentStage ?? 'hr') as ApprovalStage, next, userId);
    toast(next ? `Approved — forwarded to ${stageLabel(next)}.` : 'Leave fully approved.', 'success');
    void loadRequests(); void loadAllocations();
  };

  const handleReject = async (r: LeaveRequestWithJoins) => {
    const reason = window.prompt('Reason for rejection:')?.trim() ?? '';
    if (!reason) { toast('A rejection reason is required.', 'error'); return; }
    if (engineRequestIds.has(r.id) && userId) {
      const inst = await getActiveInstance('leave', r.id);
      if (inst) {
        const result = await actOnStage({ instanceId: inst.id, action: 'rejected', userId, comment: reason });
        if (!result) { toast('Not authorised to reject this stage.', 'error'); return; }
        await supabase.from('leave_requests').update({ status: 'rejected', approver_comment: reason, rejection_reason: reason, approved_at: new Date().toISOString(), approved_by: userId } as never).eq('id', r.id);
        await reverseAllocationPending(r);
        void notifyWorkflowRejected({ ctx: buildCtx(r), stage: result.actedStage, actorUserId: userId, reason });
        toast('Leave rejected.', 'info'); void loadRequests(); void loadAllocations(); return;
      }
    }
    const currentStage = (r.current_stage ?? null) as ApprovalStage | null;
    if (currentStage && !canActOnStage(currentStage, roleFlags)) { toast(`Only ${stageLabel(currentStage)} can reject this stage.`, 'error'); return; }
    const payload: Record<string, unknown> = { status: 'rejected', approver_comment: reason, rejection_reason: reason, approved_at: new Date().toISOString(), approved_by: userId };
    let { error } = await supabase.from('leave_requests').update(payload).eq('id', r.id);
    if (error && isStageColumnMissingError(error)) { ({ error } = await supabase.from('leave_requests').update(stripStageFields(payload)).eq('id', r.id)); }
    if (error) { toast(error.message, 'error'); return; }
    await reverseAllocationPending(r);
    void notifyRejected(buildCtx(r), (currentStage ?? 'hr') as ApprovalStage, userId, reason);
    toast('Leave rejected.', 'info'); void loadRequests(); void loadAllocations();
  };

  // ─── Apply on behalf ──────────────────────────────────────────────────
  const [applyForm, setApplyForm] = useState({ employee_id: '', leave_type_id: '', start_date: '', end_date: '', reason: '', handover_notes: '', admin_notes: '' });
  const applyDays = useMemo(() => {
    if (!applyForm.start_date || !applyForm.end_date) return 0;
    return calcLeaveDays(applyForm.start_date, applyForm.end_date, BOTSWANA_HOLIDAYS_2026);
  }, [applyForm.start_date, applyForm.end_date]);

  const handleApplyOnBehalf = async () => {
    if (!applyForm.employee_id || !applyForm.leave_type_id || !applyForm.start_date || !applyForm.end_date) { toast('Please fill required fields', 'error'); return; }
    if (applyDays <= 0) { toast('End date must be on or after start date', 'error'); return; }
    const threshold = await getCompanySettingNumber(COMPANY_SETTING_KEYS.LEAVE_THRESHOLD, LEAVE_SUPER_ADMIN_THRESHOLD_DAYS);
    const stages = leaveRequiredStages(applyDays, threshold);
    const payload: Record<string, unknown> = {
      employee_id: applyForm.employee_id,
      leave_type_id: applyForm.leave_type_id,
      start_date: applyForm.start_date,
      end_date: applyForm.end_date,
      number_of_days: applyDays,
      num_days: applyDays,
      reason: applyForm.reason.trim() || null,
      handover_notes: applyForm.handover_notes.trim() || null,
      admin_notes: applyForm.admin_notes.trim() || null,
      status: 'pending',
      current_stage: stages[0],
      required_stages: stages,
      applied_date: new Date().toISOString().slice(0, 10),
    };
    let { data: inserted, error } = await supabase.from('leave_requests').insert(payload).select('*, leave_types(name)').single();
    if (error && isStageColumnMissingError(error)) {
      const retry = await supabase.from('leave_requests').insert(stripStageFields(payload)).select('*, leave_types(name)').single();
      inserted = retry.data; error = retry.error;
    }
    if (error) { toast(error.message, 'error'); return; }
    // Bump pending_days on allocation
    const alloc = allocations.find(a => a.employee_id === applyForm.employee_id && a.leave_type_id === applyForm.leave_type_id && a.year === year);
    if (alloc) {
      await supabase.from('leave_allocations').update({ pending_days: (alloc.pending_days ?? 0) + applyDays } as never).eq('id', alloc.id);
    }
    if (inserted) {
      const insertedId = (inserted as { id: string }).id;
      const emp = employees.find(e => e.id === applyForm.employee_id);
      const lt = leaveTypes.find(t => t.id === applyForm.leave_type_id);
      const ctx: RequestContext = { requestType: 'leave', requestId: insertedId, requestRef: insertedId.slice(0, 8), employeeId: applyForm.employee_id, employeeName: emp?.employee_name ?? null, typeLabel: lt?.name ?? 'Leave', summary: `${applyDays} day(s) (${applyForm.start_date} → ${applyForm.end_date})` };
      void (async () => {
        const matched = await resolveWorkflowForRequest('leave', { leaveTypeId: applyForm.leave_type_id, departmentId: emp?.hr_department_id ?? null, employeeId: applyForm.employee_id });
        if (matched) { const started = await startWorkflowInstance('leave', insertedId, matched.id); if (started) { void notifyWorkflowSubmitted({ ctx, stage: started.firstStage, actorUserId: userId }); return; } }
        void notifySubmitted(ctx, stages[0], userId);
      })();
    }
    toast('Leave request created', 'success');
    setApplyForm({ employee_id: '', leave_type_id: '', start_date: '', end_date: '', reason: '', handover_notes: '', admin_notes: '' });
    void loadRequests(); void loadAllocations();
  };

  const openApplyModal = () => {
    showModal('Apply Leave on Behalf', (
      <div>
        <div className="form-row cols2">
          <div className="form-group">
            <label>Employee *</label>
            <select className="form-select" value={applyForm.employee_id} onChange={e => setApplyForm(f => ({ ...f, employee_id: e.target.value }))}>
              <option value="">— Select —</option>
              {employees.map(e => <option key={e.id} value={e.id}>{e.employee_name} ({e.employee_code})</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Leave Type *</label>
            <select className="form-select" value={applyForm.leave_type_id} onChange={e => setApplyForm(f => ({ ...f, leave_type_id: e.target.value }))}>
              <option value="">— Select —</option>
              {leaveTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        </div>
        <div className="form-row cols2">
          <div className="form-group"><label>Start Date *</label><input type="date" className="form-input" value={applyForm.start_date} onChange={e => setApplyForm(f => ({ ...f, start_date: e.target.value }))} /></div>
          <div className="form-group"><label>End Date *</label><input type="date" className="form-input" value={applyForm.end_date} onChange={e => setApplyForm(f => ({ ...f, end_date: e.target.value }))} /></div>
        </div>
        {applyDays > 0 && <div style={{ marginBottom: 10, fontSize: 12, color: '#1a7f37', fontWeight: 600 }}>{applyDays} working day(s)</div>}
        <div className="form-group"><label>Reason</label><textarea rows={2} className="form-textarea" value={applyForm.reason} onChange={e => setApplyForm(f => ({ ...f, reason: e.target.value }))} /></div>
        <div className="form-group"><label>Handover Notes</label><textarea rows={2} className="form-textarea" value={applyForm.handover_notes} onChange={e => setApplyForm(f => ({ ...f, handover_notes: e.target.value }))} /></div>
        <div className="form-group"><label>Admin Notes</label><textarea rows={2} className="form-textarea" value={applyForm.admin_notes} onChange={e => setApplyForm(f => ({ ...f, admin_notes: e.target.value }))} /></div>
        <div style={{ textAlign: 'right' }}>
          <button className="btn btn-primary btn-sm" onClick={() => void handleApplyOnBehalf()}>
            <i className="fa-solid fa-paper-plane" /> Submit
          </button>
        </div>
      </div>
    ), 'large');
  };

  // ─── Edit leave dialog ────────────────────────────────────────────────
  const openEditModal = (r: LeaveRequestWithJoins) => {
    const ef = {
      leave_type_id: r.leave_type_id ?? '',
      start_date: r.start_date,
      end_date: r.end_date,
      reason: r.reason ?? '',
      handover_notes: r.handover_notes ?? '',
      admin_notes: r.admin_notes ?? '',
    };
    const editDays = ef.start_date && ef.end_date ? calcLeaveDays(ef.start_date, ef.end_date, BOTSWANA_HOLIDAYS_2026) : 0;
    showModal('Edit Leave Request', (
      <EditLeaveForm
        r={r}
        leaveTypes={leaveTypes}
        initialForm={ef}
        onSave={async (form, days) => {
          const { error } = await supabase.from('leave_requests').update({
            leave_type_id: form.leave_type_id,
            start_date: form.start_date,
            end_date: form.end_date,
            number_of_days: days,
            num_days: days,
            reason: form.reason.trim() || null,
            handover_notes: form.handover_notes.trim() || null,
            admin_notes: form.admin_notes.trim() || null,
          } as never).eq('id', r.id);
          if (error) { toast(error.message, 'error'); return; }
          toast('Leave updated.', 'success');
          void loadRequests();
        }}
      />
    ));
  };

  // ─── Balance edit dialog ──────────────────────────────────────────────
  const openBalanceEdit = (empId: string, empName: string) => {
    const empAllocs = allocations.filter(a => a.employee_id === empId && a.year === year);
    showModal(`Balances — ${empName}`, (
      <BalanceEditForm
        empId={empId}
        leaveTypes={leaveTypes}
        allocations={empAllocs}
        year={year}
        onSave={async () => { toast('Balances updated.', 'success'); void loadAllocations(); }}
        onError={(msg) => toast(msg, 'error')}
      />
    ), 'large');
  };

  // ─── Balances: group by employee ─────────────────────────────────────
  const balEmpMap = useMemo(() => {
    const map: Record<string, { name: string; code: string; allocs: Record<string, Allocation> }> = {};
    for (const a of allocations) {
      const ea = a as any;
      const id = a.employee_id;
      if (!map[id]) map[id] = { name: ea.employees?.employee_name ?? '—', code: ea.employees?.employee_code ?? '', allocs: {} };
      map[id].allocs[a.leave_type_id] = a;
    }
    return map;
  }, [allocations]);

  // ─── Calendar ─────────────────────────────────────────────────────────
  const [calMonth, setCalMonth] = useState(new Date().getMonth());
  const [calYear, setCalYear] = useState(new Date().getFullYear());
  const calDays = useMemo(() => {
    const first = new Date(calYear, calMonth, 1);
    const last  = new Date(calYear, calMonth + 1, 0);
    const days: Date[] = [];
    for (let d = new Date(first); d <= last; d.setDate(d.getDate() + 1)) days.push(new Date(d));
    return days;
  }, [calMonth, calYear]);
  const approvedRequests = useMemo(() => requests.filter(r => r.status === 'approved'), [requests]);

  const COLORS = ['#0D9488','#F59E0B','#EC4899','#8B5CF6','#6B7280','#EF4444','#0891B2','#059669'];

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Leave Management</div>
          <div className="page-sub">HR Management · {requests.length} requests</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {tab === 'requests' && writeOk && (
            <button className="btn btn-primary btn-sm" onClick={openApplyModal}>
              <i className="fa-solid fa-plus" /> Apply on Behalf
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="tabs">
        {(['dashboard','requests','balances','calendar'] as Tab[]).map(t => (
          <div key={t} className={`tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
            <i className={`fa-solid ${t === 'dashboard' ? 'fa-chart-bar' : t === 'requests' ? 'fa-list' : t === 'balances' ? 'fa-scale-balanced' : 'fa-calendar-days'}`} style={{ marginRight: 6 }} />
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </div>
        ))}
      </div>

      {/* ── DASHBOARD TAB ── */}
      {tab === 'dashboard' && (
        <>
          <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))' }}>
            <div className="stat-card"><div className="stat-icon"><i className="fa-solid fa-file-lines" /></div><div className="stat-val">{stats.total}</div><div className="stat-label">Total Requests</div></div>
            <div className="stat-card"><div className="stat-icon"><i className="fa-solid fa-clock" /></div><div className="stat-val">{stats.pending}</div><div className="stat-label">Pending</div></div>
            <div className="stat-card"><div className="stat-icon"><i className="fa-solid fa-circle-check" /></div><div className="stat-val">{stats.approved}</div><div className="stat-label">Approved</div></div>
            <div className="stat-card"><div className="stat-icon"><i className="fa-solid fa-circle-xmark" /></div><div className="stat-val">{stats.rejected}</div><div className="stat-label">Rejected</div></div>
            <div className="stat-card"><div className="stat-icon"><i className="fa-solid fa-user-clock" /></div><div className="stat-val">{stats.onLeave}</div><div className="stat-label">On Leave Now</div></div>
          </div>

          <div className="card">
            <div className="card-title"><span>Approved Leave Days by Month — {year}</span></div>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {leaveTypes.map((lt, i) => (
                  <Bar key={lt.id} dataKey={lt.code ?? lt.name} name={lt.name} fill={lt.color ?? COLORS[i % COLORS.length]} stackId="a" />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Pending requests quick list */}
          {stats.pending > 0 && (
            <div className="card" style={{ padding: 0 }}>
              <div style={{ padding: '14px 20px 12px', borderBottom: '1px solid var(--border)', fontSize: 13, fontWeight: 600 }}>
                Pending Requests ({stats.pending})
              </div>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Employee</th><th>Type</th><th>Period</th><th>Days</th><th style={{ textAlign: 'right' }}>Actions</th></tr></thead>
                  <tbody>
                    {requests.filter(r => r.status === 'pending').slice(0, 10).map(r => {
                      const canActOnRow = engineRequestIds.has(r.id) ? actionableRequestIds.has(r.id) : canActOnStage((r.current_stage ?? null) as ApprovalStage | null, roleFlags);
                      return (
                        <tr key={r.id}>
                          <td><div className="td-name">{r.employee_name ?? '—'}</div><div style={{ fontSize: 10, color: 'var(--text3)' }}>{r.employee_code}</div></td>
                          <td>{r.leave_type_name ?? '—'}</td>
                          <td>{fmtDate(r.start_date)} → {fmtDate(r.end_date)}</td>
                          <td>{r.num_days ?? r.number_of_days}</td>
                          <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                            {writeOk && canActOnRow && (
                              <>
                                <button className="btn btn-green btn-sm" onClick={() => void handleApprove(r)} style={{ marginRight: 4 }} title="Approve"><i className="fa-solid fa-check" /></button>
                                <button className="btn btn-danger btn-sm" onClick={() => void handleReject(r)} title="Reject"><i className="fa-solid fa-xmark" /></button>
                              </>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── REQUESTS TAB ── */}
      {tab === 'requests' && (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
            <select className="filter-select" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
              <option value="all">All Statuses</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="cancelled">Cancelled</option>
            </select>
            <select className="filter-select" value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
              <option value="all">All Types</option>
              {leaveTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <input className="form-input" style={{ width: 180, fontSize: 12, padding: '6px 10px' }} placeholder="Search employee…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>

          <div className="card" style={{ padding: 0 }}>
            {reqLoading ? (
              <div style={{ padding: 32, textAlign: 'center', color: 'var(--text2)' }}>Loading…</div>
            ) : filtered.length === 0 ? (
              <div style={{ padding: 32, textAlign: 'center', color: 'var(--text2)' }}>No requests.</div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Ref</th>
                      <th>Employee</th>
                      <th>Type</th>
                      <th>Period</th>
                      <th>Days</th>
                      <th>Status</th>
                      <th style={{ textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(r => {
                      const isEngine = engineRequestIds.has(r.id);
                      const canActOnRow = isEngine ? actionableRequestIds.has(r.id) : canActOnStage((r.current_stage ?? null) as ApprovalStage | null, roleFlags);
                      return (
                        <Fragment key={r.id}>
                          <tr>
                            <td style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text3)' }}>{r.leave_ref ?? r.id.slice(0, 8)}</td>
                            <td>
                              <div className="td-name">{r.employee_name ?? '—'}</div>
                              <div style={{ fontSize: 10, color: 'var(--text3)' }}>{r.employee_code}</div>
                            </td>
                            <td>
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                                <span style={{ width: 8, height: 8, borderRadius: 2, background: r.leave_type_color ?? '#0D9488' }} />
                                {r.leave_type_name ?? '—'}
                              </span>
                            </td>
                            <td>{fmtDate(r.start_date)} → {fmtDate(r.end_date)}</td>
                            <td>{r.num_days ?? r.number_of_days}</td>
                            <td>
                              <span className={statusBadge(r.status)}>{r.status}</span>
                              {r.status === 'pending' && r.current_stage && (
                                <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>
                                  {isEngine ? 'In workflow' : `Awaiting ${stageLabel(r.current_stage as ApprovalStage)}`}
                                </div>
                              )}
                              {isEngine && (
                                <button onClick={() => toggleExpand(r.id)} style={{ fontSize: 10, color: '#2563eb', marginTop: 2, background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
                                  {expanded[r.id] ? 'Hide' : 'Progress'}
                                </button>
                              )}
                            </td>
                            <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                              <button className="btn btn-outline btn-sm" onClick={() => openEditModal(r)} style={{ marginRight: 4 }} title="Edit">
                                <i className="fa-solid fa-pen" />
                              </button>
                              {writeOk && r.status === 'pending' && canActOnRow && (
                                <>
                                  <button className="btn btn-green btn-sm" onClick={() => void handleApprove(r)} style={{ marginRight: 4 }} title="Approve"><i className="fa-solid fa-check" /></button>
                                  <button className="btn btn-danger btn-sm" onClick={() => void handleReject(r)} title="Reject"><i className="fa-solid fa-xmark" /></button>
                                </>
                              )}
                            </td>
                          </tr>
                          {r.reason && (
                            <tr>
                              <td colSpan={7} style={{ fontSize: 11, color: 'var(--text2)', paddingTop: 0, paddingLeft: 60, borderTop: 'none' }}>
                                <span style={{ fontWeight: 600 }}>Reason: </span>{r.reason}
                                {r.handover_notes && <><span style={{ fontWeight: 600, marginLeft: 12 }}>Handover: </span>{r.handover_notes}</>}
                                {r.rejection_reason && <><span style={{ fontWeight: 600, marginLeft: 12, color: '#dc2626' }}>Rejected: </span>{r.rejection_reason}</>}
                              </td>
                            </tr>
                          )}
                          {isEngine && expanded[r.id] && (
                            <tr>
                              <td colSpan={7} style={{ background: 'var(--surface2)', padding: 12 }}>
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
      )}

      {/* ── BALANCES TAB ── */}
      {tab === 'balances' && (
        <div className="card" style={{ padding: 0 }}>
          <div style={{ padding: '14px 20px 12px', borderBottom: '1px solid var(--border)', fontSize: 13, fontWeight: 600 }}>
            Employee Leave Balances — {year}
          </div>
          {allocLoading ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--text2)' }}>Loading…</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Employee</th>
                    {leaveTypes.map(lt => (
                      <Fragment key={lt.id}>
                        <th style={{ borderLeft: '1px solid var(--border)', textAlign: 'center', background: `${lt.color ?? '#0D9488'}22` }}>
                          <span style={{ color: lt.color ?? '#0D9488', fontWeight: 700 }}>{lt.code ?? lt.name.slice(0, 3)}</span>
                          <div style={{ fontSize: 9, fontWeight: 400, color: 'var(--text2)' }}>Alloc / Used / Pend / Rem</div>
                        </th>
                      </Fragment>
                    ))}
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(balEmpMap).map(([empId, emp]) => (
                    <tr key={empId}>
                      <td>
                        <div className="td-name">{emp.name}</div>
                        <div style={{ fontSize: 10, color: 'var(--text3)' }}>{emp.code}</div>
                      </td>
                      {leaveTypes.map(lt => {
                        const a = emp.allocs[lt.id];
                        return (
                          <td key={lt.id} style={{ textAlign: 'center', borderLeft: '1px solid var(--border)', fontSize: 12 }}>
                            {a ? (
                              <span>
                                <span style={{ color: 'var(--text2)' }}>{a.allocated_days}</span>
                                {' / '}
                                <span style={{ color: '#dc2626' }}>{a.used_days}</span>
                                {' / '}
                                <span style={{ color: '#d97706' }}>{a.pending_days}</span>
                                {' / '}
                                <span style={{ fontWeight: 700, color: a.remaining_days < 0 ? '#dc2626' : '#059669' }}>{a.remaining_days}</span>
                              </span>
                            ) : (
                              <span style={{ color: 'var(--text3)' }}>—</span>
                            )}
                          </td>
                        );
                      })}
                      <td style={{ textAlign: 'right' }}>
                        {(isSuperAdmin || isAdmin || isHR) && (
                          <button className="btn btn-outline btn-sm" onClick={() => openBalanceEdit(empId, emp.name)}>
                            <i className="fa-solid fa-pen" /> Edit
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ padding: '8px 16px', fontSize: 11, color: 'var(--text3)', borderTop: '1px solid var(--border)' }}>
                Columns: Allocated / Used / Pending / Remaining
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── CALENDAR TAB ── */}
      {tab === 'calendar' && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{MONTH_NAMES[calMonth]} {calYear}</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn btn-outline btn-sm" onClick={() => { const d = new Date(calYear, calMonth - 1); setCalMonth(d.getMonth()); setCalYear(d.getFullYear()); }}><i className="fa-solid fa-chevron-left" /></button>
              <button className="btn btn-outline btn-sm" onClick={() => { const d = new Date(calYear, calMonth + 1); setCalMonth(d.getMonth()); setCalYear(d.getFullYear()); }}><i className="fa-solid fa-chevron-right" /></button>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 4 }}>
            {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => (
              <div key={d} style={{ textAlign: 'center', fontSize: 11, fontWeight: 700, color: 'var(--text3)', padding: '4px 0' }}>{d}</div>
            ))}
            {/* Leading blanks */}
            {Array.from({ length: new Date(calYear, calMonth, 1).getDay() }).map((_, i) => <div key={`b${i}`} />)}
            {calDays.map(day => {
              const iso = day.toISOString().slice(0, 10);
              const onLeave = approvedRequests.filter(r => r.start_date <= iso && r.end_date >= iso);
              const isToday = iso === new Date().toISOString().slice(0, 10);
              const isWeekend = day.getDay() === 0 || day.getDay() === 6;
              return (
                <div key={iso} style={{
                  border: `1px solid ${isToday ? 'var(--accent)' : 'var(--border)'}`,
                  borderRadius: 6, padding: '4px 6px', minHeight: 56,
                  background: isWeekend ? 'var(--surface2)' : 'var(--surface)',
                  fontSize: 11,
                }}>
                  <div style={{ fontWeight: isToday ? 700 : 400, color: isToday ? 'var(--accent)' : isWeekend ? 'var(--text3)' : 'var(--text)' }}>
                    {day.getDate()}
                  </div>
                  {onLeave.slice(0, 2).map(r => (
                    <div key={r.id} style={{ fontSize: 9, marginTop: 1, padding: '1px 3px', borderRadius: 3, background: r.leave_type_color ?? '#0D9488', color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.employee_name?.split(' ')[0]}
                    </div>
                  ))}
                  {onLeave.length > 2 && <div style={{ fontSize: 9, color: 'var(--text3)', marginTop: 1 }}>+{onLeave.length - 2} more</div>}
                </div>
              );
            })}
          </div>
          {/* Legend */}
          {leaveTypes.length > 0 && (
            <div style={{ display: 'flex', gap: 12, marginTop: 16, flexWrap: 'wrap' }}>
              {leaveTypes.map(lt => (
                <span key={lt.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 2, background: lt.color ?? '#0D9488' }} />
                  {lt.name}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function EditLeaveForm({
  r,
  leaveTypes,
  initialForm,
  onSave,
}: {
  r: LeaveRequestWithJoins;
  leaveTypes: ReturnType<typeof useLeaveTypes>['types'];
  initialForm: { leave_type_id: string; start_date: string; end_date: string; reason: string; handover_notes: string; admin_notes: string };
  onSave: (form: typeof initialForm, days: number) => Promise<void>;
}) {
  const [form, setForm] = useState(initialForm);
  const [saving, setSaving] = useState(false);
  const days = form.start_date && form.end_date ? calcLeaveDays(form.start_date, form.end_date, BOTSWANA_HOLIDAYS_2026) : 0;
  const handle = async () => {
    setSaving(true);
    await onSave(form, days);
    setSaving(false);
  };
  return (
    <div>
      <div className="form-row cols2">
        <div className="form-group">
          <label>Leave Type</label>
          <select className="form-select" value={form.leave_type_id} onChange={e => setForm(f => ({ ...f, leave_type_id: e.target.value }))}>
            {leaveTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div className="form-group"><label>Days</label><input className="form-input" value={days} readOnly /></div>
      </div>
      <div className="form-row cols2">
        <div className="form-group"><label>Start Date</label><input type="date" className="form-input" value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} /></div>
        <div className="form-group"><label>End Date</label><input type="date" className="form-input" value={form.end_date} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} /></div>
      </div>
      <div className="form-group"><label>Reason</label><textarea rows={2} className="form-textarea" value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} /></div>
      <div className="form-group"><label>Handover Notes</label><textarea rows={2} className="form-textarea" value={form.handover_notes} onChange={e => setForm(f => ({ ...f, handover_notes: e.target.value }))} /></div>
      <div className="form-group"><label>Admin Notes</label><textarea rows={2} className="form-textarea" value={form.admin_notes} onChange={e => setForm(f => ({ ...f, admin_notes: e.target.value }))} /></div>
      <div style={{ textAlign: 'right' }}>
        <button className="btn btn-primary btn-sm" onClick={() => void handle()} disabled={saving || days <= 0}>
          <i className="fa-solid fa-floppy-disk" /> {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

function BalanceEditForm({
  empId, leaveTypes, allocations, year, onSave, onError,
}: {
  empId: string;
  leaveTypes: ReturnType<typeof useLeaveTypes>['types'];
  allocations: Allocation[];
  year: number;
  onSave: () => Promise<void>;
  onError: (msg: string) => void;
}) {
  const [form, setForm] = useState<Record<string, { allocated: string; used: string; pending: string; opening: string }>>(() => {
    const f: Record<string, { allocated: string; used: string; pending: string; opening: string }> = {};
    for (const lt of leaveTypes) {
      const a = allocations.find(x => x.leave_type_id === lt.id);
      f[lt.id] = { allocated: String(a?.allocated_days ?? 0), used: String(a?.used_days ?? 0), pending: String(a?.pending_days ?? 0), opening: String(a?.opening_balance ?? 0) };
    }
    return f;
  });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    for (const lt of leaveTypes) {
      const a = allocations.find(x => x.leave_type_id === lt.id);
      const e = form[lt.id];
      const allocated = Number(e.allocated), used = Number(e.used), pending = Number(e.pending), opening = Number(e.opening);
      if ([allocated, used, pending, opening].some(n => !Number.isFinite(n))) { onError(`Invalid value for ${lt.name}`); setSaving(false); return; }
      if (a) {
        const { error } = await supabase.from('leave_allocations').update({ allocated_days: allocated, used_days: used, pending_days: pending, opening_balance: opening } as never).eq('id', a.id);
        if (error) { onError(error.message); setSaving(false); return; }
      } else if (allocated > 0 || used > 0) {
        const { error } = await supabase.from('leave_allocations').insert({ employee_id: empId, leave_type_id: lt.id, year, allocated_days: allocated, used_days: used, pending_days: pending, opening_balance: opening } as never);
        if (error) { onError(error.message); setSaving(false); return; }
      }
    }
    setSaving(false);
    await onSave();
  };

  return (
    <div>
      <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)' }}>
            <th style={{ textAlign: 'left', padding: '6px 8px' }}>Leave Type</th>
            <th style={{ textAlign: 'center', padding: '6px 4px' }}>Opening</th>
            <th style={{ textAlign: 'center', padding: '6px 4px' }}>Allocated</th>
            <th style={{ textAlign: 'center', padding: '6px 4px' }}>Used</th>
            <th style={{ textAlign: 'center', padding: '6px 4px' }}>Pending</th>
            <th style={{ textAlign: 'center', padding: '6px 4px' }}>Remaining</th>
          </tr>
        </thead>
        <tbody>
          {leaveTypes.map(lt => {
            const e = form[lt.id];
            const rem = Number(e.opening) + Number(e.allocated) - Number(e.used) - Number(e.pending);
            return (
              <tr key={lt.id} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '6px 8px' }}><span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: lt.color ?? '#0D9488' }} />{lt.name}</span></td>
                {(['opening','allocated','used','pending'] as const).map(field => (
                  <td key={field} style={{ padding: '4px', textAlign: 'center' }}>
                    <input type="number" step="0.5" className="form-input" style={{ width: 70, textAlign: 'center', padding: '4px 6px' }}
                      value={e[field]}
                      onChange={ev => setForm(f => ({ ...f, [lt.id]: { ...f[lt.id], [field]: ev.target.value } }))}
                    />
                  </td>
                ))}
                <td style={{ padding: '6px 4px', textAlign: 'center', fontWeight: 700, color: rem < 0 ? '#dc2626' : '#059669' }}>{rem.toFixed(1)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div style={{ textAlign: 'right', marginTop: 16 }}>
        <button className="btn btn-primary btn-sm" onClick={() => void handleSave()} disabled={saving}>
          <i className="fa-solid fa-floppy-disk" /> {saving ? 'Saving…' : 'Save Balances'}
        </button>
      </div>
    </div>
  );
}
