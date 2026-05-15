/**
 * Workflow Engine — configurable multi-stage approval orchestration.
 *
 * Ported from motho2/src/lib/workflowEngine.ts with boswalmsfinal-specific
 * adaptations:
 *   - workflow_stage_owners.role_name (TEXT, app_role enum value) instead
 *     of role_id (UUID FK to custom_roles).
 *   - Role-based owner resolution joins user_roles, not user_profiles.
 *   - Parent-row mirroring writes to 'leave_requests' and 'advance_salaries'
 *     (not 'loans') matching boswalmsfinal's tables.
 *
 * Sits IN FRONT of the legacy 3-stage helpers in approvalWorkflow.ts.
 * Requests without an assigned workflow continue to use the legacy path.
 *
 * Every DB read returns null on a missing-table error so a half-applied
 * migration is a safe fallback to legacy, not a hard crash — same contract
 * as isStageColumnMissingError in approvalWorkflow.ts.
 */

import { supabase } from '@/integrations/supabase/client';
import {
  resolveEmployeeRecipients,
  resolveRecipientsByRole,
  writeNotifications,
  type RequestContext,
} from '@/lib/hr/notificationService';
import { stageLabel } from '@/lib/hr/approvalWorkflow';

// ─── Types ─────────────────────────────────────────────────────────────

export type WorkflowRequestType = 'leave' | 'loan' | 'generic';
export type ApprovalType = 'ANY' | 'ALL';
export type WorkflowInstanceStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'cancelled'
  | 'sent_back';
export type WorkflowAction = 'approved' | 'rejected' | 'sent_back';
export type WorkflowScopeType =
  | 'leave_type'
  | 'loan_type'
  | 'department'
  | 'employee_group'
  | 'global';

export interface Workflow {
  id: string;
  name: string;
  code: string;
  description: string | null;
  request_type: WorkflowRequestType;
  is_active: boolean;
  created_at: string;
}

export interface WorkflowStage {
  id: string;
  workflow_id: string;
  stage_order: number;
  stage_key: string;
  stage_name: string;
  description: string | null;
  approval_type: ApprovalType;
  is_active: boolean;
}

export interface WorkflowStageOwner {
  id: string;
  stage_id: string;
  owner_type: 'role' | 'user';
  role_name: string | null;
  user_id: string | null;
}

export interface WorkflowAssignment {
  id: string;
  workflow_id: string;
  scope_type: WorkflowScopeType;
  scope_id: string | null;
  priority: number;
  is_active: boolean;
}

export interface WorkflowInstance {
  id: string;
  workflow_id: string;
  request_type: string;
  request_id: string;
  current_stage_id: string | null;
  status: WorkflowInstanceStatus;
  started_at: string;
  completed_at: string | null;
}

export interface WorkflowStageApproval {
  id: string;
  instance_id: string;
  stage_id: string;
  approver_id: string;
  action: WorkflowAction;
  comment: string | null;
  acted_at: string;
}

export interface WorkflowResolutionContext {
  leaveTypeId?: string | null;
  loanTypeId?: string | null;
  departmentId?: string | null;
  employeeId?: string | null;
}

export type TimelineStageStatus =
  | 'approved'
  | 'rejected'
  | 'pending'     // current stage
  | 'waiting'     // not yet reached
  | 'sent_back';

export interface TimelineStage extends WorkflowStage {
  status: TimelineStageStatus;
  approvals: WorkflowStageApproval[];
}

// ─── Error helpers ─────────────────────────────────────────────────────

export function isWorkflowTableMissingError(err: unknown): boolean {
  const msg = String((err as { message?: string } | null)?.message ?? err ?? '').toLowerCase();
  if (!msg) return false;
  return (
    msg.includes('workflow') &&
    (msg.includes('does not exist') ||
      msg.includes('schema cache') ||
      msg.includes('relation'))
  );
}

// ─── Pure logic (testable, no IO) ──────────────────────────────────────

/**
 * Decide whether the current stage is satisfied given its approval rule
 * and the set of approver decisions recorded so far.
 *
 * - For ANY: a single approve satisfies the stage; a single reject fails it.
 * - For ALL: every owner-user must approve; any single reject fails it.
 */
export function decideStageOutcome(args: {
  approvalType: ApprovalType;
  requiredApproverIds: string[];
  approvals: WorkflowStageApproval[];
}): 'advance' | 'reject' | 'wait' {
  const { approvalType, requiredApproverIds, approvals } = args;
  if (approvals.some((a) => a.action === 'rejected')) return 'reject';
  if (approvalType === 'ANY') {
    return approvals.some((a) => a.action === 'approved') ? 'advance' : 'wait';
  }
  if (requiredApproverIds.length === 0) return 'wait';
  const approvedBy = new Set(
    approvals.filter((a) => a.action === 'approved').map((a) => a.approver_id),
  );
  const allApproved = requiredApproverIds.every((uid) => approvedBy.has(uid));
  return allApproved ? 'advance' : 'wait';
}

export function nextWorkflowStage(
  stages: WorkflowStage[],
  currentStageId: string | null,
): WorkflowStage | null {
  if (!currentStageId) return null;
  const idx = stages.findIndex((s) => s.id === currentStageId);
  if (idx < 0 || idx >= stages.length - 1) return null;
  return stages[idx + 1];
}

export function previousWorkflowStage(
  stages: WorkflowStage[],
  currentStageId: string | null,
): WorkflowStage | null {
  if (!currentStageId) return null;
  const idx = stages.findIndex((s) => s.id === currentStageId);
  if (idx <= 0) return null;
  return stages[idx - 1];
}

// ─── Workflow resolution ───────────────────────────────────────────────

const wfFrom = (table: string) => (supabase.from(table as never) as never) as {
  select: (sel: string, opts?: { count?: 'exact'; head?: boolean }) => any;
  insert: (v: unknown) => any;
  update: (v: unknown) => any;
  delete: () => any;
};

export async function resolveWorkflowForRequest(
  requestType: WorkflowRequestType,
  ctx: WorkflowResolutionContext,
): Promise<Workflow | null> {
  try {
    const { data: assignments, error } = await wfFrom('workflow_assignments')
      .select(
        'id, workflow_id, scope_type, scope_id, priority, is_active, workflows!inner(id,name,code,description,request_type,is_active,created_at)',
      )
      .eq('is_active', true);
    if (error) return null;
    if (!assignments || (assignments as unknown[]).length === 0) return null;

    const candidates = (assignments as Array<{
      scope_type: WorkflowScopeType;
      scope_id: string | null;
      priority: number | null;
      workflows: Workflow;
    }>).filter(
      (a) =>
        a.workflows?.is_active &&
        (a.workflows.request_type === requestType || a.workflows.request_type === 'generic'),
    );
    if (candidates.length === 0) return null;

    let groupIds: string[] = [];
    if (ctx.employeeId) {
      const { data: memberships } = await wfFrom('employee_group_members')
        .select('group_id')
        .eq('employee_id', ctx.employeeId);
      groupIds = ((memberships ?? []) as Array<{ group_id: string }>).map((m) => m.group_id);
    }

    const specificity: Record<WorkflowScopeType, number> = {
      leave_type: 100,
      loan_type: 100,
      employee_group: 75,
      department: 50,
      global: 10,
    };

    const matched = candidates
      .map((a) => {
        const st = a.scope_type;
        let matches = false;
        if (st === 'leave_type') matches = !!ctx.leaveTypeId && a.scope_id === ctx.leaveTypeId;
        else if (st === 'loan_type') matches = !!ctx.loanTypeId && a.scope_id === ctx.loanTypeId;
        else if (st === 'department') matches = !!ctx.departmentId && a.scope_id === ctx.departmentId;
        else if (st === 'employee_group')
          matches = !!a.scope_id && groupIds.includes(a.scope_id);
        else if (st === 'global') matches = true;
        return matches ? { a, score: specificity[st] } : null;
      })
      .filter(Boolean) as Array<{
      a: { workflows: Workflow; priority: number | null };
      score: number;
    }>;

    if (matched.length === 0) return null;

    matched.sort((x, y) => {
      if (y.score !== x.score) return y.score - x.score;
      return (y.a.priority ?? 0) - (x.a.priority ?? 0);
    });

    const wf = matched[0].a.workflows;
    return {
      id: wf.id,
      name: wf.name,
      code: wf.code,
      description: wf.description,
      request_type: wf.request_type,
      is_active: wf.is_active,
      created_at: wf.created_at,
    };
  } catch (err) {
    if (isWorkflowTableMissingError(err)) return null;
    return null;
  }
}

// ─── Instance lifecycle ────────────────────────────────────────────────

export async function getActiveInstance(
  requestType: WorkflowRequestType,
  requestId: string,
): Promise<WorkflowInstance | null> {
  try {
    const { data, error } = await wfFrom('workflow_instances')
      .select('*')
      .eq('request_type', requestType)
      .eq('request_id', requestId)
      .maybeSingle();
    if (error || !data) return null;
    return data as WorkflowInstance;
  } catch (err) {
    if (isWorkflowTableMissingError(err)) return null;
    return null;
  }
}

export async function hasWorkflowInstance(
  requestType: WorkflowRequestType,
  requestId: string,
): Promise<boolean> {
  const inst = await getActiveInstance(requestType, requestId);
  return inst !== null;
}

export async function getWorkflowStages(workflowId: string): Promise<WorkflowStage[]> {
  try {
    const { data } = await wfFrom('workflow_stages')
      .select('*')
      .eq('workflow_id', workflowId)
      .eq('is_active', true)
      .order('stage_order', { ascending: true });
    return (data ?? []) as WorkflowStage[];
  } catch (err) {
    if (isWorkflowTableMissingError(err)) return [];
    return [];
  }
}

export async function startWorkflowInstance(
  requestType: WorkflowRequestType,
  requestId: string,
  workflowId: string,
): Promise<{
  instanceId: string;
  firstStage: WorkflowStage;
  stages: WorkflowStage[];
} | null> {
  const stages = await getWorkflowStages(workflowId);
  if (stages.length === 0) return null;
  const firstStage = stages[0];

  let instanceId: string | null = null;
  try {
    const { data, error } = await wfFrom('workflow_instances')
      .insert({
        workflow_id: workflowId,
        request_type: requestType,
        request_id: requestId,
        current_stage_id: firstStage.id,
        status: 'pending',
      })
      .select('id')
      .single();
    if (error) {
      if (isWorkflowTableMissingError(error)) return null;
      // unique_violation = instance already exists → return existing
      if ((error as { code?: string }).code === '23505') {
        const existing = await getActiveInstance(requestType, requestId);
        if (existing) instanceId = existing.id;
      } else {
        return null;
      }
    } else {
      instanceId = (data as { id: string } | null)?.id ?? null;
    }
  } catch (err) {
    if (isWorkflowTableMissingError(err)) return null;
    return null;
  }
  if (!instanceId) return null;

  // Mirror onto the parent row's current_stage / required_stages so the
  // legacy bell + history paths keep showing the correct stage label.
  const tableName =
    requestType === 'leave'
      ? 'leave_requests'
      : requestType === 'loan'
        ? 'advance_salaries'
        : null;
  if (tableName) {
    const stageKeys = stages.map((s) => s.stage_key);
    try {
      await supabase
        .from(tableName)
        .update({
          current_stage: firstStage.stage_key,
          required_stages: stageKeys,
        } as never)
        .eq('id', requestId);
    } catch {
      // Best-effort — engine state is authoritative.
    }
  }

  return { instanceId, firstStage, stages };
}

// ─── Approver resolution ───────────────────────────────────────────────

/**
 * For a given workflow stage, return:
 *   - the raw owner rows
 *   - the distinct set of user ids who can approve
 *
 * Role owners are expanded by querying user_roles for users with the
 * matching app_role.
 */
export async function getStageApprovers(
  stageId: string,
): Promise<{ owners: WorkflowStageOwner[]; userIds: string[] }> {
  try {
    const { data: owners } = await wfFrom('workflow_stage_owners')
      .select('*')
      .eq('stage_id', stageId);
    const ownerRows = (owners ?? []) as WorkflowStageOwner[];

    const directUserIds = ownerRows
      .filter((o) => o.owner_type === 'user' && o.user_id)
      .map((o) => o.user_id as string);

    const roleNames = ownerRows
      .filter((o) => o.owner_type === 'role' && o.role_name)
      .map((o) => o.role_name as string);

    let roleUserIds: string[] = [];
    if (roleNames.length > 0) {
      const { data: rows } = await supabase
        .from('user_roles')
        .select('user_id, role')
        .in('role', roleNames as never);
      roleUserIds = ((rows ?? []) as Array<{ user_id: string }>).map((r) => r.user_id);
    }

    const all = new Set<string>();
    directUserIds.forEach((u) => all.add(u));
    roleUserIds.forEach((u) => all.add(u));

    return { owners: ownerRows, userIds: Array.from(all) };
  } catch (err) {
    if (isWorkflowTableMissingError(err)) {
      return { owners: [], userIds: [] };
    }
    return { owners: [], userIds: [] };
  }
}

export async function canActOnInstanceStage(
  instanceId: string,
  userId: string,
): Promise<boolean> {
  if (!userId) return false;
  const instance = await getInstanceById(instanceId);
  if (!instance || instance.status !== 'pending' || !instance.current_stage_id) return false;
  const { userIds } = await getStageApprovers(instance.current_stage_id);
  return userIds.includes(userId);
}

async function getInstanceById(id: string): Promise<WorkflowInstance | null> {
  try {
    const { data } = await wfFrom('workflow_instances')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    return ((data ?? null) as WorkflowInstance | null);
  } catch (err) {
    if (isWorkflowTableMissingError(err)) return null;
    return null;
  }
}

// ─── Timeline (for the visual stepper) ─────────────────────────────────

export async function getWorkflowTimeline(
  instanceId: string,
): Promise<{ instance: WorkflowInstance; stages: TimelineStage[] } | null> {
  const instance = await getInstanceById(instanceId);
  if (!instance) return null;

  const stages = await getWorkflowStages(instance.workflow_id);
  if (stages.length === 0) return null;

  let approvals: WorkflowStageApproval[] = [];
  try {
    const { data } = await wfFrom('workflow_stage_approvals')
      .select('*')
      .eq('instance_id', instanceId)
      .order('acted_at', { ascending: true });
    approvals = (data ?? []) as WorkflowStageApproval[];
  } catch (err) {
    if (!isWorkflowTableMissingError(err)) approvals = [];
  }

  const currentIdx = stages.findIndex((s) => s.id === instance.current_stage_id);
  const timeline: TimelineStage[] = stages.map((s, idx) => {
    const stageApprovals = approvals.filter((a) => a.stage_id === s.id);
    let status: TimelineStageStatus;
    if (instance.status === 'rejected' && idx === currentIdx) {
      status = 'rejected';
    } else if (
      instance.status === 'approved' ||
      (currentIdx >= 0 && idx < currentIdx)
    ) {
      status = 'approved';
    } else if (instance.status === 'sent_back' && idx === currentIdx) {
      status = 'sent_back';
    } else if (idx === currentIdx) {
      status = 'pending';
    } else {
      status = 'waiting';
    }
    return { ...s, status, approvals: stageApprovals };
  });

  return { instance, stages: timeline };
}

// ─── Action (approve / reject / send_back) ─────────────────────────────

export async function actOnStage(args: {
  instanceId: string;
  action: WorkflowAction;
  userId: string;
  comment?: string | null;
}): Promise<{
  instance: WorkflowInstance;
  actedStage: WorkflowStage;
  nextStage: WorkflowStage | null;
  outcome: 'advanced' | 'completed' | 'rejected' | 'sent_back' | 'waiting';
} | null> {
  const { instanceId, action, userId, comment } = args;
  const instance = await getInstanceById(instanceId);
  if (!instance || !instance.current_stage_id) return null;
  if (instance.status !== 'pending' && instance.status !== 'sent_back') return null;

  const stages = await getWorkflowStages(instance.workflow_id);
  const currentStage = stages.find((s) => s.id === instance.current_stage_id);
  if (!currentStage) return null;

  const { userIds: stageApproverIds } = await getStageApprovers(currentStage.id);
  if (!stageApproverIds.includes(userId)) return null;

  try {
    await wfFrom('workflow_stage_approvals').insert({
      instance_id: instanceId,
      stage_id: currentStage.id,
      approver_id: userId,
      action,
      comment: comment ?? null,
    });
  } catch (err) {
    if (isWorkflowTableMissingError(err)) return null;
    return null;
  }

  if (action === 'rejected') {
    const updated = await updateInstance(instanceId, {
      status: 'rejected',
      completed_at: new Date().toISOString(),
    });
    return {
      instance: updated ?? { ...instance, status: 'rejected' },
      actedStage: currentStage,
      nextStage: null,
      outcome: 'rejected',
    };
  }

  if (action === 'sent_back') {
    const prev = previousWorkflowStage(stages, currentStage.id);
    if (!prev) {
      const updated = await updateInstance(instanceId, { status: 'sent_back' });
      return {
        instance: updated ?? { ...instance, status: 'sent_back' },
        actedStage: currentStage,
        nextStage: null,
        outcome: 'sent_back',
      };
    }
    await clearStageApprovals(instanceId, prev.id);
    const updated = await updateInstance(instanceId, {
      current_stage_id: prev.id,
      status: 'pending',
    });
    await mirrorParentStage(instance, prev);
    return {
      instance: updated ?? { ...instance, current_stage_id: prev.id, status: 'pending' },
      actedStage: currentStage,
      nextStage: prev,
      outcome: 'sent_back',
    };
  }

  // approve — apply ANY/ALL semantics
  const { data: stageVotes } = await wfFrom('workflow_stage_approvals')
    .select('*')
    .eq('instance_id', instanceId)
    .eq('stage_id', currentStage.id);
  const outcome = decideStageOutcome({
    approvalType: currentStage.approval_type,
    requiredApproverIds: stageApproverIds,
    approvals: (stageVotes ?? []) as WorkflowStageApproval[],
  });

  if (outcome === 'wait') {
    return {
      instance,
      actedStage: currentStage,
      nextStage: currentStage,
      outcome: 'waiting',
    };
  }
  if (outcome === 'reject') {
    const updated = await updateInstance(instanceId, {
      status: 'rejected',
      completed_at: new Date().toISOString(),
    });
    return {
      instance: updated ?? { ...instance, status: 'rejected' },
      actedStage: currentStage,
      nextStage: null,
      outcome: 'rejected',
    };
  }

  // advance
  const next = nextWorkflowStage(stages, currentStage.id);
  if (!next) {
    const updated = await updateInstance(instanceId, {
      status: 'approved',
      completed_at: new Date().toISOString(),
    });
    return {
      instance: updated ?? { ...instance, status: 'approved' },
      actedStage: currentStage,
      nextStage: null,
      outcome: 'completed',
    };
  }
  const updated = await updateInstance(instanceId, {
    current_stage_id: next.id,
    status: 'pending',
  });
  await mirrorParentStage(instance, next);
  return {
    instance: updated ?? { ...instance, current_stage_id: next.id, status: 'pending' },
    actedStage: currentStage,
    nextStage: next,
    outcome: 'advanced',
  };
}

// ─── Internal write helpers ────────────────────────────────────────────

async function updateInstance(
  id: string,
  patch: Partial<WorkflowInstance>,
): Promise<WorkflowInstance | null> {
  try {
    const { data, error } = await wfFrom('workflow_instances')
      .update(patch)
      .eq('id', id)
      .select('*')
      .single();
    if (error) return null;
    return data as WorkflowInstance;
  } catch {
    return null;
  }
}

async function clearStageApprovals(instanceId: string, stageId: string): Promise<void> {
  try {
    await wfFrom('workflow_stage_approvals')
      .delete()
      .eq('instance_id', instanceId)
      .eq('stage_id', stageId);
  } catch {
    // best-effort
  }
}

async function mirrorParentStage(
  instance: WorkflowInstance,
  stage: WorkflowStage,
): Promise<void> {
  const tableName =
    instance.request_type === 'leave'
      ? 'leave_requests'
      : instance.request_type === 'loan'
        ? 'advance_salaries'
        : null;
  if (!tableName) return;
  try {
    await supabase
      .from(tableName)
      .update({ current_stage: stage.stage_key } as never)
      .eq('id', instance.request_id);
  } catch {
    // best-effort
  }
}

// ─── Workflow-aware notification helpers ───────────────────────────────
//
// Wraps writeNotifications from notificationService.ts but resolves
// approvers from workflow_stage_owners (role_name → user_roles, plus
// direct user_id entries). The bell / hr_notifications rows are shaped
// identically so the UI doesn't care which path produced the row.

interface WorkflowNotifyArgs {
  ctx: RequestContext;
  stage: WorkflowStage;
  nextStage?: WorkflowStage | null;
  actorUserId: string | null;
  comment?: string | null;
}

async function resolveStageRecipientUserIds(
  stage: WorkflowStage,
  excludeUserId?: string | null,
): Promise<string[]> {
  const { owners, userIds: directIds } = await getStageApprovers(stage.id);

  // For role-only stages, also notify via role recipients lookup (gives
  // emails for users who have an employees row too — same shape as legacy
  // approvers).
  const roleNames = owners
    .filter((o) => o.owner_type === 'role' && o.role_name)
    .map((o) => o.role_name as string);
  let extra: string[] = [];
  if (roleNames.length > 0) {
    const recipients = await resolveRecipientsByRole(roleNames, excludeUserId);
    extra = recipients.map((r) => r.userId);
  }

  const all = new Set<string>();
  directIds.forEach((u) => all.add(u));
  extra.forEach((u) => all.add(u));
  if (excludeUserId) all.delete(excludeUserId);
  return Array.from(all);
}

export async function notifyWorkflowSubmitted(args: WorkflowNotifyArgs): Promise<void> {
  const { ctx, stage, actorUserId } = args;
  const refLabel = ctx.requestRef ? ` ${ctx.requestRef}` : '';
  const typeCap = ctx.requestType === 'leave' ? 'Leave' : 'Loan';

  const owners = await resolveEmployeeRecipients([ctx.employeeId]);
  await writeNotifications({
    userIds: owners.map((o) => o.userId),
    title: `${typeCap} request submitted`,
    message: `Your ${ctx.typeLabel} request${refLabel} (${ctx.summary}) is pending ${stageLabel(stage.stage_name)} approval.`,
    type: ctx.requestType,
    relatedId: ctx.requestId,
  });

  const approverIds = await resolveStageRecipientUserIds(stage, actorUserId);
  if (approverIds.length > 0) {
    await writeNotifications({
      userIds: approverIds,
      title: `${typeCap} request needs your review`,
      message: `New ${ctx.typeLabel} request${refLabel}${ctx.employeeName ? ` by ${ctx.employeeName}` : ''} (${ctx.summary}) is at ${stage.stage_name}.`,
      type: ctx.requestType,
      relatedId: ctx.requestId,
    });
  }
}

export async function notifyWorkflowStageApproved(args: WorkflowNotifyArgs): Promise<void> {
  const { ctx, stage, nextStage, actorUserId, comment } = args;
  const refLabel = ctx.requestRef ? ` ${ctx.requestRef}` : '';
  const typeCap = ctx.requestType === 'leave' ? 'Leave' : 'Loan';
  const owners = await resolveEmployeeRecipients([ctx.employeeId]);

  if (nextStage) {
    await writeNotifications({
      userIds: owners.map((o) => o.userId),
      title: `${typeCap} advanced to ${nextStage.stage_name}`,
      message: `Your ${ctx.typeLabel} request${refLabel} was approved at ${stage.stage_name} and is now awaiting ${nextStage.stage_name} approval.${comment ? ` Note: ${comment}` : ''}`,
      type: ctx.requestType,
      relatedId: ctx.requestId,
    });
    const nextApproverIds = await resolveStageRecipientUserIds(nextStage, actorUserId);
    if (nextApproverIds.length > 0) {
      await writeNotifications({
        userIds: nextApproverIds,
        title: `${typeCap} request needs your review`,
        message: `${ctx.typeLabel} request${refLabel}${ctx.employeeName ? ` by ${ctx.employeeName}` : ''} (${ctx.summary}) was approved at ${stage.stage_name} and is now at ${nextStage.stage_name}.`,
        type: ctx.requestType,
        relatedId: ctx.requestId,
      });
    }
  } else {
    await writeNotifications({
      userIds: owners.map((o) => o.userId),
      title: `${typeCap} approved`,
      message: `Your ${ctx.typeLabel} request${refLabel} (${ctx.summary}) has been fully approved.${comment ? ` Note: ${comment}` : ''}`,
      type: ctx.requestType,
      relatedId: ctx.requestId,
    });
  }
}

export async function notifyWorkflowRejected(
  args: WorkflowNotifyArgs & { reason: string },
): Promise<void> {
  const { ctx, stage, reason } = args;
  const refLabel = ctx.requestRef ? ` ${ctx.requestRef}` : '';
  const typeCap = ctx.requestType === 'leave' ? 'Leave' : 'Loan';
  const owners = await resolveEmployeeRecipients([ctx.employeeId]);
  await writeNotifications({
    userIds: owners.map((o) => o.userId),
    title: `${typeCap} rejected`,
    message: `Your ${ctx.typeLabel} request${refLabel} (${ctx.summary}) was rejected at ${stage.stage_name}. Reason: ${reason}`,
    type: ctx.requestType,
    relatedId: ctx.requestId,
  });
}

export async function notifyWorkflowSentBack(
  args: WorkflowNotifyArgs & { previousStage: WorkflowStage | null },
): Promise<void> {
  const { ctx, stage, previousStage, comment } = args;
  const refLabel = ctx.requestRef ? ` ${ctx.requestRef}` : '';
  const typeCap = ctx.requestType === 'leave' ? 'Leave' : 'Loan';
  const owners = await resolveEmployeeRecipients([ctx.employeeId]);
  const target = previousStage ? previousStage.stage_name : 'you for revisions';
  await writeNotifications({
    userIds: owners.map((o) => o.userId),
    title: `${typeCap} sent back`,
    message: `Your ${ctx.typeLabel} request${refLabel} (${ctx.summary}) was sent back from ${stage.stage_name} to ${target}.${comment ? ` Note: ${comment}` : ''}`,
    type: ctx.requestType,
    relatedId: ctx.requestId,
  });
  if (previousStage) {
    const recipientIds = await resolveStageRecipientUserIds(previousStage);
    if (recipientIds.length > 0) {
      await writeNotifications({
        userIds: recipientIds,
        title: `${typeCap} request returned for review`,
        message: `${ctx.typeLabel} request${refLabel}${ctx.employeeName ? ` from ${ctx.employeeName}` : ''} (${ctx.summary}) has been sent back to ${previousStage.stage_name} for reconsideration.`,
        type: ctx.requestType,
        relatedId: ctx.requestId,
      });
    }
  }
}
