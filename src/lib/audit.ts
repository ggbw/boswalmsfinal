/**
 * Audit trail — the client half.
 *
 * Everything here is FIRE AND FORGET. Not one function in this file returns a
 * value the caller is expected to check, and not one of them throws. That is
 * deliberate and it is the rule the rest of the feature depends on: recording
 * that something happened must never be able to stop it happening. If the
 * network is down, if the migration has not been applied yet, if RLS refuses
 * the call — a mark still saves, a payslip still generates, a user still signs
 * in. The audit is simply thinner for that period.
 *
 * The database side lives in
 * supabase/migrations/20260824000000_audit_trail.sql. Read that first: the
 * IP address, the actor's username and the actor's role are all resolved
 * server-side, because a browser cannot see its own public IP and nothing it
 * claims about its own identity is worth recording.
 *
 * The audit tables and RPCs are newer than the generated
 * src/integrations/supabase/types.ts, so the client is widened once — see
 * `auditDb` below — rather than cast at every call site.
 */

import { supabase } from '@/integrations/supabase/client';

// ─── The one untyped seam ─────────────────────────────────────────────────────
// `Database` in src/integrations/supabase/types.ts is generated from the live
// database and therefore does not know about audit_logs, user_sessions or the
// RPCs yet. Rather than sprinkle `as never` casts across three files — the
// pattern that let a renamed role slip through the compiler once already — the
// widening happens exactly here, behind a hand-written interface that still
// describes the methods this feature uses. Delete it after re-running
// `supabase gen types` and the calls below type-check unchanged.

interface LooseResult {
  data: unknown;
  error: { message: string } | null;
}

interface LooseQuery extends PromiseLike<LooseResult> {
  select: (columns?: string, options?: Record<string, unknown>) => LooseQuery;
  eq: (column: string, value: unknown) => LooseQuery;
  neq: (column: string, value: unknown) => LooseQuery;
  gte: (column: string, value: unknown) => LooseQuery;
  lte: (column: string, value: unknown) => LooseQuery;
  is: (column: string, value: unknown) => LooseQuery;
  not: (column: string, operator: string, value: unknown) => LooseQuery;
  in: (column: string, values: readonly unknown[]) => LooseQuery;
  or: (filter: string) => LooseQuery;
  order: (column: string, options?: { ascending?: boolean }) => LooseQuery;
  limit: (count: number) => LooseQuery;
  range: (from: number, to: number) => LooseQuery;
  maybeSingle: () => PromiseLike<LooseResult>;
}

interface LooseClient {
  from: (table: string) => LooseQuery;
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<LooseResult>;
}

/** The Supabase client, widened to reach the audit tables and RPCs. */
export const auditDb = supabase as unknown as LooseClient;

// ─── Types ────────────────────────────────────────────────────────────────────

/** Broad grouping, used by the page's category filter. */
export type AuditCategory = 'auth' | 'data' | 'access' | 'export' | 'admin' | 'security';
export type AuditSeverity = 'info' | 'warning' | 'critical';
export type AuditStatus = 'success' | 'failure';

export interface AuditLogRow {
  id: string;
  occurred_at: string;
  actor_id: string | null;
  actor_username: string | null;
  actor_name: string | null;
  actor_role: string | null;
  session_id: string | null;
  action: string;
  category: string;
  entity_type: string | null;
  entity_id: string | null;
  entity_label: string | null;
  summary: string | null;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  changed_fields: string[] | null;
  ip_address: string | null;
  user_agent: string | null;
  severity: string;
  status: string;
  metadata: Record<string, unknown> | null;
}

export interface UserSessionRow {
  id: string;
  user_id: string;
  username: string | null;
  full_name: string | null;
  role: string | null;
  started_at: string;
  last_seen_at: string;
  ended_at: string | null;
  end_reason: string | null;
  duration_seconds: number | null;
  ip_address: string | null;
  user_agent: string | null;
  is_impersonation: boolean;
  impersonator_id: string | null;
}

export interface AuditSettings {
  enabled: boolean;
  log_data_changes: boolean;
  log_page_views: boolean;
  log_exports: boolean;
  store_payloads: boolean;
  retain_days: number;
  session_idle_minutes: number;
}

export const DEFAULT_AUDIT_SETTINGS: AuditSettings = {
  enabled: true,
  log_data_changes: true,
  log_page_views: false,
  log_exports: true,
  store_payloads: true,
  retain_days: 365,
  session_idle_minutes: 30,
};

export interface AuditEventInput {
  action: string;
  category?: AuditCategory;
  entityType?: string;
  entityId?: string | null;
  entityLabel?: string | null;
  summary?: string;
  metadata?: Record<string, unknown>;
  severity?: AuditSeverity;
  status?: AuditStatus;
}

// ─── Settings cache ───────────────────────────────────────────────────────────
// Read once per page load. Page-view logging consults it on every navigation,
// and a round trip per click to ask "should I log this click" would cost more
// than the logging it gates.

let settingsCache: AuditSettings | null = null;
let settingsPromise: Promise<AuditSettings> | null = null;

export async function getAuditSettings(force = false): Promise<AuditSettings> {
  if (force) {
    settingsCache = null;
    settingsPromise = null;
  }
  if (settingsCache) return settingsCache;
  if (settingsPromise) return settingsPromise;

  settingsPromise = (async () => {
    try {
      const { data } = await auditDb
        .from('audit_settings')
        .select('*')
        .limit(1)
        .maybeSingle();
      // Table absent (migration not applied) → defaults, and every call below
      // then fails silently. The app behaves exactly as it did before.
      settingsCache = { ...DEFAULT_AUDIT_SETTINGS, ...(data as Partial<AuditSettings> | null) };
    } catch {
      settingsCache = { ...DEFAULT_AUDIT_SETTINGS };
    }
    return settingsCache;
  })();

  return settingsPromise;
}

/** Drop the cache after an admin edits the settings. */
export function invalidateAuditSettings(): void {
  settingsCache = null;
  settingsPromise = null;
}

// ─── Session tracking ─────────────────────────────────────────────────────────
// The session row is what turns "they were here" into "they were here for
// 42 minutes". Its id is kept in localStorage rather than component state so a
// refresh, a second tab, or a route change continues the same session instead
// of starting a new one — otherwise a normal working day would read as thirty
// separate two-minute visits.

const SESSION_KEY = 'boswa.audit.session';

interface StoredSession {
  id: string;
  userId: string;
}

function readStoredSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSession;
    return parsed?.id && parsed?.userId ? parsed : null;
  } catch {
    return null;
  }
}

function writeStoredSession(value: StoredSession | null): void {
  try {
    if (value) localStorage.setItem(SESSION_KEY, JSON.stringify(value));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* private mode — session tracking degrades to one row per page load */
  }
}

/** The current session id, or null if none has been opened. */
export function currentAuditSessionId(): string | null {
  return readStoredSession()?.id ?? null;
}

/**
 * Open a session row for `userId`, unless one is already open for that same
 * user. Supabase fires SIGNED_IN on token refresh and on tab focus as well as
 * on an actual sign-in, so without the stored-id guard a long day would
 * produce a login row every hour.
 */
export async function startAuditSession(userId: string): Promise<void> {
  try {
    const existing = readStoredSession();
    if (existing && existing.userId === userId) {
      // Same person, session already running — just prove they are still here.
      void touchAuditSession();
      return;
    }
    // A different user on this browser: close the previous row before opening
    // a new one, so a shared machine does not leave a session open for ever.
    if (existing) await endAuditSession('switched_user');

    const { data } = await auditDb.rpc('start_user_session', {
      p_user_agent: navigator.userAgent,
    });
    const id = typeof data === 'string' ? data : null;
    if (id) writeStoredSession({ id, userId });
  } catch {
    /* auditing is best-effort */
  }
}

/** Heartbeat. Cheap by design — one indexed UPDATE, no audit row. */
export async function touchAuditSession(): Promise<void> {
  const id = currentAuditSessionId();
  if (!id) return;
  try {
    await auditDb.rpc('touch_user_session', { p_session_id: id });
  } catch {
    /* best-effort */
  }
}

/**
 * Close the session and stamp its duration.
 *
 * Must be called BEFORE supabase.auth.signOut(): the RPC checks auth.uid(), so
 * once the token is gone the row can no longer be closed by its owner and it
 * would sit open until close_stale_user_sessions() swept it up.
 */
export async function endAuditSession(reason = 'signout'): Promise<void> {
  const id = currentAuditSessionId();
  writeStoredSession(null);
  if (!id) return;
  try {
    // Bounded, because signOut() awaits this. A slow or unreachable database
    // must not leave someone staring at a Sign Out button that appears stuck —
    // close_stale_user_sessions() settles the row either way.
    await Promise.race([
      auditDb.rpc('end_user_session', { p_session_id: id, p_reason: reason }),
      new Promise((resolve) => setTimeout(resolve, 2500)),
    ]);
  } catch {
    /* best-effort */
  }
}

/** Settle sessions abandoned without a sign-out. Called when the report opens. */
export async function closeStaleSessions(): Promise<number> {
  try {
    const { data } = await auditDb.rpc('close_stale_user_sessions', {});
    return typeof data === 'number' ? data : 0;
  } catch {
    return 0;
  }
}

// ─── Event logging ────────────────────────────────────────────────────────────

/** Record one event. Never throws; returns nothing worth checking. */
export async function logAudit(event: AuditEventInput): Promise<void> {
  try {
    const settings = await getAuditSettings();
    if (!settings.enabled) return;

    await auditDb.rpc('log_audit_event', {
      p_action: event.action,
      p_category: event.category ?? 'data',
      p_entity_type: event.entityType ?? null,
      p_entity_id: event.entityId ?? null,
      p_entity_label: event.entityLabel ?? null,
      p_summary: event.summary ?? null,
      p_metadata: event.metadata ?? null,
      p_severity: event.severity ?? 'info',
      p_status: event.status ?? 'success',
      p_session_id: currentAuditSessionId(),
    });
  } catch {
    /* best-effort */
  }
}

/**
 * A failed sign-in — recorded before any session exists, so it goes through the
 * anon-callable RPC. This is the entry that makes a brute-force attempt visible:
 * twenty rows, one username, one IP, ninety seconds.
 */
export async function logAuthFailure(username: string, detail?: string): Promise<void> {
  try {
    await auditDb.rpc('log_auth_event', {
      p_action: 'login_failed',
      p_username: username,
      p_status: 'failure',
      p_detail: detail ?? null,
    });
  } catch {
    /* best-effort */
  }
}

/** Navigation. Off unless an admin turns log_page_views on. */
export async function logPageView(page: string, params?: Record<string, unknown>): Promise<void> {
  try {
    const settings = await getAuditSettings();
    if (!settings.enabled || !settings.log_page_views) return;
    await logAudit({
      action: 'view',
      category: 'access',
      entityType: 'page',
      entityId: page,
      entityLabel: page,
      summary: `Opened ${page}`,
      metadata: params && Object.keys(params).length ? { params } : undefined,
    });
  } catch {
    /* best-effort */
  }
}

/**
 * A download of school data.
 *
 * Worth its own action because exfiltration does not look like a data change —
 * nothing in the database is modified when someone downloads every student
 * record, so a change-only audit would show that day as quiet.
 */
export async function logExport(
  filename: string,
  rowCount: number,
  context?: Record<string, unknown>,
): Promise<void> {
  try {
    const settings = await getAuditSettings();
    if (!settings.enabled || !settings.log_exports) return;
    await logAudit({
      action: 'export',
      category: 'export',
      entityType: 'file',
      entityId: filename,
      entityLabel: filename,
      summary: `Exported ${rowCount} row${rowCount === 1 ? '' : 's'} to ${filename}`,
      metadata: { rows: rowCount, ...(context ?? {}) },
      severity: rowCount > 500 ? 'warning' : 'info',
    });
  } catch {
    /* best-effort */
  }
}

/** Reading a record that holds someone's personal data. */
export async function logSensitiveView(
  entityType: string,
  entityId: string,
  entityLabel?: string,
): Promise<void> {
  await logAudit({
    action: 'view_record',
    category: 'access',
    entityType,
    entityId,
    entityLabel: entityLabel ?? null,
    summary: `Viewed ${entityType} ${entityLabel ?? entityId}`,
  });
}

// ─── Presentation helpers ─────────────────────────────────────────────────────
// Shared by the report page and anywhere else that needs to render a duration
// or an action consistently.

/** "1h 42m", "42m 07s", "18s" — never a bare seconds count. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds)) return '—';
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(sec).padStart(2, '0')}s`;
  return `${sec}s`;
}

/**
 * How long a session lasted.
 *
 * An open session is measured to last_seen_at, not to now(). Counting the time
 * since someone's last heartbeat as "access" would credit a closed laptop with
 * a working day, and this number is meant to be defensible.
 */
export function sessionDurationSeconds(row: UserSessionRow): number {
  if (row.duration_seconds !== null && row.duration_seconds !== undefined) {
    return row.duration_seconds;
  }
  const start = new Date(row.started_at).getTime();
  const end = new Date(row.ended_at ?? row.last_seen_at).getTime();
  return Math.max(0, Math.round((end - start) / 1000));
}

const ACTION_LABELS: Record<string, string> = {
  login: 'Signed in',
  login_impersonated: 'Signed in (impersonated)',
  login_failed: 'Failed sign-in',
  login_blocked: 'Blocked sign-in',
  logout: 'Signed out',
  password_reset_requested: 'Password reset requested',
  password_changed: 'Password changed',
  insert: 'Created',
  update: 'Updated',
  delete: 'Deleted',
  view: 'Opened page',
  view_record: 'Viewed record',
  export: 'Exported data',
  purge: 'Purged audit log',
  settings_change: 'Changed settings',
  impersonate_start: 'Started impersonation',
  impersonate_end: 'Ended impersonation',
  user_created: 'Created user',
  user_deleted: 'Deleted user',
  role_changed: 'Changed role',
};

export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

/** Table name → the name the people using this system would use. */
const ENTITY_LABELS: Record<string, string> = {
  profiles: 'User profile',
  user_roles: 'User role',
  students: 'Student',
  marks: 'Mark',
  assessment_marks: 'Assessment mark',
  student_registrations: 'Registration',
  student_registration_modules: 'Registration module',
  student_modules: 'Student module',
  employees: 'Employee',
  payslips: 'Payslip',
  contracts: 'Contract',
  leave_requests: 'Leave request',
  advance_salaries: 'Loan / advance',
  school_config: 'School configuration',
  company_settings: 'Company settings',
  impersonation_sessions: 'Impersonation',
  attendance: 'Attendance register',
  timetable: 'Timetable',
  assignments: 'Assignment',
  submissions: 'Submission',
  exams: 'Exam',
  applicants: 'Applicant',
  applications: 'Application',
};

export function entityLabel(entityType: string | null): string {
  if (!entityType) return '—';
  return ENTITY_LABELS[entityType] ?? entityType.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

/**
 * Fields never worth showing in a diff — they change on every write and say
 * nothing about intent. Hiding them is what makes the diff readable.
 */
const NOISE_FIELDS = new Set(['updated_at', 'created_at', 'last_seen_at']);

export interface FieldChange {
  field: string;
  before: string;
  after: string;
}

/** Before/after pairs for the fields that actually changed. */
export function diffFields(row: AuditLogRow): FieldChange[] {
  const fields =
    row.changed_fields && row.changed_fields.length
      ? row.changed_fields
      : Object.keys({ ...(row.old_data ?? {}), ...(row.new_data ?? {}) });

  return fields
    .filter((f) => !NOISE_FIELDS.has(f))
    .map((field) => ({
      field,
      before: renderValue(row.old_data?.[field]),
      after: renderValue(row.new_data?.[field]),
    }))
    .filter((c) => c.before !== c.after);
}

function renderValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** "Chrome on Windows" beats 140 characters of version tokens. */
export function shortUserAgent(ua: string | null): string {
  if (!ua) return '—';
  const browser =
    /Edg\//.test(ua) ? 'Edge'
    : /OPR\//.test(ua) ? 'Opera'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari'
    : /Firefox\//.test(ua) ? 'Firefox'
    : 'Browser';
  const os =
    /Windows/.test(ua) ? 'Windows'
    : /Android/.test(ua) ? 'Android'
    : /iPhone|iPad/.test(ua) ? 'iOS'
    : /Mac OS X/.test(ua) ? 'macOS'
    : /Linux/.test(ua) ? 'Linux'
    : '';
  return os ? `${browser} on ${os}` : browser;
}
