/**
 * Class register exports: a formatted Excel workbook and a print-ready PDF.
 *
 * Both carry the same two views as the on-screen register — the per-student
 * summary, and the day-by-day grid (P / A / L per register date) — built from
 * exactly the filtered records on screen, so the file matches what was viewed.
 *
 * The PDF opens the browser's print dialog on a landscape page, where "Save as
 * PDF" produces the file; the transcript uses the same approach.
 */

import * as XLSX from 'xlsx-js-style';

import { logExport } from '@/lib/audit';

export interface RegisterMeta {
  title: string;
  className: string;
  moduleName: string;
  periodLabel: string;
  from: string;
  to: string;
}

export interface RegisterSummaryRow {
  name: string;
  studentId: string;
  present: number;
  absent: number;
  late: number;
  total: number;
  rate: number | null;
}

export interface RegisterGrid {
  dates: string[];
  /** One row per student: the status letters for each date ('' when no register). */
  rows: { name: string; studentId: string; cells: string[] }[];
}

const STATUS_LETTER: Record<string, string> = { present: 'P', absent: 'A', late: 'L' };

/** Build the day-by-day grid from attendance records (one cell may hold several sessions). */
export function buildRegisterGrid(
  students: { id: string; name: string; studentId: string }[],
  records: { studentId: string; date: string; status: string }[],
): RegisterGrid {
  const dates = [...new Set(records.map(r => r.date))].sort();
  const rows = students.map(s => ({
    name: s.name,
    studentId: s.studentId,
    cells: dates.map(d =>
      records
        .filter(r => r.studentId === s.id && r.date === d)
        .map(r => STATUS_LETTER[r.status] || '?')
        .join('/'),
    ),
  }));
  return { dates, rows };
}

const shortDate = (iso: string) =>
  new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });

const HEADER = { font: { bold: true, color: { rgb: 'FFFFFF' } }, fill: { patternType: 'solid', fgColor: { rgb: '3D0000' } }, alignment: { horizontal: 'center', vertical: 'center', wrapText: true } } as XLSX.CellStyle;
const TITLE = { font: { bold: true, sz: 14 } } as XLSX.CellStyle;
const LABEL = { font: { bold: true } } as XLSX.CellStyle;
const CENTER = { alignment: { horizontal: 'center' } } as XLSX.CellStyle;
const TOTAL = { font: { bold: true }, fill: { patternType: 'solid', fgColor: { rgb: 'F2F2F2' } } } as XLSX.CellStyle;
const STATUS_FILL: Record<string, string> = { P: 'DAFBE1', A: 'FFEBE9', L: 'FFF8C5' };

function metaRows(meta: RegisterMeta): (string | number)[][] {
  return [
    [meta.title],
    ['Class', meta.className],
    ['Module', meta.moduleName],
    ['Period', `${meta.periodLabel} (${meta.from} to ${meta.to})`],
    ['Generated', new Date().toLocaleString('en-GB')],
    [],
  ];
}

function styleMeta(ws: XLSX.WorkSheet) {
  if (ws.A1) ws.A1.s = TITLE;
  ['A2', 'A3', 'A4', 'A5'].forEach(ref => { if (ws[ref]) ws[ref].s = LABEL; });
}

function summarySheet(meta: RegisterMeta, rows: RegisterSummaryRow[]): XLSX.WorkSheet {
  const tot = rows.reduce((a, r) => ({ p: a.p + r.present, ab: a.ab + r.absent, l: a.l + r.late, t: a.t + r.total }), { p: 0, ab: 0, l: 0, t: 0 });
  const overall = tot.t ? Math.round(((tot.p + tot.l) / tot.t) * 100) : '';
  const head = ['#', 'Student', 'Student ID', 'Present', 'Absent', 'Late', 'Registers', 'Attendance %'];
  const aoa: (string | number)[][] = [
    ...metaRows(meta),
    head,
    ...rows.map((r, i) => [i + 1, r.name, r.studentId, r.present, r.absent, r.late, r.total, r.rate ?? '']),
    ['TOTAL', `${rows.length} student(s)`, '', tot.p, tot.ab, tot.l, tot.t, overall],
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  styleMeta(ws);
  const headRow = metaRows(meta).length;
  for (let c = 0; c < head.length; c++) {
    const hRef = XLSX.utils.encode_cell({ r: headRow, c });
    ws[hRef].s = HEADER;
    for (let r = headRow + 1; r <= headRow + rows.length + 1; r++) {
      const ref = XLSX.utils.encode_cell({ r, c });
      if (!ws[ref]) continue;
      ws[ref].s = r === headRow + rows.length + 1 ? TOTAL : (c === 1 || c === 2 ? {} : CENTER);
    }
  }
  ws['!cols'] = [{ wch: 5 }, { wch: 32 }, { wch: 14 }, { wch: 9 }, { wch: 9 }, { wch: 7 }, { wch: 10 }, { wch: 13 }];
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 7 } }];
  return ws;
}

function gridSheet(meta: RegisterMeta, grid: RegisterGrid): XLSX.WorkSheet {
  const head = ['#', 'Student', 'Student ID', ...grid.dates.map(shortDate)];
  const aoa: (string | number)[][] = [
    ...metaRows(meta),
    ['Key', 'P = present · A = absent · L = late · blank = no register'],
    head,
    ...grid.rows.map((r, i) => [i + 1, r.name, r.studentId, ...r.cells]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  styleMeta(ws);
  if (ws.A7) ws.A7.s = LABEL;
  const headRow = metaRows(meta).length + 1;
  for (let c = 0; c < head.length; c++) {
    ws[XLSX.utils.encode_cell({ r: headRow, c })].s = HEADER;
    for (let r = headRow + 1; r <= headRow + grid.rows.length; r++) {
      const ref = XLSX.utils.encode_cell({ r, c });
      if (!ws[ref] || c < 3) continue;
      const v = String(ws[ref].v || '');
      const fill = STATUS_FILL[v.charAt(0)];
      ws[ref].s = fill ? { ...CENTER, fill: { patternType: 'solid', fgColor: { rgb: fill } } } as XLSX.CellStyle : CENTER;
    }
  }
  ws['!cols'] = [{ wch: 5 }, { wch: 32 }, { wch: 14 }, ...grid.dates.map(() => ({ wch: 7 }))];
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: Math.max(7, head.length - 1) } }];
  return ws;
}

export function downloadRegisterXlsx(filename: string, meta: RegisterMeta, rows: RegisterSummaryRow[], grid: RegisterGrid) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, summarySheet(meta, rows), 'Summary');
  XLSX.utils.book_append_sheet(wb, gridSheet(meta, grid), 'Register');
  XLSX.writeFile(wb, filename);
  void logExport(filename, rows.length);
}

const esc = (v: string | number | null | undefined) =>
  String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Opens a landscape, print-ready register; returns false when the pop-up was blocked. */
export function printRegisterPdf(filename: string, meta: RegisterMeta, rows: RegisterSummaryRow[], grid: RegisterGrid): boolean {
  const tot = rows.reduce((a, r) => ({ p: a.p + r.present, ab: a.ab + r.absent, l: a.l + r.late, t: a.t + r.total }), { p: 0, ab: 0, l: 0, t: 0 });
  const overall = tot.t ? `${Math.round(((tot.p + tot.l) / tot.t) * 100)}%` : '—';
  const cellBg: Record<string, string> = { P: '#dafbe1', A: '#ffebe9', L: '#fff8c5' };

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(filename)}</title>
<style>
  @page { size: A4 landscape; margin: 12mm; }
  body { font-family: Arial, sans-serif; font-size: 11px; color: #111; }
  h1 { font-size: 16px; margin: 0 0 4px; color: #3d0000; }
  .meta { margin-bottom: 10px; } .meta span { margin-right: 18px; }
  table { border-collapse: collapse; width: 100%; margin-bottom: 14px; }
  th { background: #3d0000; color: #fff; padding: 4px; font-size: 10px; }
  td { border: 1px solid #ccc; padding: 3px 4px; }
  td.c { text-align: center; } tr.total td { font-weight: bold; background: #f2f2f2; }
  h2 { font-size: 13px; margin: 12px 0 6px; page-break-before: always; }
  .key { font-size: 10px; color: #555; margin-bottom: 6px; }
  .noprint { margin: 10px 0; } @media print { .noprint { display: none; } }
</style></head><body>
<div class="noprint"><button onclick="window.print()">Print / Save as PDF</button></div>
<h1>${esc(meta.title)}</h1>
<div class="meta"><span><b>Class:</b> ${esc(meta.className)}</span><span><b>Module:</b> ${esc(meta.moduleName)}</span>
<span><b>Period:</b> ${esc(meta.periodLabel)} (${esc(meta.from)} to ${esc(meta.to)})</span><span><b>Generated:</b> ${esc(new Date().toLocaleString('en-GB'))}</span></div>
<table><thead><tr><th>#</th><th>Student</th><th>Student ID</th><th>Present</th><th>Absent</th><th>Late</th><th>Registers</th><th>Attendance %</th></tr></thead><tbody>
${rows.map((r, i) => `<tr><td class="c">${i + 1}</td><td>${esc(r.name)}</td><td>${esc(r.studentId)}</td><td class="c">${r.present}</td><td class="c">${r.absent}</td><td class="c">${r.late}</td><td class="c">${r.total}</td><td class="c">${r.rate == null ? '—' : r.rate + '%'}</td></tr>`).join('')}
<tr class="total"><td>TOTAL</td><td>${rows.length} student(s)</td><td></td><td class="c">${tot.p}</td><td class="c">${tot.ab}</td><td class="c">${tot.l}</td><td class="c">${tot.t}</td><td class="c">${overall}</td></tr>
</tbody></table>
${grid.dates.length ? `<h2>Register — day by day</h2><div class="key">P = present · A = absent · L = late · blank = no register</div>
<table><thead><tr><th>#</th><th>Student</th><th>ID</th>${grid.dates.map(d => `<th>${esc(shortDate(d))}</th>`).join('')}</tr></thead><tbody>
${grid.rows.map((r, i) => `<tr><td class="c">${i + 1}</td><td>${esc(r.name)}</td><td>${esc(r.studentId)}</td>${r.cells.map(c => `<td class="c" style="background:${cellBg[c.charAt(0)] || '#fff'}">${esc(c)}</td>`).join('')}</tr>`).join('')}
</tbody></table>` : ''}
<script>window.onload = function () { window.print(); };</script>
</body></html>`;

  const win = window.open('', '_blank', 'width=1100,height=800');
  if (!win) return false;
  win.document.open();
  win.document.write(html);
  win.document.close();
  void logExport(filename, rows.length);
  return true;
}
