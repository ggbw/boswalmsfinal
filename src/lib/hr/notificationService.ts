/**
 * HR notification service (adapted from motho2/src/lib/notificationService.ts).
 *
 * Writes per-user inbox rows to the `hr_notifications` table (see migration
 * 20260514000001_hr_notifications.sql). Best-effort throughout — notification
 * failures must NEVER break the approval flow that triggered them.
 *
 * What this DOES:
 *   - writeNotifications(...) — bulk insert per-user notification rows
 *   - resolveEmployeeRecipients(employeeIds) — look up auth user IDs by
 *     employee_id via the employees → profiles join
 *   - resolveRecipientsByRole(roles) — look up auth user IDs by app_role
 *     via the user_roles table (boswalmsfinal-specific)
 *   - notifySubmitted / notifyApproved / notifyRejected — high-level helpers
 *
 * What this DOES NOT do (vs. motho2):
 *   - No email dispatch. motho2 calls a `send-approval-email` edge function
 *     which doesn't exist in boswalmsfinal. The email integration can be
 *     added later by implementing sendEmail() against a future edge function.
 *   - No approval_history audit. That table doesn't exist in boswalmsfinal
 *     yet. logApprovalHistory() is a stub that returns immediately.
 *   - No `user_profiles` legacy fallback. Boswalmsfinal uses `profiles` only.
 *
 * The hr_notifications table is created by the migration above. Until the
 * migration is applied, every notification write returns silently (no throws).
 */

import { supabase } from '@/integrations/supabase/client';
import { approversForStage, stageLabel, type ApprovalStage, type RequestType } from '@/lib/hr/approvalWorkflow';

export type NotificationType =
  | 'leave'
  | 'loan'
  | 'info'
  | 'expired'
  | '7_day_warning'
  | '30_day_warning';

export interface NotificationInput {
  userIds: string[];
  title: string;
  message: string;
  type: NotificationType;
  relatedId?: string | null;
}

/**
 * Bulk-insert per-user notification rows. Swallows all errors — caller's
 * approval/save flow must not fail because of a notification write.
 */
export async function writeNotifications(input: NotificationInput): Promise<void> {
  const ids = (input.userIds ?? []).filter(Boolean);
  if (ids.length === 0) return;
  const rows = ids.map((userId) => ({
    user_id: userId,
    title: input.title,
    message: input.message,
    type: input.type,
    related_id: input.relatedId ?? null,
    is_read: false,
  }));
  try {
    await supabase.from('hr_notifications').insert(rows);
  } catch {
    // Best-effort.
  }
}

interface RecipientInfo {
  userId: string;
  email: string | null;
  name: string | null;
  employeeId: string | null;
}

/**
 * Look up auth user IDs + emails for a list of employee IDs. Joins through
 * the employees table → profiles.user_id. Returns one row per resolved user;
 * employees without a linked profile row are skipped.
 */
export async function resolveEmployeeRecipients(
  employeeIds: string[],
): Promise<RecipientInfo[]> {
  if (employeeIds.length === 0) return [];
  // employees.auth_user_id is the link (see hr-create-user/index.ts:109 which
  // sets it on user creation).
  const { data: emps } = await supabase
    .from('employees')
    .select('id, employee_name, email, auth_user_id')
    .in('id', employeeIds);
  return (emps ?? [])
    .filter((e: { auth_user_id?: string | null }) => !!e.auth_user_id)
    .map((e: { id: string; employee_name: string | null; email: string | null; auth_user_id: string }) => ({
      userId: e.auth_user_id,
      email: e.email ?? null,
      name: e.employee_name ?? null,
      employeeId: e.id,
    }));
}

/**
 * Look up users who can act on a given approval stage by their role. Joins
 * user_roles (the boswalmsfinal role source-of-truth) → profiles → employees
 * to also pick up email when available.
 */
export async function resolveRecipientsByRole(
  roles: string[],
  excludeUserId?: string | null,
): Promise<RecipientInfo[]> {
  if (roles.length === 0) return [];
  const { data: rows } = await supabase
    .from('user_roles')
    .select('user_id, role')
    .in('role', roles as never);
  if (!rows || rows.length === 0) return [];
  const userIds = (rows as Array<{ user_id: string }>).map((r) => r.user_id);
  // Pull email + name from profiles (boswalmsfinal's profile shape has both).
  const { data: profs } = await supabase
    .from('profiles')
    .select('user_id, name, email')
    .in('user_id', userIds);
  const profMap = new Map<string, { name: string | null; email: string | null }>();
  (profs ?? []).forEach((p: { user_id: string; name: string | null; email: string | null }) => {
    profMap.set(p.user_id, { name: p.name ?? null, email: p.email ?? null });
  });
  return (rows as Array<{ user_id: string }>)
    .filter((r) => !excludeUserId || r.user_id !== excludeUserId)
    .map((r) => {
      const prof = profMap.get(r.user_id);
      return {
        userId: r.user_id,
        email: prof?.email ?? null,
        name: prof?.name ?? null,
        employeeId: null,
      };
    });
}

/**
 * No-op stub. Motho2 logs to an approval_history table that boswalmsfinal
 * doesn't have. Kept for API parity with motho2 so call sites can be ported
 * verbatim and start working once an approval_history table is added.
 */
export async function logApprovalHistory(_args: {
  requestType: RequestType;
  requestId: string;
  stage: string;
  action: 'submitted' | 'approved' | 'rejected' | 'cancelled';
  actorId?: string | null;
  comment?: string | null;
}): Promise<void> {
  // Intentionally empty.
}

export interface RequestContext {
  requestType: RequestType;
  requestId: string;
  requestRef: string | null;
  employeeId: string;
  employeeName: string | null;
  typeLabel: string;
  summary: string;
}

function typeCap(t: RequestType): string {
  return t === 'leave' ? 'Leave' : 'Loan';
}

export async function notifySubmitted(
  ctx: RequestContext,
  firstStage: ApprovalStage,
  actorUserId?: string | null,
): Promise<void> {
  const refLabel = ctx.requestRef ? ` ${ctx.requestRef}` : '';
  const cap = typeCap(ctx.requestType);
  const employeeLine = ctx.employeeName ? ` by ${ctx.employeeName}` : '';

  const ownerRecipients = await resolveEmployeeRecipients([ctx.employeeId]);
  await writeNotifications({
    userIds: ownerRecipients.map((r) => r.userId),
    title: `${cap} request submitted`,
    message: `Your ${ctx.typeLabel} request${refLabel} (${ctx.summary}) is pending ${stageLabel(firstStage)} approval.`,
    type: ctx.requestType,
    relatedId: ctx.requestId,
  });

  const approvers = await resolveRecipientsByRole(approversForStage(firstStage), actorUserId);
  await writeNotifications({
    userIds: approvers.map((a) => a.userId),
    title: `${cap} request submitted`,
    message: `New ${ctx.typeLabel} request${refLabel}${employeeLine} (${ctx.summary}) needs your review.`,
    type: ctx.requestType,
    relatedId: ctx.requestId,
  });

  await logApprovalHistory({
    requestType: ctx.requestType,
    requestId: ctx.requestId,
    stage: firstStage,
    action: 'submitted',
    actorId: actorUserId ?? null,
  });
}

export async function notifyStageApproved(
  ctx: RequestContext,
  stageApproved: ApprovalStage,
  nextStage: ApprovalStage | null,
  actorUserId: string | null,
  comment?: string,
): Promise<void> {
  const refLabel = ctx.requestRef ? ` ${ctx.requestRef}` : '';
  const cap = typeCap(ctx.requestType);
  const ownerRecipients = await resolveEmployeeRecipients([ctx.employeeId]);

  if (nextStage) {
    await writeNotifications({
      userIds: ownerRecipients.map((r) => r.userId),
      title: `${cap} advanced to ${stageLabel(nextStage)}`,
      message: `Your ${ctx.typeLabel} request${refLabel} was approved by ${stageLabel(stageApproved)} and is now awaiting ${stageLabel(nextStage)} approval.`,
      type: ctx.requestType,
      relatedId: ctx.requestId,
    });
    const nextApprovers = await resolveRecipientsByRole(approversForStage(nextStage), actorUserId);
    await writeNotifications({
      userIds: nextApprovers.map((a) => a.userId),
      title: `${cap} awaiting ${stageLabel(nextStage)} approval`,
      message: `${ctx.typeLabel}${refLabel} (${ctx.summary}) has been approved by ${stageLabel(stageApproved)} and now needs your review.`,
      type: ctx.requestType,
      relatedId: ctx.requestId,
    });
  } else {
    await writeNotifications({
      userIds: ownerRecipients.map((r) => r.userId),
      title: `${cap} fully approved`,
      message: `Your ${ctx.typeLabel} request${refLabel} (${ctx.summary}) has been fully approved.`,
      type: ctx.requestType,
      relatedId: ctx.requestId,
    });
  }

  await logApprovalHistory({
    requestType: ctx.requestType,
    requestId: ctx.requestId,
    stage: stageApproved,
    action: 'approved',
    actorId: actorUserId,
    comment: comment ?? null,
  });
}

export async function notifyRejected(
  ctx: RequestContext,
  stageRejected: ApprovalStage,
  actorUserId: string | null,
  reason: string,
): Promise<void> {
  const refLabel = ctx.requestRef ? ` ${ctx.requestRef}` : '';
  const cap = typeCap(ctx.requestType);
  const ownerRecipients = await resolveEmployeeRecipients([ctx.employeeId]);

  await writeNotifications({
    userIds: ownerRecipients.map((r) => r.userId),
    title: `${cap} request rejected`,
    message: `Your ${ctx.typeLabel} request${refLabel} was rejected at ${stageLabel(stageRejected)}. Reason: ${reason}`,
    type: ctx.requestType,
    relatedId: ctx.requestId,
  });

  await logApprovalHistory({
    requestType: ctx.requestType,
    requestId: ctx.requestId,
    stage: stageRejected,
    action: 'rejected',
    actorId: actorUserId,
    comment: reason,
  });
}
