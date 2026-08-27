/**
 * Tests for the Nightly tab's reasoning.
 *
 * These functions decide what an administrator is told about the state of the
 * backups, and every wrong answer is quiet. The case this file exists for is
 * the one the page used to get wrong: a backup that succeeded and reached
 * Google Drive, but was too large to mirror into Supabase Storage, was reported
 * as no backup at all. Nothing crashed and no error was logged — the page
 * simply told the operator something untrue about whether the school's data was
 * safe, which is the only failure mode this whole feature exists to prevent.
 *
 * So: `never_configured` must never be confused with `failing`, a stalled run
 * must not read as a healthy one, and the metadata readers must survive a run
 * recorded by an older version of the script that knew none of these fields.
 */

import { describe, it, expect } from 'vitest';
import {
  bucketsFromRun,
  classifyNightly,
  driveStateFromRun,
  mirrorStateFromRun,
  nextScheduledRunUtc,
  nextWeeklyRunUtc,
  type BackupRunRow,
} from '@/lib/backup';

const HOUR = 3_600_000;

/** A run row with only the fields these functions look at. */
function run(over: Partial<BackupRunRow> & { started_at: string }): BackupRunRow {
  return {
    id: over.id ?? `id-${over.started_at}`,
    finished_at: null,
    kind: 'cloud',
    status: 'success',
    artifact: null,
    destination: null,
    storage_path: null,
    size_bytes: null,
    table_count: null,
    row_count: null,
    checksum: null,
    actor_label: null,
    message: null,
    metadata: null,
    ...over,
  } as BackupRunRow;
}

const agoHours = (h: number) => new Date(Date.now() - h * HOUR).toISOString();

// ─── classifyNightly ──────────────────────────────────────────────────────────

describe('classifyNightly', () => {
  it('reports never_configured when no run of that kind has ever happened', () => {
    expect(classifyNightly([], 'cloud').state).toBe('never_configured');
  });

  it('does not mistake another kind of run for its own', () => {
    // A USB backup this morning says nothing about the nightly cloud job. This
    // is the real state of a project where someone has used the first tab but
    // never set up the workflow.
    const usb = run({ kind: 'usb', started_at: agoHours(2) });
    expect(classifyNightly([usb], 'cloud').state).toBe('never_configured');
    expect(classifyNightly([usb], 'files').state).toBe('never_configured');
  });

  it('is healthy after a recent success', () => {
    const r = classifyNightly([run({ started_at: agoHours(5) })], 'cloud');
    expect(r.state).toBe('healthy');
    expect(r.run?.started_at).toBeTruthy();
  });

  it('is stale once the newest success is older than the threshold', () => {
    expect(classifyNightly([run({ started_at: agoHours(40) })], 'cloud').state).toBe('stale');
    // 36 hours is the default: a 02:00 job has not missed a night by 09:00.
    expect(classifyNightly([run({ started_at: agoHours(30) })], 'cloud').state).toBe('healthy');
  });

  it('honours a caller-supplied staleness threshold', () => {
    // The weekly files backup is not late at 40 hours.
    expect(classifyNightly([run({ kind: 'files', started_at: agoHours(40) })], 'files', 24 * 8).state)
      .toBe('healthy');
  });

  it('reports failing when the most recent run failed', () => {
    const rows = [
      run({ started_at: agoHours(1), status: 'failed', message: 'pg_dump: connection refused' }),
      run({ started_at: agoHours(25), status: 'success' }),
    ];
    const r = classifyNightly(rows, 'cloud');
    expect(r.state).toBe('failing');
    expect(r.run?.message).toBe('pg_dump: connection refused');
  });

  it('judges by the newest run, whatever order the rows arrive in', () => {
    const rows = [
      run({ id: 'old', started_at: agoHours(30), status: 'failed' }),
      run({ id: 'new', started_at: agoHours(2), status: 'success' }),
    ];
    expect(classifyNightly(rows, 'cloud').run?.id).toBe('new');
    expect(classifyNightly([...rows].reverse(), 'cloud').run?.id).toBe('new');
  });

  it('separates a run in progress from one that died mid-run', () => {
    // Still plausible.
    expect(classifyNightly([run({ started_at: agoHours(0.2), status: 'running' })], 'cloud').state)
      .toBe('running');
    // Started yesterday and never reported: the runner was killed. This must
    // not read as success, and must not read as "nothing has ever run".
    expect(classifyNightly([run({ started_at: agoHours(26), status: 'running' })], 'cloud').state)
      .toBe('stalled');
  });
});

// ─── Schedules ────────────────────────────────────────────────────────────────

describe('nextScheduledRunUtc', () => {
  it('gives today 02:15 UTC when it is still ahead', () => {
    const next = nextScheduledRunUtc(new Date('2026-08-27T01:00:00Z'));
    expect(next.toISOString()).toBe('2026-08-27T02:15:00.000Z');
  });

  it('rolls to tomorrow once the time has passed', () => {
    const next = nextScheduledRunUtc(new Date('2026-08-27T02:16:00Z'));
    expect(next.toISOString()).toBe('2026-08-28T02:15:00.000Z');
  });

  it('rolls at the exact minute rather than returning a run already under way', () => {
    const next = nextScheduledRunUtc(new Date('2026-08-27T02:15:00Z'));
    expect(next.toISOString()).toBe('2026-08-28T02:15:00.000Z');
  });

  it('crosses a month boundary', () => {
    const next = nextScheduledRunUtc(new Date('2026-08-31T23:59:00Z'));
    expect(next.toISOString()).toBe('2026-09-01T02:15:00.000Z');
  });

  it('crosses a year boundary', () => {
    const next = nextScheduledRunUtc(new Date('2026-12-31T12:00:00Z'));
    expect(next.toISOString()).toBe('2027-01-01T02:15:00.000Z');
  });
});

describe('nextWeeklyRunUtc', () => {
  it('lands on a Sunday at 02:45 UTC', () => {
    // 2026-08-27 is a Thursday.
    const next = nextWeeklyRunUtc(new Date('2026-08-27T12:00:00Z'));
    expect(next.getUTCDay()).toBe(0);
    expect(next.toISOString()).toBe('2026-08-30T02:45:00.000Z');
  });

  it('gives today when it is Sunday morning and the time is still ahead', () => {
    const next = nextWeeklyRunUtc(new Date('2026-08-30T01:00:00Z'));
    expect(next.toISOString()).toBe('2026-08-30T02:45:00.000Z');
  });

  it('skips a whole week when Sunday`s run has already gone', () => {
    const next = nextWeeklyRunUtc(new Date('2026-08-30T03:00:00Z'));
    expect(next.toISOString()).toBe('2026-09-06T02:45:00.000Z');
  });
});

// ─── Metadata readers ─────────────────────────────────────────────────────────
//
// The runner is deployed separately from this bundle, so what arrives may be
// older, newer, or truncated. None of that may produce a crash on a page whose
// job is to be readable during an emergency.

describe('driveStateFromRun', () => {
  it('returns null for a run recorded before this feature existed', () => {
    expect(driveStateFromRun(run({ started_at: agoHours(1) }))).toBeNull();
    expect(driveStateFromRun(null)).toBeNull();
  });

  it('returns null rather than throwing on nonsense', () => {
    expect(driveStateFromRun(run({ started_at: agoHours(1), metadata: { drive: 'yes' } as never }))).toBeNull();
    expect(driveStateFromRun(run({ started_at: agoHours(1), metadata: { drive: [] } as never }))).toBeNull();
  });

  it('reads a full listing', () => {
    const d = driveStateFromRun(run({
      started_at: agoHours(1),
      metadata: {
        drive: {
          remote: 'gdrive:BoswaLMS-Backups',
          folder_url: 'https://drive.google.com/drive/folders/abc',
          listed_at: '2026-08-27T02:20:00Z',
          daily: {
            files: [{ name: 'boswa-db-2026-08-27.dump', size: 1024, mod: '2026-08-27T02:18:00Z', id: 'x1' }],
            count: 30,
            bytes: 30720,
            truncated: true,
          },
          monthly: { files: [], count: 0, bytes: 0, truncated: false },
        },
      },
    }));
    expect(d?.remote).toBe('gdrive:BoswaLMS-Backups');
    expect(d?.daily?.count).toBe(30);
    expect(d?.daily?.truncated).toBe(true);
    expect(d?.daily?.files[0].id).toBe('x1');
    expect(d?.monthly?.count).toBe(0);
    expect(d?.error).toBeNull();
  });

  it('drops malformed file entries instead of rendering blanks', () => {
    const d = driveStateFromRun(run({
      started_at: agoHours(1),
      metadata: { drive: { remote: 'g:', daily: { files: [{ size: 1 }, { name: 'ok.dump' }, null] } } },
    }));
    expect(d?.daily?.files).toHaveLength(1);
    expect(d?.daily?.files[0]).toEqual({ name: 'ok.dump', size: 0, mod: '' });
    // No id key at all when rclone reported none — not `id: undefined`.
    expect('id' in d!.daily!.files[0]).toBe(false);
  });

  it('carries a listing error through', () => {
    const d = driveStateFromRun(run({
      started_at: agoHours(1),
      metadata: { drive: { error: 'rclone: directory not found' } },
    }));
    expect(d?.error).toBe('rclone: directory not found');
    expect(d?.daily).toBeNull();
  });
});

describe('mirrorStateFromRun', () => {
  it('reports why a dump was not mirrored', () => {
    // The case that used to render as "No dumps here yet" while the backup sat
    // safely in Google Drive.
    const m = mirrorStateFromRun(run({
      started_at: agoHours(1),
      metadata: { mirror: { mirrored: false, max_mb: 45, size_mb: 62.4, reason: '62.4 MB exceeds the 45 MB limit' } },
    }));
    expect(m?.mirrored).toBe(false);
    expect(m?.size_mb).toBeCloseTo(62.4);
    expect(m?.reason).toContain('45 MB limit');
  });

  it('returns null for runs that predate the field', () => {
    expect(mirrorStateFromRun(run({ started_at: agoHours(1) }))).toBeNull();
  });

  it('treats a missing `mirrored` flag as not mirrored', () => {
    expect(mirrorStateFromRun(run({ started_at: agoHours(1), metadata: { mirror: {} } }))?.mirrored)
      .toBe(false);
  });
});

describe('bucketsFromRun', () => {
  it('reads per-bucket totals', () => {
    const b = bucketsFromRun(run({
      started_at: agoHours(1),
      kind: 'files',
      metadata: {
        buckets: [
          { name: 'student-photos', objects: 412, bytes: 51_200_000 },
          { name: 'timetables', objects: 0, bytes: 0, skipped: 'listed empty — not synced' },
        ],
      },
    }));
    expect(b).toHaveLength(2);
    expect(b[0].objects).toBe(412);
    expect(b[1].skipped).toBe('listed empty — not synced');
  });

  it('returns [] for anything that is not a list of named buckets', () => {
    expect(bucketsFromRun(run({ started_at: agoHours(1) }))).toEqual([]);
    expect(bucketsFromRun(run({ started_at: agoHours(1), metadata: { buckets: 'all' } as never }))).toEqual([]);
    expect(bucketsFromRun(run({ started_at: agoHours(1), metadata: { buckets: [{ objects: 3 }] } }))).toEqual([]);
  });
});
