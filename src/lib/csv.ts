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
}

/** Filesystem-safe fragment for a filename, e.g. "Escoffiers Yr1" → "escoffiers-yr1". */
export function slug(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'export';
}
