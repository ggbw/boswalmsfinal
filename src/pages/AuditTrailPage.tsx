/**
 * Audit Trail — who did what, from where, as which role, and for how long.
 *
 * Three tabs, because three different questions get asked of an audit trail and
 * one table cannot answer all of them well:
 *
 *   Activity   what changed, and who changed it        (audit_logs)
 *   Sessions   who was signed in, from where, how long (user_sessions)
 *   Settings   what is being recorded, and for how long
 *
 * All filtering that can be pushed to the database is pushed to the database.
 * This table grows without bound; a client-side filter over a 500-row window
 * would quietly answer "no results" when the answer was on page nine, which is
 * the worst thing an audit tool can do.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/hooks/useAuth';
import { downloadCsv } from '@/lib/csv';
import {
  auditDb,
  actionLabel,
  closeStaleSessions,
  diffFields,
  entityLabel,
  formatDuration,
  getAuditSettings,
  invalidateAuditSettings,
  sessionDurationSeconds,
  shortUserAgent,
  DEFAULT_AUDIT_SETTINGS,
  type AuditLogRow,
  type AuditSettings,
  type UserSessionRow,
} from '@/lib/audit';

// ─── Constants ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 200;

const CATEGORIES = [
  { value: 'all', label: 'All categories' },
  { value: 'auth', label: 'Sign-in / sign-out' },
  { value: 'data', label: 'Data changes' },
  { value: 'access', label: 'Access / views' },
  { value: 'export', label: 'Exports' },
  { value: 'admin', label: 'Administration' },
  { value: 'security', label: 'Security' },
];

const SEVERITIES = [
  { value: 'all', label: 'All severities' },
  { value: 'info', label: 'Info' },
  { value: 'warning', label: 'Warning' },
  { value: 'critical', label: 'Critical' },
];

const ACTIONS = [
  { value: 'all', label: 'All actions' },
  { value: 'login', label: 'Sign-in' },
  { value: 'login_failed', label: 'Failed sign-in' },
  { value: 'logout', label: 'Sign-out' },
  { value: 'insert', label: 'Created' },
  { value: 'update', label: 'Updated' },
  { value: 'delete', label: 'Deleted' },
  { value: 'export', label: 'Exported' },
  { value: 'view', label: 'Opened page' },
  { value: 'view_record', label: 'Viewed record' },
];

// ─── Formatting ───────────────────────────────────────────────────────────────

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function fmtTimeOnly(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function isoDay(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

/**
 * PostgREST's `or=` takes a comma-separated list, so a comma inside the search
 * term would be read as a filter separator and produce a 400 rather than no
 * results — which reads to the user as "the audit log is broken".
 */
function sanitiseSearch(q: string): string {
  return q.replace(/[,()*%\\]/g, ' ').trim();
}

function severityBadgeClass(severity: string, status: string): string {
  if (status === 'failure') return 'badge badge-fail';
  if (severity === 'critical') return 'badge badge-fail';
  if (severity === 'warning') return 'badge badge-pending';
  return 'badge badge-inactive';
}

function roleLabel(role: string | null): string {
  if (!role) return '—';
  const named: Record<string, string> = {
    hoa: 'HOA', hod: 'HOD', super_admin: 'SUPER ADMIN',
    deputy_principal: 'DEPUTY PRINCIPAL',
  };
  return named[role] ?? role.toUpperCase();
}

/** Who the actor was, preferring the name a colleague would recognise. */
function actorLabel(row: { actor_name: string | null; actor_username: string | null }): string {
  return row.actor_name || row.actor_username || 'Unknown / signed out';
}

// ─── Detail view ──────────────────────────────────────────────────────────────

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="info-row">
      <span className="info-label">{label}</span>
      <span className="info-val" style={{ textAlign: 'right', maxWidth: '65%', wordBreak: 'break-word' }}>
        {value}
      </span>
    </div>
  );
}

function AuditDetail({ row }: { row: AuditLogRow }) {
  const changes = diffFields(row);
  return (
    <div style={{ fontSize: 12 }}>
      <DetailRow label="When" value={fmtDateTime(row.occurred_at)} />
      <DetailRow label="User" value={actorLabel(row)} />
      <DetailRow label="Username" value={row.actor_username || '—'} />
      <DetailRow label="Role at the time" value={roleLabel(row.actor_role)} />
      <DetailRow label="Action" value={actionLabel(row.action)} />
      <DetailRow label="Record type" value={entityLabel(row.entity_type)} />
      <DetailRow label="Record" value={row.entity_label || row.entity_id || '—'} />
      <DetailRow label="IP address" value={row.ip_address || '—'} />
      <DetailRow label="Device" value={shortUserAgent(row.user_agent)} />
      <DetailRow label="Outcome" value={row.status === 'failure' ? 'Failed' : 'Succeeded'} />
      {row.summary && <DetailRow label="Summary" value={row.summary} />}

      {changes.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>
            What changed
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Field</th><th>Before</th><th>After</th></tr>
              </thead>
              <tbody>
                {changes.map((c) => (
                  <tr key={c.field}>
                    <td style={{ fontWeight: 500 }}>{c.field.replace(/_/g, ' ')}</td>
                    <td style={{ color: '#cf222e', fontFamily: "'JetBrains Mono',monospace", fontSize: 11 }}>{c.before}</td>
                    <td style={{ color: '#1a7f37', fontFamily: "'JetBrains Mono',monospace", fontSize: 11 }}>{c.after}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {row.metadata && Object.keys(row.metadata).length > 0 && (
        <div style={{ marginTop: 18 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>
            Extra detail
          </div>
          <pre style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, padding: 10, fontSize: 11, overflowX: 'auto', margin: 0 }}>
            {JSON.stringify(row.metadata, null, 2)}
          </pre>
        </div>
      )}

      {changes.length === 0 && row.action === 'update' && (
        <div style={{ marginTop: 14, fontSize: 11, color: 'var(--text2)' }}>
          Before/after values were not stored for this entry — payload storage is
          switched off in Audit Settings.
        </div>
      )}
    </div>
  );
}

// ─── Activity tab ─────────────────────────────────────────────────────────────

function ActivityTab() {
  const { toast, showModal } = useApp();

  const [fromDate, setFromDate] = useState(isoDay(-7));
  const [toDate, setToDate] = useState(isoDay());
  const [category, setCategory] = useState('all');
  const [action, setAction] = useState('all');
  const [severity, setSeverity] = useState('all');
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');

  const [rows, setRows] = useState<AuditLogRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (append: boolean) => {
    setLoading(true);
    setError(null);
    const offset = append ? rows.length : 0;

    try {
      let q = auditDb
        .from('audit_logs')
        .select('*')
        .gte('occurred_at', `${fromDate}T00:00:00`)
        .lte('occurred_at', `${toDate}T23:59:59.999`);

      if (category !== 'all') q = q.eq('category', category);
      if (action !== 'all') q = q.eq('action', action);
      if (severity !== 'all') q = q.eq('severity', severity);

      const term = sanitiseSearch(appliedSearch);
      if (term) {
        q = q.or(
          [
            `actor_name.ilike.%${term}%`,
            `actor_username.ilike.%${term}%`,
            `entity_label.ilike.%${term}%`,
            `entity_type.ilike.%${term}%`,
            `summary.ilike.%${term}%`,
          ].join(','),
        );
      }

      const { data, error: err } = await q
        .order('occurred_at', { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1);

      if (err) {
        setError(err.message);
        setLoading(false);
        return;
      }

      const batch = (data ?? []) as AuditLogRow[];
      setRows((prev) => (append ? [...prev, ...batch] : batch));
      setHasMore(batch.length === PAGE_SIZE);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setLoading(false);
  }, [fromDate, toDate, category, action, severity, appliedSearch, rows.length]);

  // Deliberately not depending on `load` — it closes over rows.length, so
  // including it would re-run the query every time a page was appended.
  useEffect(() => {
    void load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromDate, toDate, category, action, severity, appliedSearch]);

  const stats = useMemo(() => {
    const users = new Set(rows.map((r) => r.actor_id ?? r.actor_username ?? '').filter(Boolean));
    return {
      total: rows.length,
      failures: rows.filter((r) => r.status === 'failure' || r.action === 'login_failed').length,
      changes: rows.filter((r) => ['insert', 'update', 'delete'].includes(r.action)).length,
      users: users.size,
    };
  }, [rows]);

  const exportCsv = () => {
    if (!rows.length) {
      toast('Nothing to export for this filter.', 'info');
      return;
    }
    downloadCsv(`audit-trail_${fromDate}_${toDate}.csv`, [
      ['When', 'User', 'Username', 'Role', 'Action', 'Record type', 'Record',
       'Summary', 'Changed fields', 'IP address', 'Device', 'Severity', 'Outcome'],
      ...rows.map((r) => [
        fmtDateTime(r.occurred_at),
        actorLabel(r),
        r.actor_username ?? '',
        roleLabel(r.actor_role),
        actionLabel(r.action),
        entityLabel(r.entity_type),
        r.entity_label ?? r.entity_id ?? '',
        r.summary ?? '',
        (r.changed_fields ?? []).join(' | '),
        r.ip_address ?? '',
        shortUserAgent(r.user_agent),
        r.severity,
        r.status,
      ]),
    ]);
  };

  return (
    <>
      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-icon" style={{ background: '#e8eefa', color: '#0b1f4a' }}><i className="fa-solid fa-list" /></div>
          <div><div className="stat-val">{stats.total}{hasMore ? '+' : ''}</div><div className="stat-label">Events in range</div></div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: '#dafbe1', color: '#1a7f37' }}><i className="fa-solid fa-pen" /></div>
          <div><div className="stat-val">{stats.changes}</div><div className="stat-label">Record changes</div></div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: '#ffebe9', color: '#cf222e' }}><i className="fa-solid fa-triangle-exclamation" /></div>
          <div><div className="stat-val">{stats.failures}</div><div className="stat-label">Failures / failed sign-ins</div></div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: '#fff8c5', color: '#9a6700' }}><i className="fa-solid fa-users" /></div>
          <div><div className="stat-val">{stats.users}</div><div className="stat-label">Distinct users</div></div>
        </div>
      </div>

      <div className="card">
        <div className="search-bar" style={{ flexWrap: 'wrap' }}>
          <input type="date" className="filter-select" value={fromDate} max={toDate} onChange={(e) => setFromDate(e.target.value)} />
          <span style={{ fontSize: 11, color: 'var(--text2)' }}>to</span>
          <input type="date" className="filter-select" value={toDate} min={fromDate} onChange={(e) => setToDate(e.target.value)} />

          <select className="filter-select" value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
          <select className="filter-select" value={action} onChange={(e) => setAction(e.target.value)}>
            {ACTIONS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
          </select>
          <select className="filter-select" value={severity} onChange={(e) => setSeverity(e.target.value)}>
            {SEVERITIES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>

          <input
            className="search-input"
            placeholder="Search user, record or summary…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') setAppliedSearch(search); }}
          />
          <button className="btn btn-outline btn-sm" onClick={() => setAppliedSearch(search)}>
            <i className="fa-solid fa-magnifying-glass" /> Search
          </button>
          <button className="btn btn-outline btn-sm" onClick={() => void load(false)}>
            <i className="fa-solid fa-rotate" /> Refresh
          </button>
          <button className="btn btn-primary btn-sm" onClick={exportCsv} style={{ marginLeft: 'auto' }}>
            <i className="fa-solid fa-download" /> Export CSV
          </button>
        </div>

        {error && (
          <div role="alert" style={{ background: '#ffebe9', border: '1px solid #ffc1ba', color: '#cf222e', borderRadius: 6, padding: '10px 12px', fontSize: 12, marginBottom: 12 }}>
            Could not read the audit trail: {error}
            <div style={{ marginTop: 4, fontSize: 11, opacity: 0.85 }}>
              If this says the relation does not exist, the audit migration has not
              been applied to this database yet.
            </div>
          </div>
        )}

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>User</th>
                <th>Role</th>
                <th>Action</th>
                <th>Record</th>
                <th>Details</th>
                <th>IP address</th>
                <th>Device</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => showModal('Audit entry', <AuditDetail row={r} />, 'large')}>
                  <td style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, whiteSpace: 'nowrap' }}>{fmtDateTime(r.occurred_at)}</td>
                  <td className="td-name">{actorLabel(r)}</td>
                  <td><span className="badge badge-inactive">{roleLabel(r.actor_role)}</span></td>
                  <td>
                    <span className={severityBadgeClass(r.severity, r.status)}>{actionLabel(r.action)}</span>
                  </td>
                  <td>{entityLabel(r.entity_type)}</td>
                  <td style={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.entity_label || r.summary || '—'}
                    {r.changed_fields && r.changed_fields.length > 0 && (
                      <span style={{ color: 'var(--text2)', fontSize: 11 }}>
                        {' '}· {r.changed_fields.length} field{r.changed_fields.length === 1 ? '' : 's'}
                      </span>
                    )}
                  </td>
                  <td style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11 }}>{r.ip_address || '—'}</td>
                  <td style={{ fontSize: 11, color: 'var(--text2)' }}>{shortUserAgent(r.user_agent)}</td>
                  <td style={{ textAlign: 'right', color: 'var(--text2)' }}><i className="fa-solid fa-chevron-right" /></td>
                </tr>
              ))}
              {!rows.length && !loading && !error && (
                <tr>
                  <td colSpan={9} style={{ textAlign: 'center', padding: 28, color: 'var(--text2)', fontSize: 12 }}>
                    No recorded activity matches these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14 }}>
          {loading && <span style={{ fontSize: 11, color: 'var(--text2)' }}>Loading…</span>}
          {hasMore && !loading && (
            <button className="btn btn-outline btn-sm" onClick={() => void load(true)}>
              Load {PAGE_SIZE} more
            </button>
          )}
          {!!rows.length && (
            <span style={{ fontSize: 11, color: 'var(--text2)', marginLeft: 'auto' }}>
              Showing {rows.length} entr{rows.length === 1 ? 'y' : 'ies'}
            </span>
          )}
        </div>
      </div>
    </>
  );
}

// ─── Sessions tab ─────────────────────────────────────────────────────────────

function SessionsTab() {
  const { toast } = useApp();

  const [fromDate, setFromDate] = useState(isoDay(-7));
  const [toDate, setToDate] = useState(isoDay());
  const [status, setStatus] = useState<'all' | 'open' | 'closed'>('all');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<UserSessionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Settle anything abandoned first, so "open now" means open now rather
      // than "was never signed out of, at some point in the last fortnight".
      await closeStaleSessions();

      let q = auditDb
        .from('user_sessions')
        .select('*')
        .gte('started_at', `${fromDate}T00:00:00`)
        .lte('started_at', `${toDate}T23:59:59.999`);

      // `.not('ended_at', 'is', null)` rather than `.neq('ended_at', null)` —
      // PostgREST reads the latter as a comparison against the string "null",
      // which matches nothing and would make the Ended filter look empty.
      if (status === 'open') q = q.is('ended_at', null);
      if (status === 'closed') q = q.not('ended_at', 'is', null);

      const { data, error: err } = await q
        .order('started_at', { ascending: false })
        .limit(1000);

      if (err) {
        setError(err.message);
        setLoading(false);
        return;
      }
      setRows((data ?? []) as UserSessionRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setLoading(false);
  }, [fromDate, toDate, status]);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      (r.full_name ?? '').toLowerCase().includes(q) ||
      (r.username ?? '').toLowerCase().includes(q) ||
      (r.ip_address ?? '').toLowerCase().includes(q) ||
      (r.role ?? '').toLowerCase().includes(q));
  }, [rows, search]);

  const stats = useMemo(() => {
    const open = filtered.filter((r) => !r.ended_at).length;
    const totalSeconds = filtered.reduce((sum, r) => sum + sessionDurationSeconds(r), 0);
    const users = new Set(filtered.map((r) => r.user_id)).size;
    return {
      open,
      users,
      total: filtered.length,
      average: filtered.length ? Math.round(totalSeconds / filtered.length) : 0,
    };
  }, [filtered]);

  const exportCsv = () => {
    if (!filtered.length) {
      toast('Nothing to export for this filter.', 'info');
      return;
    }
    downloadCsv(`access-sessions_${fromDate}_${toDate}.csv`, [
      ['User', 'Username', 'Role', 'Signed in', 'Last seen', 'Signed out',
       'Duration', 'Duration (seconds)', 'Ended by', 'IP address', 'Device', 'Impersonated'],
      ...filtered.map((r) => [
        r.full_name ?? '',
        r.username ?? '',
        roleLabel(r.role),
        fmtDateTime(r.started_at),
        fmtDateTime(r.last_seen_at),
        r.ended_at ? fmtDateTime(r.ended_at) : 'Still signed in',
        formatDuration(sessionDurationSeconds(r)),
        sessionDurationSeconds(r),
        r.end_reason ?? '',
        r.ip_address ?? '',
        shortUserAgent(r.user_agent),
        r.is_impersonation ? 'Yes' : 'No',
      ]),
    ]);
  };

  return (
    <>
      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-icon" style={{ background: '#dafbe1', color: '#1a7f37' }}><i className="fa-solid fa-circle-play" /></div>
          <div><div className="stat-val">{stats.open}</div><div className="stat-label">Signed in now</div></div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: '#e8eefa', color: '#0b1f4a' }}><i className="fa-solid fa-right-to-bracket" /></div>
          <div><div className="stat-val">{stats.total}</div><div className="stat-label">Sessions in range</div></div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: '#fff8c5', color: '#9a6700' }}><i className="fa-solid fa-users" /></div>
          <div><div className="stat-val">{stats.users}</div><div className="stat-label">Distinct users</div></div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: '#f0e6ff', color: '#6639ba' }}><i className="fa-solid fa-stopwatch" /></div>
          <div><div className="stat-val" style={{ fontSize: 19 }}>{formatDuration(stats.average)}</div><div className="stat-label">Average duration</div></div>
        </div>
      </div>

      <div className="card">
        <div className="search-bar" style={{ flexWrap: 'wrap' }}>
          <input type="date" className="filter-select" value={fromDate} max={toDate} onChange={(e) => setFromDate(e.target.value)} />
          <span style={{ fontSize: 11, color: 'var(--text2)' }}>to</span>
          <input type="date" className="filter-select" value={toDate} min={fromDate} onChange={(e) => setToDate(e.target.value)} />
          <select className="filter-select" value={status} onChange={(e) => setStatus(e.target.value as 'all' | 'open' | 'closed')}>
            <option value="all">All sessions</option>
            <option value="open">Currently signed in</option>
            <option value="closed">Ended</option>
          </select>
          <input
            className="search-input"
            placeholder="Search name, username, role or IP…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button className="btn btn-outline btn-sm" onClick={() => void load()}>
            <i className="fa-solid fa-rotate" /> Refresh
          </button>
          <button className="btn btn-primary btn-sm" onClick={exportCsv} style={{ marginLeft: 'auto' }}>
            <i className="fa-solid fa-download" /> Export CSV
          </button>
        </div>

        {error && (
          <div role="alert" style={{ background: '#ffebe9', border: '1px solid #ffc1ba', color: '#cf222e', borderRadius: 6, padding: '10px 12px', fontSize: 12, marginBottom: 12 }}>
            Could not read session history: {error}
          </div>
        )}

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Signed in</th>
                <th>Signed out</th>
                <th>Duration</th>
                <th>IP address</th>
                <th>Device</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td className="td-name">
                    {r.full_name || r.username || r.user_id.slice(0, 8)}
                    {r.is_impersonation && (
                      <span className="badge badge-pending" style={{ marginLeft: 6 }}>IMPERSONATED</span>
                    )}
                    <div style={{ fontSize: 10.5, color: 'var(--text2)' }}>{r.username ?? ''}</div>
                  </td>
                  <td><span className="badge badge-inactive">{roleLabel(r.role)}</span></td>
                  <td style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, whiteSpace: 'nowrap' }}>{fmtDateTime(r.started_at)}</td>
                  <td style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, whiteSpace: 'nowrap' }}>
                    {r.ended_at ? fmtDateTime(r.ended_at) : <span style={{ color: 'var(--text2)' }}>— (last seen {fmtTimeOnly(r.last_seen_at)})</span>}
                  </td>
                  <td style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 600 }}>{formatDuration(sessionDurationSeconds(r))}</td>
                  <td style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11 }}>{r.ip_address || '—'}</td>
                  <td style={{ fontSize: 11, color: 'var(--text2)' }}>{shortUserAgent(r.user_agent)}</td>
                  <td>
                    {r.ended_at
                      ? <span className="badge badge-inactive">{r.end_reason === 'timeout' ? 'TIMED OUT' : 'ENDED'}</span>
                      : <span className="badge badge-active">ACTIVE</span>}
                  </td>
                </tr>
              ))}
              {!filtered.length && !loading && !error && (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', padding: 28, color: 'var(--text2)', fontSize: 12 }}>
                    No sessions recorded in this range.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {loading && <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 12 }}>Loading…</div>}
      </div>
    </>
  );
}

// ─── Settings tab ─────────────────────────────────────────────────────────────

function Toggle({
  label, hint, checked, onChange,
}: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 0', borderBottom: '1px solid #f0f2f5', cursor: 'pointer' }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ marginTop: 3 }} />
      <span>
        <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600 }}>{label}</span>
        <span style={{ display: 'block', fontSize: 11, color: 'var(--text2)', marginTop: 2 }}>{hint}</span>
      </span>
    </label>
  );
}

function SettingsTab() {
  const { toast } = useApp();
  const [settings, setSettings] = useState<AuditSettings>(DEFAULT_AUDIT_SETTINGS);
  const [saving, setSaving] = useState(false);
  const [purging, setPurging] = useState(false);

  useEffect(() => {
    void (async () => setSettings(await getAuditSettings(true)))();
  }, []);

  const save = async () => {
    setSaving(true);
    const { error } = await auditDb.rpc('update_audit_settings', {
      p_enabled: settings.enabled,
      p_log_data_changes: settings.log_data_changes,
      p_log_page_views: settings.log_page_views,
      p_log_exports: settings.log_exports,
      p_store_payloads: settings.store_payloads,
      p_retain_days: settings.retain_days,
      p_idle_minutes: settings.session_idle_minutes,
    });
    setSaving(false);
    if (error) {
      toast(error.message, 'error');
      return;
    }
    invalidateAuditSettings();
    setSettings(await getAuditSettings(true));
    toast('Audit settings saved.', 'success');
  };

  const purge = async () => {
    if (!window.confirm(
      `Permanently delete audit entries older than ${settings.retain_days} days? This cannot be undone.`,
    )) return;
    setPurging(true);
    const { data, error } = await auditDb.rpc('purge_audit_logs', { p_days: settings.retain_days });
    setPurging(false);
    if (error) {
      toast(error.message, 'error');
      return;
    }
    toast(`Removed ${typeof data === 'number' ? data : 0} old entries.`, 'success');
  };

  return (
    <div className="two-col">
      <div className="card">
        <div className="card-title">What gets recorded</div>

        <Toggle
          label="Audit trail enabled"
          hint="The master switch. Turning it off stops all recording — and that change is itself recorded."
          checked={settings.enabled}
          onChange={(v) => setSettings((s) => ({ ...s, enabled: v }))}
        />
        <Toggle
          label="Record data changes"
          hint="Every create, update and delete on students, marks, payroll, contracts, roles and configuration."
          checked={settings.log_data_changes}
          onChange={(v) => setSettings((s) => ({ ...s, log_data_changes: v }))}
        />
        <Toggle
          label="Store before / after values"
          hint="Keeps the old and new values so a change can be reviewed field by field. Turn off to keep personal data out of the audit table — which fields changed is still recorded."
          checked={settings.store_payloads}
          onChange={(v) => setSettings((s) => ({ ...s, store_payloads: v }))}
        />
        <Toggle
          label="Record data exports"
          hint="Downloads of school data. Worth keeping on: an export changes nothing, so it is invisible to a change-only audit."
          checked={settings.log_exports}
          onChange={(v) => setSettings((s) => ({ ...s, log_exports: v }))}
        />
        <Toggle
          label="Record page views"
          hint="One entry per screen opened. Verbose — turn on for an investigation, then off again."
          checked={settings.log_page_views}
          onChange={(v) => setSettings((s) => ({ ...s, log_page_views: v }))}
        />

        <div className="form-row cols2" style={{ marginTop: 18 }}>
          <div className="form-group">
            <label>Keep entries for (days)</label>
            <input
              type="number" min={30} max={3650} className="form-input"
              value={settings.retain_days}
              onChange={(e) => setSettings((s) => ({ ...s, retain_days: Number(e.target.value) || 365 }))}
            />
          </div>
          <div className="form-group">
            <label>Session idle timeout (minutes)</label>
            <input
              type="number" min={5} max={480} className="form-input"
              value={settings.session_idle_minutes}
              onChange={(e) => setSettings((s) => ({ ...s, session_idle_minutes: Number(e.target.value) || 30 }))}
            />
          </div>
        </div>

        <button className="btn btn-primary" onClick={() => void save()} disabled={saving}>
          <i className="fa-solid fa-floppy-disk" /> {saving ? 'Saving…' : 'Save settings'}
        </button>
      </div>

      <div className="card">
        <div className="card-title">Retention</div>
        <p style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.6 }}>
          The audit trail is append-only: entries cannot be edited or deleted from
          the application, and the database refuses any attempt to. The one
          sanctioned way to remove old entries is this purge, which deletes
          everything older than the retention period and records that it did so.
        </p>
        <p style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.6 }}>
          Sessions older than the retention period are removed with it.
        </p>
        <button className="btn btn-danger" onClick={() => void purge()} disabled={purging}>
          <i className="fa-solid fa-broom" /> {purging ? 'Purging…' : `Purge entries older than ${settings.retain_days} days`}
        </button>

        <div className="card-title" style={{ marginTop: 26 }}>Sessions</div>
        <p style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.6 }}>
          Most people close the tab rather than sign out. Sessions with no
          activity for longer than the idle timeout are closed automatically, and
          their duration is measured to the last confirmed activity — not to now,
          which would credit a forgotten open tab with a full working day.
        </p>
        <button
          className="btn btn-outline"
          onClick={() => void (async () => {
            const n = await closeStaleSessions();
            toast(`Closed ${n} idle session${n === 1 ? '' : 's'}.`, 'success');
          })()}
        >
          <i className="fa-solid fa-hourglass-end" /> Close idle sessions now
        </button>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AuditTrailPage() {
  const { role } = useAuth();
  const [tab, setTab] = useState<'activity' | 'sessions' | 'settings'>('activity');

  // AppLayout already gates this page by role; this is the second lock, so a
  // direct navigate() from anywhere else cannot open it either.
  const allowed = role === 'admin' || role === 'super_admin';
  if (!allowed) {
    return (
      <div className="card">
        <div className="card-title">Audit Trail</div>
        <p style={{ fontSize: 12, color: 'var(--text2)' }}>
          You do not have permission to view the audit trail.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Audit Trail</div>
          <div className="page-sub">
            Who did what, from which address, as which role — and how long they were signed in
          </div>
        </div>
      </div>

      <div className="tabs">
        <div className={`tab ${tab === 'activity' ? 'active' : ''}`} onClick={() => setTab('activity')}>
          <i className="fa-solid fa-list-check" style={{ marginRight: 6 }} /> Activity
        </div>
        <div className={`tab ${tab === 'sessions' ? 'active' : ''}`} onClick={() => setTab('sessions')}>
          <i className="fa-solid fa-clock" style={{ marginRight: 6 }} /> Access &amp; Duration
        </div>
        <div className={`tab ${tab === 'settings' ? 'active' : ''}`} onClick={() => setTab('settings')}>
          <i className="fa-solid fa-sliders" style={{ marginRight: 6 }} /> Settings
        </div>
      </div>

      {tab === 'activity' && <ActivityTab />}
      {tab === 'sessions' && <SessionsTab />}
      {tab === 'settings' && <SettingsTab />}
    </>
  );
}
