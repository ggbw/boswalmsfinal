/**
 * Backup & restore — the browser half.
 *
 * Three jobs live here, and one idea connects them: a backup is only real once
 * it has been read back. So every function that writes a file also knows how
 * to verify one, and the page offers verification as a first-class action
 * rather than a debugging aid.
 *
 *   saveBackupToUsb()    stream the database straight onto a USB stick
 *   verifyBackupFile()   read a file back and prove it is complete
 *   restoreFromFile()    put it back, in dependency order, in batches
 *
 * WHY STREAMING, EVERYWHERE
 *
 * The naive version of this feature — download a JSON blob, hand it to the
 * user — holds the entire database in the tab's memory twice: once as the
 * response and once as the Blob. It works on a small school and dies on a
 * large one, on the day it is needed. Nothing here ever holds more than one
 * chunk: the response streams out of the edge function, through gzip, through
 * the hash, and onto the stick.
 *
 * THE FILE
 *
 *   boswa-backup-2026-08-24-1830.ndjson.gz
 *
 * gzip of newline-delimited JSON: a manifest line, then batches of rows, then
 * an `end` line. Any archiver opens it; `zcat file | head -1` shows what is
 * inside without decompressing the rest. The `end` line is the completeness
 * proof — a file without one was interrupted, and verifyBackupFile() says so.
 *
 * BROWSER SUPPORT
 *
 * Writing directly to a chosen folder needs showSaveFilePicker(), which is
 * Chrome and Edge only. Firefox and Safari fall back to an ordinary download
 * into the Downloads folder, which the user then copies to the stick by hand —
 * correct, one step longer, and buffered in memory. The page says which of the
 * two it is about to do before it starts, because "click once and it is on the
 * stick" is the whole feature and it should not silently become something else.
 */

import { supabase } from '@/integrations/supabase/client';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from '@/integrations/supabase/env';
import { auditDb as looseDb, logAudit } from '@/lib/audit';
import { invokeFn } from '@/lib/invokeFn';
import { Sha256 } from '@/lib/sha256';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ManifestTable {
  name: string;
  rows: number;
  depth: number;
  pk: string[];
}

export interface BackupManifest {
  kind: 'manifest';
  version: number;
  generated_at: string;
  project_ref: string;
  run_id: string | null;
  taken_by: string;
  total_rows: number;
  skipped: string[];
  tables: ManifestTable[];
}

export interface BackupProgress {
  /** 'Reading students…', 'Writing to disk…' */
  phase: string;
  table?: string;
  rowsDone: number;
  rowsExpected: number;
  bytesWritten: number;
}

export interface BackupResult {
  filename: string;
  bytes: number;
  rows: number;
  tables: number;
  checksum: string;
  /** False when the browser could not write directly and the file went to
   *  Downloads instead — the UI turns this into a "now copy it" instruction. */
  wroteDirectly: boolean;
  manifest: BackupManifest;
}

export interface VerifyResult {
  ok: boolean;
  filename: string;
  bytes: number;
  checksum: string;
  manifest: BackupManifest | null;
  rowsCounted: number;
  /** Tables whose actual row count differs from the manifest's. */
  mismatches: { table: string; expected: number; found: number }[];
  problems: string[];
}

export interface BackupRunRow {
  id: string;
  started_at: string;
  finished_at: string | null;
  kind: string;
  status: string;
  artifact: string | null;
  destination: string | null;
  storage_path: string | null;
  size_bytes: number | null;
  table_count: number | null;
  row_count: number | null;
  checksum: string | null;
  actor_label: string | null;
  message: string | null;
  /**
   * Whatever the runner chose to record about the run — see `metadata` in
   * scripts/vps/db-backup.mjs. This has always been selected (the queries use
   * `select('*')`); the type simply did not admit it, so the Drive listing and
   * the mirror's reason for skipping were arriving and being thrown away.
   *
   * Written outside this app, by a script that is deployed separately and may
   * be older than the browser reading it. Every consumer must treat the shape
   * as unknown, which is why the readers below narrow it by hand rather than
   * asserting a type onto it.
   */
  metadata: Record<string, unknown> | null;
}

export interface BackupHealth {
  last_cloud_success: string | null;
  last_cloud_failure: string | null;
  last_usb_success: string | null;
  last_verified_restore: string | null;
  cloud_failures_7d: number;
}

/** The bucket the VPS mirrors each nightly pg_dump into. Private; read through
 *  a signed URL only, and only by an admin (see the migration's RLS policy). */
export const NIGHTLY_BUCKET = 'db-backups';

/**
 * Left out of a one-click backup by default.
 *
 * The audit trail is usually the largest thing in the database and the least
 * useful in a recovery: it records what people did, not what the school knows.
 * Including it can turn a 30-second backup into a five-minute one, which is
 * how a "click this before you go home" habit dies. The page exposes this as a
 * checkbox, off by default, and the manifest records what was skipped so a
 * restore is never quietly missing something nobody was told about.
 */
export const BULKY_TABLES = ['audit_logs', 'user_sessions'];

// ─── Capability probe ─────────────────────────────────────────────────────────

interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: { description: string; accept: Record<string, string[]> }[];
}
interface FileSystemFileHandleLike {
  createWritable(): Promise<{
    write(data: BufferSource | Blob): Promise<void>;
    close(): Promise<void>;
    abort?(): Promise<void>;
  }>;
}
type PickerWindow = Window & {
  showSaveFilePicker?: (o?: SaveFilePickerOptions) => Promise<FileSystemFileHandleLike>;
};

/** True when the browser can write to a folder the user picks — i.e. straight
 *  to the USB stick. Chrome and Edge; not Firefox, not Safari, and not any
 *  browser in a cross-origin iframe. */
export function canWriteDirectly(): boolean {
  return typeof (window as PickerWindow).showSaveFilePicker === 'function';
}

/** True when the browser can gzip a stream. Everything since 2023 can; a
 *  browser that cannot gets an uncompressed .ndjson instead of an error. */
function canCompress(): boolean {
  return typeof CompressionStream !== 'undefined';
}

export function backupFilename(compressed: boolean): string {
  const t = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}-${p(t.getHours())}${p(t.getMinutes())}`;
  return `boswa-backup-${stamp}.ndjson${compressed ? '.gz' : ''}`;
}

export function formatBytes(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

/** Re-added after each line, because ndjsonLines() strips the separator. */
const NEWLINE = new TextEncoder().encode('\n');

// ─── Line scanning ────────────────────────────────────────────────────────────

/**
 * Read the head of an NDJSON line without parsing the whole thing.
 *
 * A `rows` line can be a megabyte of student records. The only things the
 * progress display needs from it are the table name and the batch size, and
 * the edge function puts both in the first hundred bytes for exactly this
 * reason. JSON.parse-ing every line to learn a number that is already sitting
 * in plain sight would roughly double the cost of taking a backup.
 */
const HEAD_RE = /^\{"kind":"(\w+)"(?:,"table":"([^"]+)","n":(\d+))?/;

interface LineHead { kind: string; table?: string; n?: number }

function peekLine(bytes: Uint8Array, decoder: TextDecoder): LineHead | null {
  const head = decoder.decode(bytes.subarray(0, Math.min(bytes.length, 200)));
  const m = HEAD_RE.exec(head);
  if (!m) return null;
  return { kind: m[1], table: m[2], n: m[3] ? Number(m[3]) : undefined };
}

/**
 * Split a byte stream into lines without ever decoding a whole line.
 *
 * Yields byte ranges. The caller decides what to decode: the first 200 bytes
 * for progress, or the entire line when it is small enough to matter (the
 * manifest, the trailer).
 */
async function* ndjsonLines(
  stream: ReadableStream<Uint8Array>,
  onChunk?: (chunk: Uint8Array) => void,
): AsyncGenerator<Uint8Array> {
  const reader = stream.getReader();
  let carry = new Uint8Array(0);

  // try/finally, because a caller that only wants the first line (readManifest)
  // abandons this generator mid-stream. Without the cancel, the reader stays
  // locked to the stream and the rest of a large file is read for nothing.
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      onChunk?.(value);

      // Join whatever was left over with the new chunk, then peel off every
      // complete line. Only the tail — at most one partial line — is carried.
      const merged = new Uint8Array(carry.length + value.length);
      merged.set(carry, 0);
      merged.set(value, carry.length);

      let start = 0;
      for (let i = 0; i < merged.length; i++) {
        if (merged[i] === 0x0a) {
          if (i > start) yield merged.subarray(start, i);
          start = i + 1;
        }
      }
      carry = merged.subarray(start);
    }

    if (carry.length) yield carry;   // a final line with no trailing newline
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

// ─── 1. Take a backup ─────────────────────────────────────────────────────────

export interface SaveBackupOptions {
  /** Tables to leave out. Defaults to BULKY_TABLES; pass [] to include them. */
  skip?: string[];
  onProgress?: (p: BackupProgress) => void;
  /** Lets the page's Cancel button stop a long backup mid-stream. */
  signal?: AbortSignal;
}

export async function saveBackupToUsb(opts: SaveBackupOptions = {}): Promise<BackupResult> {
  const skip = opts.skip ?? BULKY_TABLES;
  const report = (p: Partial<BackupProgress>) =>
    opts.onProgress?.({ phase: '', rowsDone: 0, rowsExpected: 0, bytesWritten: 0, ...p } as BackupProgress);

  // ── Choose the destination FIRST ─────────────────────────────────────────
  // The file picker must be opened from the click that started this, before
  // any await: browsers refuse a picker that appears after a network round
  // trip, treating it as a pop-up. Asking first also means a user who changes
  // their mind cancels before the database is read rather than after.
  const compressed = canCompress();
  const filename = backupFilename(compressed);

  let handle: FileSystemFileHandleLike | null = null;
  const picker = (window as PickerWindow).showSaveFilePicker;
  if (picker) {
    handle = await picker({
      suggestedName: filename,
      types: [{
        description: 'Boswa database backup',
        accept: { 'application/gzip': ['.gz'], 'application/x-ndjson': ['.ndjson'] },
      }],
    });
  }

  report({ phase: 'Asking the server for a snapshot…' });

  // ── Open the stream ──────────────────────────────────────────────────────
  // Raw fetch rather than supabase.functions.invoke(): invoke() buffers the
  // whole response before handing it over, which is the one thing this must
  // not do.
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) throw new Error('Your session has expired. Sign in again and retry.');

  let response: Response;
  try {
    response = await fetch(`${SUPABASE_URL}/functions/v1/db-backup`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey: SUPABASE_PUBLISHABLE_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ skip }),
      signal: opts.signal,
    });
  } catch (e) {
    // An undeployed function reaches the browser as a CORS failure, not a 404.
    //
    // Supabase's gateway answers an unknown function slug with 404 — but its
    // preflight reply allows only `authorization, x-client-info, apikey`, and
    // this request sends `content-type` as well. The browser therefore rejects
    // the preflight before the 404 body is ever readable, and fetch() rejects
    // with a bare TypeError: "Failed to fetch". Chrome's console calls it a
    // CORS error, which sends people looking for a header problem in a
    // function that is not there to have headers.
    //
    // A genuine abort must still read as an abort, so it is re-thrown first.
    if ((e as Error).name === 'AbortError') throw e;
    throw new Error(
      'The db-backup function could not be reached — it is almost certainly not deployed. ' +
      'Run: npx supabase functions deploy db-backup --project-ref ' +
      SUPABASE_URL.replace(/^https:\/\/([^.]+).*$/, '$1') +
      ' (the browser reports this as a CORS error; see docs/BACKUP_INSTALL.md §4.5)',
    );
  }

  if (!response.ok || !response.body) {
    // Reachable from a non-browser caller, or once the preflight passes.
    let message = response.status === 404
      ? 'The db-backup function is not deployed. Run: npx supabase functions deploy db-backup'
      : `The backup service returned ${response.status}.`;
    try {
      const body = await response.json();
      if (body?.error) message = String(body.error);
    } catch { /* not JSON — keep the status message */ }
    throw new Error(message);
  }

  const runId = response.headers.get('x-backup-run-id') || null;
  const rowsExpected = Number(response.headers.get('x-backup-expected-rows') ?? 0);

  // ── Wire up the pipeline ─────────────────────────────────────────────────
  // plaintext → [tap: count rows] → gzip → [hash + write]
  //
  // The tap sits before compression because that is where the line structure
  // is; the hash sits after it because the hash must describe the bytes that
  // land on the stick, so that `sha256sum` on any other machine agrees.
  const decoder = new TextDecoder();
  let manifest: BackupManifest | null = null;
  let rowsDone = 0;
  let sawEnd = false;
  let streamError: string | null = null;
  let bytesWritten = 0;

  const tapped = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const line of ndjsonLines(response.body!)) {
          const head = peekLine(line, decoder);
          if (head?.kind === 'rows') {
            rowsDone += head.n ?? 0;
            report({
              phase: `Reading ${head.table}…`,
              table: head.table,
              rowsDone,
              rowsExpected,
              bytesWritten,
            });
          } else if (head?.kind === 'manifest') {
            manifest = JSON.parse(decoder.decode(line)) as BackupManifest;
          } else if (head?.kind === 'end') {
            sawEnd = true;
          } else if (head?.kind === 'error') {
            streamError = (JSON.parse(decoder.decode(line)) as { message: string }).message;
          }
          controller.enqueue(line);
          controller.enqueue(NEWLINE);
        }
        controller.close();
      } catch (e) {
        controller.error(e);
      }
    },
  });

  const byteStream = compressed
    ? tapped.pipeThrough(new CompressionStream('gzip') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>)
    : tapped;

  // ── Drain it onto disk ───────────────────────────────────────────────────
  const hasher = new Sha256();
  const writable = handle ? await handle.createWritable() : null;
  const fallbackChunks: Uint8Array[] = [];

  const reader = byteStream.getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      hasher.update(value);
      bytesWritten += value.length;
      if (writable) await writable.write(value as unknown as BufferSource);
      else fallbackChunks.push(value);
      report({ phase: 'Writing…', rowsDone, rowsExpected, bytesWritten });
    }
    if (writable) await writable.close();
  } catch (e) {
    await writable?.abort?.();
    throw e;
  }

  // ── Did we get a whole one? ──────────────────────────────────────────────
  if (streamError) throw new Error(`The server stopped mid-backup: ${streamError}`);
  if (!manifest) throw new Error('The backup had no manifest — nothing usable was written.');
  if (!sawEnd) {
    throw new Error(
      'The backup ended early and is incomplete. The file on disk should be deleted and the backup retried.',
    );
  }

  const checksum = hasher.hex();

  if (!writable) {
    // No file picker: hand it over as a download. This is the one path that
    // holds the whole backup in memory, and the only one available on Firefox
    // and Safari.
    const blob = new Blob(fallbackChunks as BlobPart[], {
      type: compressed ? 'application/gzip' : 'application/x-ndjson',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ── Close the history row ────────────────────────────────────────────────
  // Only now. The row opened by the edge function said "a backup started"; it
  // becomes 'success' at the moment the bytes are on disk and counted, which
  // is the only defensible definition.
  await recordRun({
    id: runId,
    kind: 'usb',
    status: 'success',
    artifact: filename,
    destination: writable ? 'USB / chosen folder' : 'Browser downloads folder',
    size_bytes: bytesWritten,
    table_count: manifest.tables.length,
    row_count: rowsDone,
    checksum,
    message: skip.length ? `Skipped: ${skip.join(', ')}` : null,
  });

  void logAudit({
    action: 'database_backup',
    category: 'admin',
    entityType: 'database',
    entityLabel: filename,
    summary: `Backed up ${rowsDone} rows from ${manifest.tables.length} tables to ${filename}`,
    metadata: { checksum, bytes: bytesWritten, skipped: skip },
    severity: 'warning',
  });

  return {
    filename,
    bytes: bytesWritten,
    rows: rowsDone,
    tables: manifest.tables.length,
    checksum,
    wroteDirectly: !!writable,
    manifest,
  };
}

// ─── 2. Verify a backup ───────────────────────────────────────────────────────

/**
 * Read a backup file back and prove it is what it claims to be.
 *
 * This is the step that turns a file into a backup. It re-reads from the stick
 * — so a stick that silently failed to write is caught here and not in six
 * months — decompresses, counts the rows of every table, and compares them
 * with the manifest the file carries. It also reports the SHA-256 of the file
 * as it sits on disk, which can be checked against the number recorded in the
 * backup history from any other machine.
 */
export async function verifyBackupFile(
  file: File,
  onProgress?: (rows: number) => void,
): Promise<VerifyResult> {
  const problems: string[] = [];
  const perTable = new Map<string, number>();
  let manifest: BackupManifest | null = null;
  let sawEnd = false;
  let rowsCounted = 0;

  // Hash the file as it is: the compressed bytes, unmodified. Hashing what
  // comes out of the decompressor would produce a number nothing else agrees
  // with.
  const hasher = new Sha256();
  const decoder = new TextDecoder();

  const raw = file.stream() as unknown as ReadableStream<Uint8Array>;

  // Two passes would mean reading the file twice; instead the hash is fed from
  // a tap on the raw stream while the same stream is being decompressed.
  const [forHash, forRead] = raw.tee();
  const hashDone = (async () => {
    const r = forHash.getReader();
    for (;;) {
      const { value, done } = await r.read();
      if (done) break;
      if (value) hasher.update(value);
    }
  })();

  const looksCompressed = /\.gz$/i.test(file.name);
  let plain: ReadableStream<Uint8Array>;
  try {
    plain = looksCompressed && typeof DecompressionStream !== 'undefined'
      ? forRead.pipeThrough(new DecompressionStream('gzip') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>)
      : forRead;
  } catch {
    problems.push('This browser cannot decompress .gz files.');
    await hashDone;
    return {
      ok: false, filename: file.name, bytes: file.size, checksum: hasher.hex(),
      manifest: null, rowsCounted: 0, mismatches: [], problems,
    };
  }

  try {
    for await (const line of ndjsonLines(plain)) {
      const head = peekLine(line, decoder);
      if (!head) { problems.push('A line in this file is not valid backup data.'); continue; }

      if (head.kind === 'manifest') {
        manifest = JSON.parse(decoder.decode(line)) as BackupManifest;
      } else if (head.kind === 'rows' && head.table) {
        const n = head.n ?? 0;
        perTable.set(head.table, (perTable.get(head.table) ?? 0) + n);
        rowsCounted += n;
        onProgress?.(rowsCounted);
      } else if (head.kind === 'end') {
        sawEnd = true;
      } else if (head.kind === 'error') {
        problems.push(`The server reported an error while writing this file: ${
          (JSON.parse(decoder.decode(line)) as { message: string }).message}`);
      }
    }
  } catch (e) {
    problems.push(`The file could not be read to the end: ${(e as Error).message}`);
  }

  await hashDone;

  if (!manifest) problems.push('No manifest — this is not a Boswa backup file.');
  if (!sawEnd) {
    problems.push(
      'The file has no completion marker: the backup was interrupted and this copy is incomplete.',
    );
  }

  const mismatches: VerifyResult['mismatches'] = [];
  for (const t of manifest?.tables ?? []) {
    const found = perTable.get(t.name) ?? 0;
    if (found !== t.rows) mismatches.push({ table: t.name, expected: t.rows, found });
  }

  return {
    ok: problems.length === 0 && mismatches.length === 0,
    filename: file.name,
    bytes: file.size,
    checksum: hasher.hex(),
    manifest,
    rowsCounted,
    mismatches,
    problems,
  };
}

// ─── 3. Restore ───────────────────────────────────────────────────────────────

export type RestoreStrategy = 'merge' | 'replace';

export interface RestoreInspection {
  ok: boolean;
  generated_at: string | null;
  taken_by: string | null;
  total_rows: number | null;
  tables: {
    table: string;
    exists: boolean;
    protected: boolean;
    incoming_rows: number;
    current_rows: number;
    no_primary_key: boolean;
  }[];
  missing_tables: string[];
  tables_not_in_file: string[];
}

/** db-restore explains its refusals in the response body — "Only a super
 *  administrator may restore", the constraint that stopped a batch — and
 *  invokeFn is the helper that surfaces those instead of the generic
 *  "non-2xx status code". Every restore step throws on failure so the caller
 *  can stop rather than press on with half a database. */
async function callRestore<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await invokeFn<T>('db-restore', body);
  if (error) throw new Error(error);
  return data as T;
}

/** Read just the manifest out of a backup file and ask the server what
 *  restoring it would do. Changes nothing. */
export async function inspectBackupFile(file: File): Promise<RestoreInspection> {
  const manifest = await readManifest(file);
  if (!manifest) throw new Error('This file has no manifest — it is not a Boswa backup.');
  return callRestore<RestoreInspection>({ mode: 'inspect', manifest });
}

async function readManifest(file: File): Promise<BackupManifest | null> {
  const raw = file.stream() as unknown as ReadableStream<Uint8Array>;
  const plain = /\.gz$/i.test(file.name) && typeof DecompressionStream !== 'undefined'
    ? raw.pipeThrough(new DecompressionStream('gzip') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>)
    : raw;
  const decoder = new TextDecoder();
  for await (const line of ndjsonLines(plain)) {
    const head = peekLine(line, decoder);
    // Returning here abandons the generator, whose finally block cancels the
    // underlying reader — so the rest of a large file is never read just to
    // learn what is in its first line.
    if (head?.kind === 'manifest') return JSON.parse(decoder.decode(line)) as BackupManifest;
    break;   // the manifest is line 1 or the file is not one of ours
  }
  return null;
}

export interface RestoreOptions {
  strategy: RestoreStrategy;
  /** Restore only these tables. Empty means every table in the file. */
  only?: string[];
  onProgress?: (p: { table: string; rowsDone: number; rowsExpected: number; phase: string }) => void;
}

export interface RestoreResult {
  tables: number;
  rows: number;
  droppedColumns: string[];
  cleared: Record<string, number>;
}

/**
 * Put a backup file back.
 *
 * Order matters twice over. Clearing runs deepest-dependency-first, so a
 * foreign key never points at a row that has just been deleted; inserting runs
 * shallowest-first, so a foreign key never points at a row that has not been
 * inserted yet. Both orders come from the depth the manifest records, which
 * came from the live FK graph at the time the backup was taken.
 *
 * Rows go up in the batches they came down in, and each batch is an upsert on
 * the primary key — so a restore interrupted halfway can simply be run again.
 */
export async function restoreFromFile(
  file: File,
  opts: RestoreOptions,
): Promise<RestoreResult> {
  const manifest = await readManifest(file);
  if (!manifest) throw new Error('This file has no manifest — it is not a Boswa backup.');

  const wanted = new Set(
    (opts.only?.length ? opts.only : manifest.tables.map((t) => t.name)),
  );
  const pkOf = new Map(manifest.tables.map((t) => [t.name, t.pk ?? []]));
  const rowsExpected = manifest.tables
    .filter((t) => wanted.has(t.name))
    .reduce((s, t) => s + t.rows, 0);

  let cleared: Record<string, number> = {};
  if (opts.strategy === 'replace') {
    const order = manifest.tables
      .filter((t) => wanted.has(t.name))
      .sort((a, b) => b.depth - a.depth)      // deepest first
      .map((t) => t.name);
    opts.onProgress?.({ table: '', rowsDone: 0, rowsExpected, phase: 'Emptying tables…' });
    const res = await callRestore<{ cleared: Record<string, number> }>({ mode: 'clear', tables: order });
    cleared = res.cleared ?? {};
  }

  // The file is in depth order already — the edge function wrote it that way —
  // so a single forward pass inserts parents before children.
  const raw = file.stream() as unknown as ReadableStream<Uint8Array>;
  const plain = /\.gz$/i.test(file.name) && typeof DecompressionStream !== 'undefined'
    ? raw.pipeThrough(new DecompressionStream('gzip') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>)
    : raw;

  const decoder = new TextDecoder();
  const dropped = new Set<string>();
  const touched = new Set<string>();
  let rowsDone = 0;

  for await (const line of ndjsonLines(plain)) {
    const head = peekLine(line, decoder);
    if (head?.kind !== 'rows' || !head.table || !wanted.has(head.table)) continue;

    const batch = JSON.parse(decoder.decode(line)) as { table: string; data: Record<string, unknown>[] };
    const res = await callRestore<{ written: number; dropped_columns: string[] }>({
      mode: 'apply',
      table: batch.table,
      rows: batch.data,
      pk: pkOf.get(batch.table) ?? [],
    });
    for (const c of res.dropped_columns ?? []) dropped.add(`${batch.table}.${c}`);
    touched.add(batch.table);
    rowsDone += res.written ?? 0;
    opts.onProgress?.({ table: batch.table, rowsDone, rowsExpected, phase: `Restoring ${batch.table}…` });
  }

  await callRestore({
    mode: 'finish',
    summary: {
      file: file.name,
      strategy: opts.strategy,
      tables: touched.size,
      rows: rowsDone,
      dropped_columns: [...dropped],
      backup_taken_at: manifest.generated_at,
    },
  });

  return { tables: touched.size, rows: rowsDone, droppedColumns: [...dropped], cleared };
}

// ─── 4. History, health, and the nightly mirror ───────────────────────────────

/**
 * Is this the migration not being applied?
 *
 * PostgREST does not say "run your migration". It says
 *
 *   PGRST205  Could not find the table 'public.backup_runs' in the schema cache
 *   PGRST202  Could not find the function public.backup_health …
 *
 * which reads, to anyone who has not met it before, like a bug in the app. It
 * also says the same thing for a minute or so *after* a successful migration,
 * because the API caches its picture of the schema. Recognising the shape here
 * lets the page say the one useful sentence instead of forwarding the riddle.
 */
function looksLikeMissingSchema(message: string | undefined | null): boolean {
  if (!message) return false;
  return /PGRST20[25]|schema cache|does not exist|could not find the (table|function)/i
    .test(message);
}

export interface BackupInstallState {
  installed: boolean;
  /** What was missing, for the setup panel to name. */
  detail: string | null;
}

/**
 * Cheapest possible probe: ask for one row of backup_runs.
 *
 * Called once when the page opens. Everything else on the page depends on the
 * migration being in place, so finding out first — and saying so plainly — is
 * better than four separate failures in four different corners of the screen.
 */
export async function checkBackupInstalled(): Promise<BackupInstallState> {
  const { error } = await looseDb.from('backup_runs').select('id').limit(1);
  if (!error) return { installed: true, detail: null };
  if (looksLikeMissingSchema(error.message)) {
    return { installed: false, detail: error.message };
  }
  // A different error — RLS, network, an expired token — is not a missing
  // migration and must not be reported as one.
  return { installed: true, detail: error.message };
}

/** History. Returns [] rather than throwing when the migration is absent —
 *  the page has already said why, and a second error toast adds nothing. */
export async function fetchBackupRuns(limit = 50): Promise<BackupRunRow[]> {
  const { data, error } = await looseDb
    .from('backup_runs')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(limit);
  if (error) {
    if (looksLikeMissingSchema(error.message)) return [];
    throw new Error(error.message);
  }
  return (data ?? []) as BackupRunRow[];
}

export async function fetchBackupHealth(): Promise<BackupHealth | null> {
  const { data, error } = await looseDb.rpc('backup_health');
  if (error) return null;
  // backup_health() returns '{}' to a caller who is not an admin. An empty
  // object would render as "never" across the whole banner, which is a
  // different and more alarming claim than "you cannot see this".
  if (!data || typeof data !== 'object' || Object.keys(data).length === 0) return null;
  return data as BackupHealth;
}

async function recordRun(args: {
  id: string | null;
  kind: string;
  status: string;
  artifact?: string | null;
  destination?: string | null;
  size_bytes?: number | null;
  table_count?: number | null;
  row_count?: number | null;
  checksum?: string | null;
  message?: string | null;
}): Promise<void> {
  try {
    await looseDb.rpc('record_backup_run', {
      p_id: args.id,
      p_kind: args.kind,
      p_status: args.status,
      p_artifact: args.artifact ?? null,
      p_destination: args.destination ?? null,
      p_size_bytes: args.size_bytes ?? null,
      p_table_count: args.table_count ?? null,
      p_row_count: args.row_count ?? null,
      p_checksum: args.checksum ?? null,
      p_message: args.message ?? null,
    });
  } catch {
    // History is a record of backups, not a precondition for them. A backup
    // that is safely on a stick must not be reported as failed because the
    // database it came from could not be written to.
  }
}

export interface NightlyDump {
  name: string;
  size: number;
  created_at: string;
}

/**
 * The pg_dump files the runner has mirrored into Supabase Storage.
 *
 * Returns the error rather than throwing it. The bucket and its RLS policy are
 * created inside a deliberately non-fatal block in the migration (see the
 * `DO $storage$ … EXCEPTION` comment there), so a project where everything else
 * installed correctly can still be missing this one bucket. When that happened,
 * a throw here toasted an error and took the whole tab down with it — including
 * the Google Drive half, which does not depend on this bucket at all.
 *
 * This mirror is a convenience copy, not the backup. Failing to list it is
 * worth saying on the page; it is not worth hiding the backup behind.
 */
export async function listNightlyDumps(): Promise<{ dumps: NightlyDump[]; error: string | null }> {
  const { data, error } = await supabase.storage
    .from(NIGHTLY_BUCKET)
    .list('', { limit: 100, sortBy: { column: 'created_at', order: 'desc' } });
  if (error) return { dumps: [], error: error.message };
  return {
    dumps: (data ?? [])
      .filter((o) => o.name && !o.name.startsWith('.'))
      .map((o) => ({
        name: o.name,
        size: (o.metadata as { size?: number } | null)?.size ?? 0,
        created_at: o.created_at ?? o.updated_at ?? '',
      })),
    error: null,
  };
}

/**
 * Save one nightly pg_dump onto the USB stick.
 *
 * This is the artifact that can rebuild the database from nothing — schema,
 * constraints, sequences and all — where the NDJSON snapshot needs the tables
 * to exist first. Worth taking home as well as the snapshot; see the doc's
 * table of which failure each one answers.
 */
export async function saveNightlyDumpToUsb(name: string): Promise<{ bytes: number; wroteDirectly: boolean }> {
  const picker = (window as PickerWindow).showSaveFilePicker;
  const handle = picker ? await picker({ suggestedName: name }) : null;

  const { data, error } = await supabase.storage.from(NIGHTLY_BUCKET).download(name);
  if (error || !data) throw new Error(error?.message ?? 'Could not download that dump.');

  if (handle) {
    const writable = await handle.createWritable();
    await writable.write(data);
    await writable.close();
  } else {
    const url = URL.createObjectURL(data);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  void logAudit({
    action: 'export',
    category: 'export',
    entityType: 'file',
    entityLabel: name,
    summary: `Copied nightly database dump ${name} to local storage`,
    severity: 'warning',
  });

  return { bytes: data.size, wroteDirectly: !!handle };
}

/** "3 hours ago", "2 days ago", "never". The freshness banner's whole job. */
export function ago(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return 'never';
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/** Hours since a timestamp, or Infinity for never — the banner's severity. */
export function hoursSince(iso: string | null | undefined): number {
  if (!iso) return Infinity;
  const h = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  return Number.isNaN(h) ? Infinity : h;
}

// ─── Nightly cloud backup: reading what the runner reported ───────────────────
//
// Everything below reads `backup_runs` rows written by scripts/vps/db-backup.mjs
// and scripts/vps/files-backup.mjs. The page used to work from the Storage
// mirror alone, which meant a backup that reached Google Drive but was too
// large to mirror rendered as "no dumps here yet" — the one claim the page must
// never make while a backup exists.
//
// The classifiers are pure so they can be tested without a database; see
// src/test/backupNightly.test.ts.

/** The kinds a machine writes, as opposed to `usb`, which a person clicks. */
export const MACHINE_KINDS = ['cloud', 'files'];

/**
 * The newest machine-written runs, whatever else is in the history.
 *
 * Deliberately separate from fetchBackupRuns(): that one feeds the History tab
 * and is ordered by time alone, so fifty USB backups in an afternoon would push
 * the only cloud row off the end of the limit and this tab would conclude the
 * nightly job had never run.
 */
export async function fetchLatestRuns(limit = 20): Promise<BackupRunRow[]> {
  const { data, error } = await looseDb
    .from('backup_runs')
    .select('*')
    .in('kind', MACHINE_KINDS)
    .order('started_at', { ascending: false })
    .limit(limit);
  if (error) {
    if (looksLikeMissingSchema(error.message)) return [];
    throw new Error(error.message);
  }
  return (data ?? []) as BackupRunRow[];
}

/** Workflows the backup-trigger function is willing to start. The function
 *  keeps its own allowlist — this one exists so a typo here is a compile-time
 *  problem rather than a 400 from GitHub. */
export type TriggerableWorkflow = 'db-backup' | 'db-files-backup' | 'db-restore-test';

export interface TriggerResult {
  workflow: string;
  repo: string;
  ref: string;
  /** When the fine-grained token expires, if GitHub told us. Worth surfacing:
   *  a PAT that lapses turns this button into a 401 with no other warning. */
  token_expires: string | null;
}

/**
 * Ask GitHub to run the backup workflow now.
 *
 * The work happens on a GitHub Actions runner, not in the browser and not on
 * this server, so all this does is post a workflow_dispatch. GitHub answers 204
 * with an empty body — there is no run id to return and nothing to await. The
 * caller finds out what happened by watching backup_runs for a row it has not
 * seen before; see the Nightly tab.
 *
 * Every failure mode here is a configuration problem with a specific fix, and
 * the edge function translates GitHub's misleading status codes into sentences
 * that name it. invokeFn is what carries those sentences back intact.
 */
export async function triggerBackupNow(
  workflow: TriggerableWorkflow = 'db-backup',
): Promise<TriggerResult> {
  const { data, error } = await invokeFn<TriggerResult>('backup-trigger', {
    action: 'dispatch',
    workflow,
  });
  if (error) throw new Error(error);

  void logAudit({
    action: 'backup_triggered',
    category: 'admin',
    entityType: 'database',
    entityLabel: workflow,
    summary: `Started the ${workflow} workflow by hand`,
    severity: 'warning',
  });

  return data as TriggerResult;
}

export type NightlyState =
  /** No run of this kind has ever been recorded — it was never set up. */
  | 'never_configured'
  /** Started recently and has not reported back yet. */
  | 'running'
  /** Started long ago and never reported back: the runner died mid-run. */
  | 'stalled'
  /** The most recent run reported failure. */
  | 'failing'
  /** The most recent run succeeded, but too long ago. */
  | 'stale'
  | 'healthy';

export interface NightlyStatus {
  state: NightlyState;
  /** The run the state was decided from, or null when there is none. */
  run: BackupRunRow | null;
}

/** A row that still says "running" after this long did not finish. The nightly
 *  dump takes a minute or two; an hour is generous enough never to call a slow
 *  runner dead, and short enough to have noticed by morning. */
const RUNNING_GRACE_HOURS = 1;

/**
 * What the Nightly tab should say, from the run history alone.
 *
 * The distinction that matters most is `never_configured` versus everything
 * else. "No backup has ever been taken" and "the backup is broken" call for
 * completely different actions from the reader, and this page used to show the
 * same sentence for both — and for the third case, where the backup is sitting
 * safely in Drive but was too big to mirror into Supabase Storage.
 */
export function classifyNightly(
  runs: BackupRunRow[],
  kind = 'cloud',
  staleAfterHours = 36,
): NightlyStatus {
  const mine = runs
    .filter((r) => r.kind === kind)
    .sort((a, b) => (a.started_at < b.started_at ? 1 : -1));

  const run = mine[0] ?? null;
  if (!run) return { state: 'never_configured', run: null };

  if (run.status === 'running') {
    return {
      state: hoursSince(run.started_at) > RUNNING_GRACE_HOURS ? 'stalled' : 'running',
      run,
    };
  }
  if (run.status === 'failed') return { state: 'failing', run };

  return {
    state: hoursSince(run.started_at) > staleAfterHours ? 'stale' : 'healthy',
    run,
  };
}

/**
 * When the nightly job is next due.
 *
 * Hard-coded to match the `cron:` line in .github/workflows/db-backup.yml — at
 * the time of writing `15 2 * * *`, i.e. 02:15 UTC. Changing one without the
 * other makes this page state a time the runner will not honour, so the two
 * cross-reference each other in both files.
 *
 * GitHub's scheduler is best-effort and routinely runs late, sometimes by more
 * than an hour. The page presents this as "due", never as "will happen at".
 */
export function nextScheduledRunUtc(from: Date = new Date(), utcHour = 2, utcMinute = 15): Date {
  const next = new Date(Date.UTC(
    from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), utcHour, utcMinute, 0, 0,
  ));
  if (next.getTime() <= from.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

/** As above, for the weekly files backup — `45 2 * * 0` (Sunday 02:45 UTC) in
 *  .github/workflows/db-files-backup.yml. */
export function nextWeeklyRunUtc(from: Date = new Date(), utcHour = 2, utcMinute = 45): Date {
  const next = nextScheduledRunUtc(from, utcHour, utcMinute);
  while (next.getUTCDay() !== 0) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

// ─── Run metadata ─────────────────────────────────────────────────────────────
//
// Written by scripts that are deployed separately from this bundle, so what
// arrives can be older or newer than the code reading it. Everything here
// narrows by hand and returns null rather than trusting a shape: a run recorded
// before this feature existed must render exactly as it always did, not crash.

export interface DriveFile {
  name: string;
  size: number;
  /** ISO timestamp, from rclone's ModTime. */
  mod: string;
  /** Google Drive file id, when rclone reported one. */
  id?: string;
}

export interface DriveFolder {
  files: DriveFile[];
  /** Files in the folder, which may exceed files.length — the runner caps the
   *  list it sends so one night's metadata cannot grow without bound. */
  count: number;
  bytes: number;
  truncated: boolean;
}

export interface DriveState {
  remote: string;
  folder_url: string | null;
  listed_at: string | null;
  daily: DriveFolder | null;
  monthly: DriveFolder | null;
  /** Set when the listing failed. The upload may well have succeeded — the
   *  runner never lets a listing error demote a good backup. */
  error: string | null;
}

/** Why the Supabase Storage mirror was, or was not, written. */
export interface MirrorState {
  mirrored: boolean;
  max_mb: number | null;
  size_mb: number | null;
  reason: string | null;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
function asString(v: unknown): string | null {
  return typeof v === 'string' && v ? v : null;
}
function asNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function readFolder(v: unknown): DriveFolder | null {
  const o = asRecord(v);
  if (!o) return null;
  const files = Array.isArray(o.files)
    ? o.files.flatMap((f): DriveFile[] => {
        const r = asRecord(f);
        const name = asString(r?.name);
        if (!name) return [];
        const id = asString(r?.id);
        return [{
          name,
          size: asNumber(r?.size) ?? 0,
          mod: asString(r?.mod) ?? '',
          ...(id ? { id } : {}),
        }];
      })
    : [];
  return {
    files,
    count: asNumber(o.count) ?? files.length,
    bytes: asNumber(o.bytes) ?? 0,
    truncated: o.truncated === true,
  };
}

/** What was in Google Drive when this run finished. A snapshot, not live —
 *  nothing re-reads Drive between runs, so the page must say when it was taken. */
export function driveStateFromRun(run: BackupRunRow | null): DriveState | null {
  const drive = asRecord(asRecord(run?.metadata)?.drive);
  if (!drive) return null;
  return {
    remote: asString(drive.remote) ?? '',
    folder_url: asString(drive.folder_url),
    listed_at: asString(drive.listed_at),
    daily: readFolder(drive.daily),
    monthly: readFolder(drive.monthly),
    error: asString(drive.error),
  };
}

export function mirrorStateFromRun(run: BackupRunRow | null): MirrorState | null {
  const m = asRecord(asRecord(run?.metadata)?.mirror);
  if (!m) return null;
  return {
    mirrored: m.mirrored === true,
    max_mb: asNumber(m.max_mb),
    size_mb: asNumber(m.size_mb),
    reason: asString(m.reason),
  };
}

/** Per-bucket totals from a `files` run. */
export interface BucketResult {
  name: string;
  objects: number;
  bytes: number;
  skipped: string | null;
}

export function bucketsFromRun(run: BackupRunRow | null): BucketResult[] {
  const raw = asRecord(run?.metadata)?.buckets;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((b): BucketResult[] => {
    const r = asRecord(b);
    const name = asString(r?.name);
    if (!name) return [];
    return [{
      name,
      objects: asNumber(r?.objects) ?? 0,
      bytes: asNumber(r?.bytes) ?? 0,
      skipped: asString(r?.skipped),
    }];
  });
}
