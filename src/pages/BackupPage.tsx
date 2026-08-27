/**
 * Backup & Restore.
 *
 * Four things, in the order someone actually needs them:
 *
 *   1. Health      how old is the newest copy that is known to work
 *   2. Backup now  one click, straight onto a USB stick
 *   3. Nightly     the pg_dump the VPS took last night, if they want it too
 *   4. Restore     put a file back — behind a typed confirmation
 *
 * The health banner is first because it is the only part that matters when
 * nothing has gone wrong. A backup system's real failure mode is not "the
 * restore did not work"; it is "nobody noticed the nightly job stopped running
 * in March". Anyone opening this page sees that in one line, in colour, before
 * they see anything else.
 *
 * The verify step is offered next to the backup button rather than hidden
 * away, because a backup that has never been read back is a guess. It re-reads
 * the file from the stick, so a stick that quietly failed to write is caught
 * now instead of during a recovery.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/hooks/useAuth';
import {
  ago,
  backupFilename,
  bucketsFromRun,
  BULKY_TABLES,
  canWriteDirectly,
  checkBackupInstalled,
  classifyNightly,
  driveStateFromRun,
  fetchBackupHealth,
  fetchBackupRuns,
  fetchLatestRuns,
  formatBytes,
  hoursSince,
  inspectBackupFile,
  listNightlyDumps,
  mirrorStateFromRun,
  nextScheduledRunUtc,
  nextWeeklyRunUtc,
  restoreFromFile,
  saveBackupToUsb,
  saveNightlyDumpToUsb,
  triggerBackupNow,
  verifyBackupFile,
  type BackupHealth,
  type BackupResult,
  type BackupRunRow,
  type DriveFolder,
  type NightlyDump,
  type NightlyStatus,
  type RestoreInspection,
  type RestoreStrategy,
  type VerifyResult,
} from '@/lib/backup';

type Tab = 'backup' | 'nightly' | 'restore' | 'history';

/** Typed word that unlocks the restore button. Deliberately not "yes". */
const RESTORE_PHRASE = 'RESTORE';

/** A nightly cloud backup older than this is shown as a problem, not a note.
 *  36 hours, not 24: a job that runs at 02:00 has not missed a night at 09:00
 *  the next morning, and a banner that cries wolf every morning gets ignored. */
const CLOUD_STALE_HOURS = 36;

export default function BackupPage() {
  const { toast } = useApp();
  const { role } = useAuth();
  const [tab, setTab] = useState<Tab>('backup');

  // AppLayout's ROLE_PAGES already gates this page, and every function behind
  // it re-checks the role in SQL or in the edge function. This is the second
  // lock in the browser, mirroring AuditTrailPage: a direct navigate() from
  // anywhere else — a stale menu, a future deep link, a hand-edited state —
  // cannot open it either.
  const isAdmin = role === 'admin' || role === 'super_admin';
  // Restore is narrower still. The db-restore edge function refuses anyone who
  // is not super_admin, so showing an admin a form that always fails at the
  // last step is worse than not showing it: the page now says why.
  const canRestore = role === 'super_admin';

  const [health, setHealth] = useState<BackupHealth | null>(null);
  const [runs, setRuns] = useState<BackupRunRow[]>([]);
  // The newest cloud/files runs specifically. Kept apart from `runs` because
  // that list is ordered by time alone: a busy afternoon of USB backups would
  // push the only nightly row past the limit, and the Nightly tab would then
  // announce that the nightly job had never run.
  const [machineRuns, setMachineRuns] = useState<BackupRunRow[]>([]);
  const [loading, setLoading] = useState(true);
  // null while unknown. Everything on this page needs the migration, so it is
  // checked once here rather than discovered four times in four corners.
  const [installed, setInstalled] = useState<boolean | null>(null);

  const refresh = useCallback(async () => {
    // Nothing behind this page would answer a non-admin anyway — backup_health()
    // returns {} and RLS empties backup_runs — but firing three requests that
    // are certain to come back empty would light up the audit trail with noise.
    if (!isAdmin) { setLoading(false); return; }
    setLoading(true);
    try {
      const probe = await checkBackupInstalled();
      setInstalled(probe.installed);
      if (!probe.installed) {
        setHealth(null);
        setRuns([]);
        setMachineRuns([]);
        return;
      }
      const [h, r, m] = await Promise.all([
        fetchBackupHealth(),
        fetchBackupRuns(50),
        fetchLatestRuns(),
      ]);
      setHealth(h);
      setRuns(r);
      setMachineRuns(m);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setLoading(false);
    }
  }, [toast, isAdmin]);

  useEffect(() => { void refresh(); }, [refresh]);

  // After the hooks, never before: an early return above them would change the
  // hook order between renders the moment the role resolves.
  if (!isAdmin) {
    return (
      <div className="card">
        <div className="card-title">Backup &amp; Restore</div>
        <p style={{ fontSize: 12, color: 'var(--text2)' }}>
          You do not have permission to back up or restore the database.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Backup &amp; Restore</div>
          <div className="page-sub">
            Take a copy of the database to a USB stick, check the nightly cloud backup, or put a
            backup back.
          </div>
        </div>
        <button className="btn btn-outline btn-sm" onClick={() => void refresh()} disabled={loading}>
          <i className="fa-solid fa-rotate" /> Refresh
        </button>
      </div>

      {installed === false && <NotInstalled onRecheck={refresh} />}

      {installed !== false && <HealthBanner health={health} />}

      <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
        {([
          ['backup', 'Backup now', 'fa-solid fa-download'],
          ['nightly', 'Nightly cloud backups', 'fa-brands fa-google-drive'],
          ['restore', 'Restore', 'fa-solid fa-rotate-left'],
          ['history', 'History', 'fa-solid fa-clock-rotate-left'],
        ] as const).map(([id, label, icon]) => (
          <button
            key={id}
            className={`btn ${tab === id ? 'btn-primary' : 'btn-outline'} btn-sm`}
            onClick={() => setTab(id)}
          >
            <i className={icon} /> {label}
          </button>
        ))}
      </div>

      {tab === 'backup' && <BackupTab onDone={refresh} />}
      {tab === 'nightly' && (
        <NightlyTab runs={machineRuns} loading={loading} onRefresh={refresh} />
      )}
      {tab === 'restore' && (canRestore ? <RestoreTab onDone={refresh} /> : <RestoreNotPermitted />)}
      {tab === 'history' && <HistoryTab runs={runs} loading={loading} />}
    </>
  );
}

// ─── Not installed yet ────────────────────────────────────────────────────────

/**
 * What the page shows before the migration has been applied.
 *
 * PostgREST's own words for this are PGRST205 and PGRST202 — "could not find
 * the table … in the schema cache" — which land in a toast looking like the
 * feature is broken rather than not yet switched on. This says the one thing
 * that is actually true and gives the two commands that fix it.
 *
 * It also covers the other half of the same confusion: PostgREST caches its
 * picture of the schema, so for up to a minute *after* a successful migration
 * the errors continue unchanged. Hence the Check again button.
 */
function NotInstalled({ onRecheck }: { onRecheck: () => void }) {
  return (
    <div
      className="card"
      style={{ marginBottom: 16, borderLeft: '4px solid #d4a72c', background: '#fff8c5' }}
    >
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>
        <i className="fa-solid fa-triangle-exclamation" /> Backup is not installed on this database yet
      </div>
      <div style={{ fontSize: 12, lineHeight: 1.7 }}>
        The <code>backup_runs</code> table and the <code>backup_*</code> functions are not there, so
        nothing on this page can work yet. Two steps, both in{' '}
        <code>docs/BACKUP_AND_RESTORE.md</code>:
        <ol style={{ margin: '10px 0 10px 18px', paddingLeft: 4 }}>
          <li style={{ marginBottom: 6 }}>
            <strong>Apply the migration.</strong> Supabase → SQL Editor → paste the whole of{' '}
            <code>supabase/migrations/20260824120000_backup_and_restore.sql</code> → Run.
            <br />
            <span style={{ color: '#7d4e00' }}>
              Do <strong>not</strong> use <code>supabase db push</code> on this project — see the
              warning in <code>supabase/config.toml</code>.
            </span>
          </li>
          <li>
            <strong>Deploy the functions.</strong>
            <br />
            <code style={{ fontSize: 11 }}>
              supabase functions deploy db-backup --project-ref gmdbrgjxdeztgzvqsaaj
            </code>
            <br />
            <code style={{ fontSize: 11 }}>
              supabase functions deploy db-restore --project-ref gmdbrgjxdeztgzvqsaaj
            </code>
            <br />
            <code style={{ fontSize: 11 }}>
              supabase functions deploy backup-report --project-ref gmdbrgjxdeztgzvqsaaj
            </code>
          </li>
        </ol>
        The API caches the schema, so if you have just run the migration give it a few seconds — the
        last line of the migration asks it to reload — then:
      </div>
      <button className="btn btn-primary btn-sm" style={{ marginTop: 10 }} onClick={onRecheck}>
        <i className="fa-solid fa-rotate" /> Check again
      </button>
    </div>
  );
}

// ─── Health banner ────────────────────────────────────────────────────────────

function HealthBanner({ health }: { health: BackupHealth | null }) {
  if (!health) return null;

  const cloudAge = hoursSince(health.last_cloud_success);
  const bad = cloudAge > CLOUD_STALE_HOURS;
  const restoreAge = hoursSince(health.last_verified_restore);
  const restoreStale = restoreAge > 24 * 35;   // a monthly drill, plus slack

  return (
    <div
      className="card"
      style={{
        marginBottom: 16,
        borderLeft: `4px solid ${bad ? 'var(--danger)' : '#1a7f37'}`,
        background: bad ? '#fff5f5' : undefined,
      }}
    >
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ fontSize: 20, color: bad ? 'var(--danger)' : '#1a7f37' }}>
          <i className={bad ? 'fa-solid fa-triangle-exclamation' : 'fa-solid fa-shield-halved'} />
        </div>
        <div style={{ flex: 1, minWidth: 260 }}>
          <div style={{ fontWeight: 700, fontSize: 13 }}>
            {bad
              ? 'The nightly cloud backup is overdue'
              : 'Cloud backup is running'}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text2)', marginTop: 3 }}>
            Last successful cloud backup <strong>{ago(health.last_cloud_success)}</strong>
            {health.cloud_failures_7d > 0 &&
              ` · ${health.cloud_failures_7d} failed attempt${health.cloud_failures_7d === 1 ? '' : 's'} in the last 7 days`}
          </div>
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--text2)' }}>
          <div>Last USB backup: <strong>{ago(health.last_usb_success)}</strong></div>
          <div style={{ color: restoreStale ? 'var(--danger)' : undefined }}>
            Last verified restore: <strong>{ago(health.last_verified_restore)}</strong>
          </div>
        </div>
      </div>
      {bad && (
        <div style={{ fontSize: 11.5, marginTop: 12, color: 'var(--text2)' }}>
          The <strong>Nightly cloud backups</strong> tab says what went wrong and what to do about
          it. Until it is fixed, take a USB backup below at the end of each day. See{' '}
          <code>docs/BACKUP_AND_RESTORE.md</code> §9.
        </div>
      )}
    </div>
  );
}

// ─── Tab 1: backup now ────────────────────────────────────────────────────────

function BackupTab({ onDone }: { onDone: () => void }) {
  const { toast } = useApp();
  const [includeAudit, setIncludeAudit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ phase: string; done: number; total: number; bytes: number } | null>(null);
  const [result, setResult] = useState<BackupResult | null>(null);
  const [verify, setVerify] = useState<VerifyResult | null>(null);
  const [verifying, setVerifying] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const verifyInput = useRef<HTMLInputElement>(null);

  const direct = canWriteDirectly();

  const run = async () => {
    setBusy(true);
    setResult(null);
    setVerify(null);
    abortRef.current = new AbortController();
    try {
      const res = await saveBackupToUsb({
        skip: includeAudit ? [] : BULKY_TABLES,
        signal: abortRef.current.signal,
        onProgress: (p) =>
          setProgress({ phase: p.phase, done: p.rowsDone, total: p.rowsExpected, bytes: p.bytesWritten }),
      });
      setResult(res);
      toast(`Backup written: ${res.rows.toLocaleString()} rows, ${formatBytes(res.bytes)}`, 'success');
      onDone();
    } catch (e) {
      const msg = (e as Error).message;
      // A cancelled file picker is a decision, not a failure.
      if (/abort/i.test(msg) || (e as Error).name === 'AbortError') toast('Backup cancelled', 'info');
      else toast(msg, 'error');
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const onVerifyFile = async (file: File) => {
    setVerifying(true);
    setVerify(null);
    try {
      setVerify(await verifyBackupFile(file));
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setVerifying(false);
    }
  };

  const pct = progress && progress.total > 0
    ? Math.min(100, Math.round((progress.done / progress.total) * 100))
    : null;

  return (
    <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'minmax(0, 3fr) minmax(280px, 2fr)' }}>
      <div className="card">
        <div className="card-title">Save a copy of the database</div>

        <p style={{ fontSize: 12.5, color: 'var(--text2)', marginBottom: 14, lineHeight: 1.6 }}>
          Plug in the USB stick, click below, and choose it as the destination. Every row of every
          table is written to one compressed file — {' '}
          <code>{backupFilename(true)}</code> — and the file is checked as it is written.
        </p>

        {!direct && (
          <div
            style={{
              fontSize: 11.5, background: '#fff8c5', border: '1px solid #d4a72c',
              borderRadius: 6, padding: '8px 10px', marginBottom: 14,
            }}
          >
            <strong>This browser cannot write straight to the stick.</strong> The file will go to
            your Downloads folder and you will need to copy it across yourself. For one-click
            saving, use Chrome or Edge.
          </div>
        )}

        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12, marginBottom: 16 }}>
          <input
            type="checkbox"
            checked={includeAudit}
            onChange={(e) => setIncludeAudit(e.target.checked)}
            disabled={busy}
            style={{ marginTop: 2 }}
          />
          <span>
            Include the audit trail ({BULKY_TABLES.join(', ')}).
            <span style={{ color: 'var(--text2)' }}>
              {' '}Off by default — it is usually the largest part of the database and is not needed
              to rebuild the school's records.
            </span>
          </span>
        </label>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={() => void run()} disabled={busy}>
            <i className={busy ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-floppy-disk'} />
            {busy ? 'Backing up…' : direct ? 'Back up to USB' : 'Back up (download)'}
          </button>
          {busy && (
            <button className="btn btn-outline" onClick={() => abortRef.current?.abort()}>
              Cancel
            </button>
          )}
        </div>

        {progress && (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 11.5, color: 'var(--text2)', marginBottom: 6 }}>
              {progress.phase} · {progress.done.toLocaleString()} of {progress.total.toLocaleString()} rows
              {progress.bytes > 0 && ` · ${formatBytes(progress.bytes)} written`}
            </div>
            <div style={{ height: 8, background: 'var(--surface2)', borderRadius: 4, overflow: 'hidden' }}>
              <div
                style={{
                  height: '100%',
                  width: `${pct ?? 0}%`,
                  background: 'var(--accent)',
                  transition: 'width .2s',
                }}
              />
            </div>
          </div>
        )}

        {result && (
          <div
            style={{
              marginTop: 16, padding: 12, borderRadius: 6,
              background: '#dafbe1', border: '1px solid #1a7f37', fontSize: 12,
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 6 }}>
              <i className="fa-solid fa-circle-check" /> {result.filename}
            </div>
            <div style={{ color: '#116329', lineHeight: 1.7 }}>
              {result.rows.toLocaleString()} rows · {result.tables} tables · {formatBytes(result.bytes)}
              <br />
              SHA-256 <code style={{ fontSize: 10.5, wordBreak: 'break-all' }}>{result.checksum}</code>
              {!result.wroteDirectly && (
                <>
                  <br />
                  <strong>Now copy this file from Downloads onto the USB stick.</strong>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-title">Check a backup file</div>
        <p style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.6, marginBottom: 12 }}>
          A backup nobody has read back is a guess. Pick the file <em>from the USB stick</em> — not
          from Downloads — and this reads it end to end, counts every table against the manifest,
          and shows the checksum so it can be compared with the one recorded in History.
        </p>
        <input
          ref={verifyInput}
          type="file"
          accept=".gz,.ndjson"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onVerifyFile(f);
            e.target.value = '';
          }}
        />
        <button
          className="btn btn-outline"
          onClick={() => verifyInput.current?.click()}
          disabled={verifying}
        >
          <i className={verifying ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-magnifying-glass'} />
          {verifying ? 'Checking…' : 'Choose a file to check'}
        </button>

        {verify && (
          <div style={{ marginTop: 14, fontSize: 12 }}>
            <div
              style={{
                fontWeight: 700, color: verify.ok ? '#1a7f37' : 'var(--danger)', marginBottom: 8,
              }}
            >
              <i className={verify.ok ? 'fa-solid fa-circle-check' : 'fa-solid fa-circle-xmark'} />{' '}
              {verify.ok ? 'This file is a complete backup' : 'This file is not usable'}
            </div>
            <div style={{ color: 'var(--text2)', lineHeight: 1.7 }}>
              {verify.filename} · {formatBytes(verify.bytes)} ·{' '}
              {verify.rowsCounted.toLocaleString()} rows
              {verify.manifest && <> · taken {ago(verify.manifest.generated_at)} by {verify.manifest.taken_by}</>}
              <br />
              SHA-256 <code style={{ fontSize: 10.5, wordBreak: 'break-all' }}>{verify.checksum}</code>
            </div>
            {verify.problems.map((p) => (
              <div key={p} style={{ color: 'var(--danger)', marginTop: 6 }}>• {p}</div>
            ))}
            {verify.mismatches.map((m) => (
              <div key={m.table} style={{ color: 'var(--danger)', marginTop: 6 }}>
                • {m.table}: expected {m.expected.toLocaleString()} rows, found {m.found.toLocaleString()}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Tab 2: nightly cloud backups ─────────────────────────────────────────────

/** The four colour tones this tab uses, matching the ones already established
 *  on the other tabs so the page reads as one thing. */
const TONES = {
  good: { line: '#1a7f37', bg: '#dafbe1', icon: 'fa-solid fa-shield-halved' },
  bad: { line: 'var(--danger)', bg: '#ffebe9', icon: 'fa-solid fa-triangle-exclamation' },
  warn: { line: '#d4a72c', bg: '#fff8c5', icon: 'fa-solid fa-circle-exclamation' },
  info: { line: '#0969da', bg: '#ddf4ff', icon: 'fa-solid fa-circle-info' },
} as const;

function Panel({
  tone, title, children,
}: { tone: keyof typeof TONES; title: string; children?: React.ReactNode }) {
  const t = TONES[tone];
  return (
    <div
      style={{
        borderLeft: `4px solid ${t.line}`,
        background: t.bg,
        borderRadius: 6,
        padding: '12px 14px',
        marginBottom: 14,
      }}
    >
      <div style={{ fontWeight: 700, fontSize: 12.5, display: 'flex', gap: 8, alignItems: 'center' }}>
        <i className={t.icon} style={{ color: t.line }} />
        {title}
      </div>
      {children && (
        <div style={{ fontSize: 11.5, color: 'var(--text2)', lineHeight: 1.65, marginTop: 6 }}>
          {children}
        </div>
      )}
    </div>
  );
}

/** A UTC instant rendered in the reader's own timezone, which is the only one
 *  they can act on. The UTC time is kept alongside because every cron line and
 *  every Actions log is in UTC. */
function whenDue(d: Date): string {
  const local = d.toLocaleString(undefined, {
    weekday: 'short', hour: '2-digit', minute: '2-digit',
  });
  const utc = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`;
  return `${local} (${utc})`;
}

/** How long to keep watching after a manual trigger before saying so plainly.
 *  A dump of this database takes a minute or two; eight covers a cold runner
 *  and a queue without ever pretending a slow run has failed. */
const TRIGGER_WATCH_MS = 8 * 60_000;
const TRIGGER_POLL_MS = 8_000;

interface TriggerState {
  phase: 'dispatched' | 'running' | 'success' | 'failed' | 'timeout';
  message: string;
}

function NightlyTab({
  runs, loading, onRefresh,
}: { runs: BackupRunRow[]; loading: boolean; onRefresh: () => Promise<void> | void }) {
  const { toast } = useApp();
  const [dumps, setDumps] = useState<NightlyDump[]>([]);
  const [dumpsError, setDumpsError] = useState<string | null>(null);
  const [dumpsLoading, setDumpsLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [trigger, setTrigger] = useState<TriggerState | null>(null);
  const timers = useRef<{ poll?: number; stop?: number }>({});

  const reloadDumps = useCallback(async () => {
    setDumpsLoading(true);
    const r = await listNightlyDumps();
    setDumps(r.dumps);
    setDumpsError(r.error);
    setDumpsLoading(false);
  }, []);

  useEffect(() => { void reloadDumps(); }, [reloadDumps]);

  // Polling must not outlive the tab. Without this, switching to History
  // mid-run leaves an interval calling setState on an unmounted component.
  useEffect(() => () => {
    window.clearInterval(timers.current.poll);
    window.clearTimeout(timers.current.stop);
  }, []);

  const cloud = classifyNightly(runs, 'cloud');
  const files = classifyNightly(runs, 'files', 24 * 8);
  const drive = driveStateFromRun(cloud.run);
  const mirror = mirrorStateFromRun(cloud.run);

  const save = async (name: string) => {
    setSaving(name);
    try {
      const r = await saveNightlyDumpToUsb(name);
      toast(
        r.wroteDirectly
          ? `${name} saved (${formatBytes(r.bytes)})`
          : `${name} downloaded — copy it onto the USB stick`,
        'success',
      );
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setSaving(null);
    }
  };

  const refreshAll = async () => {
    await Promise.all([reloadDumps(), onRefresh()]);
  };

  /**
   * Start tonight's backup now.
   *
   * GitHub's workflow_dispatch answers 204 with an empty body — no run id, no
   * URL, nothing to follow. So the run is identified the only way that is
   * reliable: by snapshotting the ids already in backup_runs and watching for
   * one that is not among them. Ids rather than timestamps, because comparing
   * a Postgres timestamp against Date.now() assumes the browser's clock agrees
   * with the database's, and it frequently does not.
   */
  const runNow = async () => {
    setBusy(true);
    const seen = new Set(runs.filter((r) => r.kind === 'cloud').map((r) => r.id));

    try {
      await triggerBackupNow('db-backup');
    } catch (e) {
      setBusy(false);
      setTrigger(null);
      toast((e as Error).message, 'error');
      return;
    }

    setTrigger({
      phase: 'dispatched',
      message: 'GitHub has accepted the request. The runner takes a minute or two to start.',
    });

    const stopWatching = () => {
      window.clearInterval(timers.current.poll);
      window.clearTimeout(timers.current.stop);
      setBusy(false);
    };

    timers.current.poll = window.setInterval(() => {
      void (async () => {
        let latest: BackupRunRow[];
        try {
          latest = await fetchLatestRuns();
        } catch {
          return;   // a blip in polling is not a failed backup; keep watching
        }
        const fresh = latest.find((r) => r.kind === 'cloud' && !seen.has(r.id));
        if (!fresh) return;

        if (fresh.status === 'running') {
          setTrigger({
            phase: 'running',
            message: `Running — started ${ago(fresh.started_at)}.`,
          });
          return;
        }

        stopWatching();
        setTrigger(
          fresh.status === 'success'
            ? { phase: 'success', message: `Finished. ${fresh.artifact ?? 'The dump'} is in Google Drive.` }
            : { phase: 'failed', message: fresh.message ?? 'The run reported a failure.' },
        );
        await refreshAll();
      })();
    }, TRIGGER_POLL_MS);

    timers.current.stop = window.setTimeout(() => {
      stopWatching();
      setTrigger({
        phase: 'timeout',
        message:
          'Still running after 8 minutes. That is not a failure — it is safe to leave this ' +
          'page; the banner and the History tab will show the result.',
      });
    }, TRIGGER_WATCH_MS);
  };

  return (
    <>
      {/* ─── Status ─────────────────────────────────────────────────────── */}
      <div className="card">
        <div
          className="card-title"
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}
        >
          <span>Nightly database backup</span>
          <span style={{ display: 'flex', gap: 6 }}>
            <button className="btn btn-outline btn-sm" onClick={() => void refreshAll()} disabled={loading}>
              <i className="fa-solid fa-rotate" /> Refresh
            </button>
            <button className="btn btn-primary btn-sm" onClick={() => void runNow()} disabled={busy}>
              <i className={busy ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-play'} />
              {busy ? 'Running…' : 'Run backup now'}
            </button>
          </span>
        </div>

        <p style={{ fontSize: 12.5, color: 'var(--text2)', lineHeight: 1.6, marginBottom: 14 }}>
          Every night a full <code>pg_dump</code> is taken and uploaded to Google Drive, and a copy
          is kept here for a week. That dump can rebuild the database from nothing — tables,
          constraints and all — where the USB snapshot on the previous tab needs the tables to
          already exist. Both are worth having.
        </p>

        {trigger && (
          <Panel
            tone={
              trigger.phase === 'success' ? 'good'
              : trigger.phase === 'failed' ? 'bad'
              : trigger.phase === 'timeout' ? 'warn'
              : 'info'
            }
            title={
              trigger.phase === 'success' ? 'Backup finished'
              : trigger.phase === 'failed' ? 'That run failed'
              : trigger.phase === 'timeout' ? 'Still going'
              : 'Backup requested'
            }
          >
            {trigger.message}
          </Panel>
        )}

        <NightlyState status={cloud} loading={loading} />

        {cloud.run && (
          <div style={{ fontSize: 11.5, color: 'var(--text2)', display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            <span>Last run <strong>{ago(cloud.run.started_at)}</strong></span>
            <span>Next due <strong>{whenDue(nextScheduledRunUtc())}</strong></span>
            {cloud.run.row_count !== null && (
              <span>{cloud.run.row_count.toLocaleString()} rows across {cloud.run.table_count ?? '—'} tables</span>
            )}
          </div>
        )}
      </div>

      {/* ─── Google Drive ───────────────────────────────────────────────── */}
      {drive && <DriveSection drive={drive} />}

      {/* ─── The copy kept here ─────────────────────────────────────────── */}
      <div className="card">
        <div className="card-title">The copy kept here</div>
        <p style={{ fontSize: 12.5, color: 'var(--text2)', lineHeight: 1.6, marginBottom: 14 }}>
          Each night's dump is also mirrored into this project for a week, so it can be put on a USB
          stick from this page without anyone needing access to Google Drive. This is a convenience
          copy — the backup itself is the one in Drive above.
        </p>

        {dumpsLoading ? (
          <div style={{ fontSize: 12, color: 'var(--text2)' }}>Loading…</div>
        ) : dumpsError ? (
          <Panel tone="warn" title="This copy could not be listed">
            {dumpsError}
            <div style={{ marginTop: 6 }}>
              This says nothing about the Google Drive backup, which does not depend on it.
            </div>
          </Panel>
        ) : dumps.length === 0 ? (
          <EmptyMirror cloud={cloud} mirror={mirror} />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>File</th>
                  <th>Taken</th>
                  <th>Size</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {dumps.map((d) => (
                  <tr key={d.name}>
                    <td style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11.5 }}>{d.name}</td>
                    <td style={{ fontSize: 12 }}>{ago(d.created_at)}</td>
                    <td style={{ fontSize: 12 }}>{formatBytes(d.size)}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        className="btn btn-outline btn-sm"
                        onClick={() => void save(d.name)}
                        disabled={saving !== null}
                      >
                        <i className={saving === d.name ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-download'} />
                        Save to USB
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ─── Photos and documents ───────────────────────────────────────── */}
      <FilesSection status={files} />
    </>
  );
}

/** The one panel that says what is actually going on with the nightly job. */
function NightlyState({ status, loading }: { status: NightlyStatus; loading: boolean }) {
  const { state, run } = status;
  if (loading && !run) return <div style={{ fontSize: 12, color: 'var(--text2)' }}>Loading…</div>;

  if (state === 'never_configured') {
    return (
      <Panel tone="warn" title="No cloud backup has ever run on this database">
        The page is working; the job has simply never been switched on. Two things are needed, both
        outside this app:
        <ol style={{ margin: '8px 0 0 18px', padding: 0 }}>
          <li>
            <code>.github/workflows/db-backup.yml</code> must be committed and pushed to the{' '}
            <code>main</code> branch. GitHub cannot run — or be asked to run — a workflow it has
            never seen.
          </li>
          <li>
            Six repository secrets must be set under <em>Settings → Secrets and variables →
            Actions</em>, including the Google Drive credentials.
          </li>
        </ol>
        <div style={{ marginTop: 8 }}>
          Run <code>npm run check:backup</code> for a checklist of what is and is not in place, and
          see <code>docs/BACKUP_GITHUB_ACTIONS.md</code> for how to obtain each secret.
        </div>
      </Panel>
    );
  }

  if (state === 'failing') {
    return (
      <Panel tone="bad" title={`The last nightly backup failed, ${ago(run?.started_at)}`}>
        <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, marginBottom: 8 }}>
          {run?.message ?? 'No reason was recorded.'}
        </div>
        Until this is fixed, take a USB backup on the first tab at the end of each day. The full log
        is in the repository's Actions tab, under <em>Nightly database backup</em>.
      </Panel>
    );
  }

  if (state === 'stalled') {
    return (
      <Panel tone="bad" title={`A backup started ${ago(run?.started_at)} and never finished`}>
        The runner began the job and stopped without reporting either success or failure — it was
        cancelled, timed out, or died. Whatever it managed to upload before that point should not be
        trusted. Check the Actions tab, then start a fresh run.
      </Panel>
    );
  }

  if (state === 'running') {
    return (
      <Panel tone="info" title={`A backup is running — started ${ago(run?.started_at)}`}>
        It will appear below when it finishes.
      </Panel>
    );
  }

  if (state === 'stale') {
    return (
      <Panel tone="bad" title={`The newest cloud backup is from ${ago(run?.started_at)}`}>
        It succeeded, but nothing has run since. A scheduled workflow is disabled automatically
        after 60 days without activity in the repository, which is the usual cause. Check the
        Actions tab, and use <em>Run backup now</em> above in the meantime.
      </Panel>
    );
  }

  return (
    <Panel tone="good" title={`Cloud backup is running normally — last succeeded ${ago(run?.started_at)}`} />
  );
}

/**
 * What to say when the mirror is empty.
 *
 * This is the case the page used to get wrong. An empty bucket has three
 * completely different meanings, and announcing "no dumps here yet" for all
 * three told an operator whose backups were landing safely in Drive that they
 * had none at all.
 */
function EmptyMirror({ cloud, mirror }: { cloud: NightlyStatus; mirror: ReturnType<typeof mirrorStateFromRun> }) {
  const s = { fontSize: 12, color: 'var(--text2)', lineHeight: 1.65 };

  // The important one: the backup exists, it is just too big to keep here.
  if (cloud.state === 'healthy' || cloud.state === 'stale') {
    if (cloud.run?.storage_path) {
      return (
        <div style={s}>
          The most recent dump was mirrored here but has since been removed — copies are kept for
          seven days. The full history is in Google Drive above.
        </div>
      );
    }
    const size = mirror?.size_mb ? `${mirror.size_mb.toFixed(1)} MB` : 'the dump';
    const cap = mirror?.max_mb ? `${mirror.max_mb} MB limit` : 'size limit';
    return (
      <Panel tone="info" title="Last night's backup is in Google Drive, but not here">
        {mirror?.reason ?? `It was skipped because ${size} exceeds this project's ${cap}.`}{' '}
        Nothing is wrong with the backup — it is listed above and safe in Drive. It simply cannot be
        put on a USB stick from this page. Download it from Drive instead, or use the USB snapshot
        on the first tab.
      </Panel>
    );
  }

  if (cloud.state === 'never_configured') {
    return <div style={s}>Nothing to show until the nightly job has run for the first time.</div>;
  }

  return (
    <div style={s}>
      No copy is held here. See the status above — the most recent run did not complete.
    </div>
  );
}

/** What is actually sitting in Google Drive, as of the last run. */
function DriveSection({ drive }: { drive: ReturnType<typeof driveStateFromRun> }) {
  if (!drive) return null;

  return (
    <div className="card">
      <div className="card-title">In Google Drive</div>

      {drive.error ? (
        <Panel tone="warn" title="Drive could not be listed after the last run">
          {drive.error}
          <div style={{ marginTop: 6 }}>
            The upload itself is reported separately and may well have succeeded — see the status
            above. Only this listing failed.
          </div>
        </Panel>
      ) : (
        <>
          <div style={{ fontSize: 11.5, color: 'var(--text2)', lineHeight: 1.7, marginBottom: 12 }}>
            <div>
              Destination{' '}
              {drive.folder_url ? (
                <a href={drive.folder_url} target="_blank" rel="noreferrer">
                  <code>{drive.remote}</code> <i className="fa-solid fa-arrow-up-right-from-square" style={{ fontSize: 9 }} />
                </a>
              ) : (
                <code>{drive.remote}</code>
              )}
            </div>
            <div>
              Daily copies are deleted after 30 days; the 1st of each month is filed under{' '}
              <code>monthly/</code> and kept indefinitely.
            </div>
            {drive.listed_at && (
              <div style={{ marginTop: 4, fontStyle: 'italic' }}>
                This is what was there when the last backup finished, {ago(drive.listed_at)} — this
                page does not read Drive live.
              </div>
            )}
          </div>

          <DriveTable label="Daily" folder={drive.daily} />
          <DriveTable label="Monthly" folder={drive.monthly} />
        </>
      )}
    </div>
  );
}

function DriveTable({ label, folder }: { label: string; folder: DriveFolder | null }) {
  if (!folder) return null;
  if (!folder.count) {
    return (
      <div style={{ fontSize: 11.5, color: 'var(--text2)', marginBottom: 10 }}>
        <strong>{label}</strong> — empty
        {label === 'Monthly' && ' (the first monthly copy is filed on the 1st)'}
      </div>
    );
  }

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 6 }}>
        {label} — {folder.count} file{folder.count === 1 ? '' : 's'}, {formatBytes(folder.bytes)}
        {folder.truncated && (
          <span style={{ fontWeight: 400, color: 'var(--text2)' }}>
            {' '}(showing the newest {folder.files.length})
          </span>
        )}
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>File</th>
              <th>Uploaded</th>
              <th style={{ textAlign: 'right' }}>Size</th>
            </tr>
          </thead>
          <tbody>
            {folder.files.map((f) => (
              <tr key={f.name}>
                <td style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>
                  {f.id ? (
                    <a href={`https://drive.google.com/file/d/${f.id}/view`} target="_blank" rel="noreferrer">
                      {f.name}
                    </a>
                  ) : f.name}
                </td>
                <td style={{ fontSize: 11.5 }}>{ago(f.mod)}</td>
                <td style={{ fontSize: 11.5, textAlign: 'right' }}>{formatBytes(f.size)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Photos, documents and attachments.
 *
 * Kept visually and logically apart from the database backup, and deliberately
 * absent from the health banner: a failed photo sync must never turn the
 * database's indicator red, and a successful one must never mask a database
 * backup that has stopped running.
 */
function FilesSection({ status }: { status: NightlyStatus }) {
  const { state, run } = status;
  const buckets = bucketsFromRun(run);

  return (
    <div className="card">
      <div className="card-title">Photos and documents</div>
      <p style={{ fontSize: 12.5, color: 'var(--text2)', lineHeight: 1.6, marginBottom: 14 }}>
        Student photos, applicant documents, employee files, assignment uploads and timetables live
        in file storage, not in the database, so the nightly <code>pg_dump</code> does not contain
        them. They are copied to Google Drive once a week instead. A file deleted or replaced in the
        app is moved aside in Drive rather than destroyed, so last week's version can still be
        recovered.
      </p>

      {state === 'never_configured' ? (
        <Panel tone="warn" title="The weekly file backup has never run">
          Photos, documents and attachments are currently in no backup at all. This needs the
          workflow pushed to <code>main</code> and three Supabase Storage S3 keys set as repository
          secrets — see <code>docs/BACKUP_GITHUB_ACTIONS.md</code>.
        </Panel>
      ) : state === 'failing' || state === 'stalled' ? (
        <Panel tone="bad" title={`The last file backup ${state === 'failing' ? 'failed' : 'never finished'}, ${ago(run?.started_at)}`}>
          {run?.message ?? 'No reason was recorded.'}
        </Panel>
      ) : state === 'stale' ? (
        <Panel tone="warn" title={`The newest file backup is from ${ago(run?.started_at)}`}>
          It succeeded, but the weekly job has not run since.
        </Panel>
      ) : state === 'running' ? (
        <Panel tone="info" title={`A file backup is running — started ${ago(run?.started_at)}`} />
      ) : (
        <>
          <Panel tone="good" title={`Files backed up ${ago(run?.started_at)}`}>
            {run?.message ?? null}
          </Panel>
          <div style={{ fontSize: 11.5, color: 'var(--text2)', marginBottom: 10 }}>
            Next due <strong>{whenDue(nextWeeklyRunUtc())}</strong>
          </div>
        </>
      )}

      {buckets.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Bucket</th>
                <th style={{ textAlign: 'right' }}>Files</th>
                <th style={{ textAlign: 'right' }}>Size</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {buckets.map((b) => (
                <tr key={b.name}>
                  <td style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11.5 }}>{b.name}</td>
                  <td style={{ fontSize: 11.5, textAlign: 'right' }}>{b.objects.toLocaleString()}</td>
                  <td style={{ fontSize: 11.5, textAlign: 'right' }}>{formatBytes(b.bytes)}</td>
                  <td style={{ fontSize: 11, color: b.skipped ? 'var(--danger)' : 'var(--text2)' }}>
                    {b.skipped ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Tab 3: restore ───────────────────────────────────────────────────────────

/**
 * What an `admin` sees on the Restore tab.
 *
 * Backing up and restoring are not the same privilege. A backup copies data
 * out; a restore overwrites live records with an older set, and there is no
 * undo. The db-restore edge function has always refused anyone who is not
 * super_admin — this only stops an admin filling in the whole form and typing
 * the confirmation phrase before finding that out.
 */
function RestoreNotPermitted() {
  return (
    <div className="card">
      <div className="card-title">Restore</div>
      <p style={{ fontSize: 12.5, color: 'var(--text2)', lineHeight: 1.6, marginTop: 8 }}>
        Restoring overwrites live records with an older copy and cannot be undone, so it is
        limited to a <strong>super administrator</strong>. Taking a backup, checking the nightly
        cloud copies and reading the history are all available to you here.
      </p>
    </div>
  );
}


function RestoreTab({ onDone }: { onDone: () => void }) {
  const { toast } = useApp();
  const [file, setFile] = useState<File | null>(null);
  const [inspection, setInspection] = useState<RestoreInspection | null>(null);
  const [strategy, setStrategy] = useState<RestoreStrategy>('merge');
  const [phrase, setPhrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const choose = async (f: File) => {
    setFile(f);
    setInspection(null);
    setPhrase('');
    try {
      setInspection(await inspectBackupFile(f));
    } catch (e) {
      toast((e as Error).message, 'error');
      setFile(null);
    }
  };

  const go = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const res = await restoreFromFile(file, {
        strategy,
        onProgress: (p) =>
          setProgress(`${p.phase} ${p.rowsDone.toLocaleString()} / ${p.rowsExpected.toLocaleString()} rows`),
      });
      toast(`Restored ${res.rows.toLocaleString()} rows across ${res.tables} tables`, 'success');
      if (res.droppedColumns.length) {
        toast(`Columns no longer in the schema were skipped: ${res.droppedColumns.join(', ')}`, 'info');
      }
      setPhrase('');
      onDone();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const unlocked = phrase.trim().toUpperCase() === RESTORE_PHRASE && !!inspection && !busy;

  return (
    <div className="card">
      <div className="card-title">Restore from a backup file</div>

      <div
        style={{
          fontSize: 12, background: '#ffebe9', border: '1px solid #cf222e',
          borderRadius: 6, padding: '10px 12px', marginBottom: 16, lineHeight: 1.6,
        }}
      >
        <strong>Read this before you continue.</strong> A restore writes over live data and cannot
        be undone from inside the application. Take a fresh USB backup first — that is what you
        will fall back to if this restore turns out to be the wrong file. Rehearse restores on a
        scratch Supabase project, not here; see <code>docs/BACKUP_AND_RESTORE.md</code> §8.
      </div>

      <input
        ref={input}
        type="file"
        accept=".gz,.ndjson"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void choose(f);
          e.target.value = '';
        }}
      />
      <button className="btn btn-outline" onClick={() => input.current?.click()} disabled={busy}>
        <i className="fa-solid fa-file-arrow-up" /> {file ? 'Choose a different file' : 'Choose a backup file'}
      </button>

      {inspection && (
        <>
          <div style={{ marginTop: 16, fontSize: 12, lineHeight: 1.7 }}>
            <strong>{file?.name}</strong> — taken {ago(inspection.generated_at)} by{' '}
            {inspection.taken_by ?? 'unknown'}, {(inspection.total_rows ?? 0).toLocaleString()} rows.
          </div>

          {inspection.missing_tables.length > 0 && (
            <div style={{ marginTop: 10, fontSize: 12, color: 'var(--danger)' }}>
              These tables are in the file but no longer exist in the database and will be skipped:{' '}
              {inspection.missing_tables.join(', ')}
            </div>
          )}
          {inspection.tables_not_in_file.length > 0 && (
            <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text2)' }}>
              These tables exist now but are not in the file, so they will be left exactly as they
              are: {inspection.tables_not_in_file.join(', ')}
            </div>
          )}

          <div className="table-wrap" style={{ marginTop: 14, maxHeight: 320, overflowY: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Table</th>
                  <th style={{ textAlign: 'right' }}>Rows now</th>
                  <th style={{ textAlign: 'right' }}>Rows in file</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {inspection.tables.map((t) => (
                  <tr key={t.table}>
                    <td style={{ fontSize: 12 }}>{t.table}</td>
                    <td style={{ textAlign: 'right', fontSize: 12 }}>{t.current_rows.toLocaleString()}</td>
                    <td style={{ textAlign: 'right', fontSize: 12 }}>{t.incoming_rows.toLocaleString()}</td>
                    <td style={{ fontSize: 11 }}>
                      {!t.exists && <span className="badge badge-fail">missing</span>}
                      {t.protected && <span className="badge badge-pending">never cleared</span>}
                      {t.no_primary_key && <span className="badge badge-inactive">no key — inserts only</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="form-row cols2" style={{ marginTop: 16 }}>
            <div className="form-group">
              <label>How</label>
              <select
                className="form-select"
                value={strategy}
                onChange={(e) => setStrategy(e.target.value as RestoreStrategy)}
                disabled={busy}
              >
                <option value="merge">Merge — add and overwrite matching rows, keep the rest</option>
                <option value="replace">Replace — empty each table first, then load the file</option>
              </select>
              <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 6, lineHeight: 1.6 }}>
                {strategy === 'merge'
                  ? 'Safe for putting back records that were deleted by mistake. Rows added since the backup survive.'
                  : 'Returns the database to exactly the state in the file. Anything entered since the backup was taken is lost.'}
              </div>
            </div>
            <div className="form-group">
              <label>Type {RESTORE_PHRASE} to confirm</label>
              <input
                className="form-input"
                value={phrase}
                onChange={(e) => setPhrase(e.target.value)}
                placeholder={RESTORE_PHRASE}
                disabled={busy}
              />
            </div>
          </div>

          <button
            className="btn btn-danger"
            onClick={() => void go()}
            disabled={!unlocked}
            title={unlocked ? '' : `Type ${RESTORE_PHRASE} to enable`}
          >
            <i className={busy ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-rotate-left'} />
            {busy ? 'Restoring…' : `Restore (${strategy})`}
          </button>

          {progress && (
            <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text2)' }}>{progress}</div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Tab 4: history ───────────────────────────────────────────────────────────

const KIND_LABEL: Record<string, string> = {
  usb: 'USB / local',
  cloud: 'Google Drive',
  files: 'Google Drive (files)',
  restore_test: 'Restore test',
};

function HistoryTab({ runs, loading }: { runs: BackupRunRow[]; loading: boolean }) {
  if (loading) return <div className="card" style={{ fontSize: 12 }}>Loading…</div>;
  if (!runs.length) {
    return (
      <div className="card" style={{ fontSize: 12, color: 'var(--text2)' }}>
        Nothing recorded yet. Take a backup on the first tab, or wait for tonight's cloud run.
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-title">
        Every backup attempt
        <span style={{ fontWeight: 400, fontSize: 11, color: 'var(--text2)' }}>
          A row stuck on “running” means a backup started and never finished.
        </span>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Kind</th>
              <th>Status</th>
              <th>File</th>
              <th style={{ textAlign: 'right' }}>Rows</th>
              <th style={{ textAlign: 'right' }}>Size</th>
              <th>By</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id}>
                <td style={{ fontSize: 11.5, whiteSpace: 'nowrap' }}>
                  {new Date(r.started_at).toLocaleString()}
                </td>
                <td style={{ fontSize: 12 }}>{KIND_LABEL[r.kind] ?? r.kind}</td>
                <td>
                  <span
                    className={`badge ${
                      r.status === 'success' ? 'badge-active'
                      : r.status === 'failed' ? 'badge-fail'
                      : 'badge-pending'
                    }`}
                  >
                    {r.status}
                  </span>
                </td>
                <td
                  style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}
                  title={r.checksum ?? ''}
                >
                  {r.artifact ?? '—'}
                </td>
                <td style={{ textAlign: 'right', fontSize: 12 }}>
                  {r.row_count === null ? '—' : r.row_count.toLocaleString()}
                </td>
                <td style={{ textAlign: 'right', fontSize: 12 }}>{formatBytes(r.size_bytes)}</td>
                <td style={{ fontSize: 11.5 }}>{r.actor_label ?? '—'}</td>
                <td style={{ fontSize: 11, color: r.status === 'failed' ? 'var(--danger)' : 'var(--text2)' }}>
                  {r.message ?? r.destination ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
