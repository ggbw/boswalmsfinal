/**
 * Approval workflow primitives (ported from motho2/src/lib/approvalWorkflow.ts).
 *
 * Pure logic — no side effects, no DB calls, no React. Provides the stage
 * progression, role gating, and migration-safety helpers used by motho2's
 * leave / loan approval flows. Re-usable as the foundation for porting the
 * full workflow engine (Phase 4) later, or for adding lightweight approval
 * gating to existing pages incrementally.
 *
 * Stage semantics:
 *   - "hr"          → HR officer review
 *   - "admin"       → manager / payroll admin sign-off
 *   - "super_admin" → escalated approval for long leaves / large loans
 * NULL current_stage on an older row means "pre-multi-stage" — any admin/HR
 * approval finalises it (legacy fallback).
 */

export type ApprovalStage = 'hr' | 'admin' | 'super_admin';
export type RequestType = 'leave' | 'loan';

/**
 * Hardcoded default — leaves longer than this many working days require
 * Super Admin approval. Overridable at runtime via the `company_settings`
 * key `leave_super_admin_threshold_days`.
 */
export const LEAVE_SUPER_ADMIN_THRESHOLD_DAYS = 10;

/**
 * Hardcoded default — loans at or above this amount require Super Admin
 * approval. Overridable via `loan_super_admin_threshold_amount` company
 * setting.
 */
export const LOAN_SUPER_ADMIN_THRESHOLD_AMOUNT = 50_000;

/** Company-settings keys for the two thresholds. */
export const COMPANY_SETTING_KEYS = {
  LEAVE_THRESHOLD: 'leave_super_admin_threshold_days',
  LOAN_THRESHOLD:  'loan_super_admin_threshold_amount',
} as const;

export function leaveRequiredStages(
  numDays: number,
  threshold: number = LEAVE_SUPER_ADMIN_THRESHOLD_DAYS,
): ApprovalStage[] {
  const base: ApprovalStage[] = ['hr', 'admin'];
  if (numDays > threshold) base.push('super_admin');
  return base;
}

export function loanRequiredStages(
  loanAmount: number,
  threshold: number = LOAN_SUPER_ADMIN_THRESHOLD_AMOUNT,
): ApprovalStage[] {
  const base: ApprovalStage[] = ['hr', 'admin'];
  if (loanAmount >= threshold) base.push('super_admin');
  return base;
}

/**
 * Given a request's stage list and its current stage, return the next stage
 * (or null if the current stage is the final one).
 */
export function nextStage(
  stages: ApprovalStage[] | null | undefined,
  current: ApprovalStage | null | undefined,
): ApprovalStage | null {
  if (!stages || stages.length === 0 || !current) return null;
  const idx = stages.indexOf(current);
  if (idx < 0 || idx >= stages.length - 1) return null;
  return stages[idx + 1];
}

/**
 * True if the given role is allowed to act on a request currently at `stage`.
 * Higher-privilege roles can always step in for lower stages.
 */
export function canActOnStage(
  stage: ApprovalStage | null | undefined,
  roleFlags: { isHR: boolean; isAdmin: boolean; isSuperAdmin: boolean },
): boolean {
  if (!stage) return roleFlags.isHR || roleFlags.isAdmin || roleFlags.isSuperAdmin;
  if (stage === 'hr')          return roleFlags.isHR || roleFlags.isAdmin || roleFlags.isSuperAdmin;
  if (stage === 'admin')       return roleFlags.isAdmin || roleFlags.isSuperAdmin;
  if (stage === 'super_admin') return roleFlags.isSuperAdmin;
  return false;
}

export function stageLabel(stage: ApprovalStage | string | null | undefined): string {
  if (!stage) return 'approval';
  if (stage === 'hr')          return 'HR';
  if (stage === 'admin')       return 'Admin';
  if (stage === 'super_admin') return 'Super Admin';
  return stage;
}

/**
 * The app_role values that should be notified when a request enters the given
 * stage. Higher-privilege roles can always step in, so an HR-stage request
 * notifies HR, Admin and Super Admin users.
 */
export function approversForStage(stage: ApprovalStage): string[] {
  if (stage === 'hr')          return ['hr', 'admin', 'super_admin'];
  if (stage === 'admin')       return ['admin', 'super_admin'];
  if (stage === 'super_admin') return ['super_admin'];
  return [];
}

// ─── Migration-safety helpers ────────────────────────────────────────────
//
// The multi-stage columns (current_stage, required_stages) may not exist on
// older leave_requests / loans tables. These helpers let call sites attempt
// the modern payload first and fall back to legacy when PostgREST rejects.

export function isStageColumnMissingError(err: unknown): boolean {
  const msg = String(((err as { message?: string } | null)?.message) ?? err ?? '').toLowerCase();
  return msg.includes('current_stage') || msg.includes('required_stages');
}

export function stripStageFields<T extends Record<string, unknown>>(
  payload: T,
): Omit<T, 'current_stage' | 'required_stages'> {
  const copy = { ...payload };
  delete (copy as Record<string, unknown>).current_stage;
  delete (copy as Record<string, unknown>).required_stages;
  return copy as Omit<T, 'current_stage' | 'required_stages'>;
}
