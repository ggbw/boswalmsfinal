/**
 * CSV download helper.
 *
 * Every field is quoted and embedded quotes are doubled, so names with commas
 * ("Mono, Sekgele") and student numbers Excel would otherwise mangle survive
 * the round trip. CRLF line endings because Excel on Windows expects them.
 *
 * A UTF-8 BOM is prepended so Excel reads accented names correctly instead of
 * showing mojibake — without it, Excel guesses the local codepage.
 */
import { logExport } from '@/lib/audit';

export function downloadCsv(filename: string, rows: (string | number | null | undefined)[][]) {
  const esc = (v: string | number | null | undefined) =>
    `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = rows.map(r => r.map(esc).join(',')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  // Audit the download.
  //
  // An export is the one way school data leaves the building without changing
  // anything, so a change-only audit shows the day someone took every student
  // record as a quiet day. Hooking it here rather than at each call site means
  // any future export gets recorded without anyone remembering to add it.
  //
  // The row count subtracts one for the header row every caller passes first.
  // logExport never throws and never awaits anything the download needs.
  void logExport(filename, Math.max(0, rows.length - 1));
}

/** Filesystem-safe fragment for a filename, e.g. "Escoffiers Yr1" → "escoffiers-yr1". */
export function slug(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'export';
}
