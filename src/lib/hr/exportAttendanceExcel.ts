import * as XLSX from 'xlsx-js-style';
import type { EmployeeDay } from '@/pages/hr/HRAttendanceReportPage';
import { formatHM } from '@/pages/hr/HRAttendanceReportPage';

interface AttendanceDevice {
  device_serial: string;
  device_name: string | null;
}

interface AttendanceSettings {
  work_start_time: string;
  grace_period_minutes: number;
}

interface ExportOptions {
  view: 'daily' | 'weekly' | 'monthly';
  dailyDate: string;
  weekStr: string;
  monthStr: string;
  rows: EmployeeDay[];
  devices: AttendanceDevice[];
  settings: AttendanceSettings;
}

// ─── Cell style helpers ───────────────────────────────────────────────────────

function style(opts: {
  bold?: boolean;
  bg?: string;
  fgRed?: boolean;
  fgBlack?: boolean;
  alignRight?: boolean;
}): XLSX.CellStyle {
  return {
    font: {
      bold: opts.bold ?? false,
      color: opts.fgRed ? { rgb: 'CC0000' } : opts.fgBlack ? { rgb: '000000' } : undefined,
    },
    fill: opts.bg ? { fgColor: { rgb: opts.bg }, patternType: 'solid' } : undefined,
    alignment: opts.alignRight ? { horizontal: 'right' } : undefined,
  } as XLSX.CellStyle;
}

const S = {
  headerCell:  style({ bold: true, bg: 'FFD700', fgBlack: true }),
  lateRow:     style({ bg: 'FFE5E5' }),
  pendingRow:  style({ bg: 'FFF3D6' }),
  absentRow:   style({ bg: 'F1F3F5' }),
  altRow:      style({ bg: 'F8F9FA' }),
  normal:      style({}),
  lateMin:     style({ fgRed: true, bold: true }),
  boldCell:    style({ bold: true }),
  footer:      style({ bold: true, bg: 'FFD700', fgBlack: true }),
  title:       style({ bold: true }),
};

function cell(v: string | number, s?: XLSX.CellStyle): XLSX.CellObject {
  return { v, t: typeof v === 'number' ? 'n' : 's', s } as XLSX.CellObject;
}

function fmtTime(d: Date | undefined): string {
  if (!d) return '—';
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

// ─── Daily sheet builder ──────────────────────────────────────────────────────

function buildDailySheet(rows: EmployeeDay[], date: string, settings: AttendanceSettings): XLSX.WorkSheet {
  const now = new Date().toLocaleString('en-GB');
  const period = date;

  const aoa: XLSX.CellObject[][] = [
    [cell('Boswa LMS — Attendance Report', S.title)],
    [cell(`View: Daily | Period: ${period} | Generated: ${now}`)],
    [cell('')],
    [
      cell('Employee', S.headerCell),
      cell('Employee ID', S.headerCell),
      cell('Department', S.headerCell),
      cell('Morning In', S.headerCell),
      cell('Lunch Out', S.headerCell),
      cell('Lunch In', S.headerCell),
      cell('Evening Out', S.headerCell),
      cell('Worked Hours', S.headerCell),
      cell('Late (min)', S.headerCell),
      cell('Status', S.headerCell),
    ],
  ];

  let altToggle = false;
  for (const row of rows) {
    let rowStyle: XLSX.CellStyle;
    if (row.status.tone === 'gray') rowStyle = S.absentRow;
    else if (row.status.label === 'Pending Final Punch' || row.status.label === 'Missed Punch') rowStyle = S.pendingRow;
    else if (row.lateMinutes > 0) rowStyle = S.lateRow;
    else { rowStyle = altToggle ? S.altRow : S.normal; altToggle = !altToggle; }

    aoa.push([
      cell(row.name, rowStyle),
      cell(row.employeeId, rowStyle),
      cell(row.department ?? '', rowStyle),
      cell(fmtTime(row.slots.morningIn), rowStyle),
      cell(fmtTime(row.slots.lunchOut), rowStyle),
      cell(fmtTime(row.slots.lunchIn), rowStyle),
      cell(fmtTime(row.slots.eveningOut), rowStyle),
      cell(row.workedMinutes > 0 ? formatHM(row.workedMinutes) : '—', S.boldCell),
      row.lateMinutes > 0
        ? cell(row.lateMinutes, S.lateMin)
        : cell('—', rowStyle),
      cell(row.status.label, rowStyle),
    ]);
  }

  // Footer summary
  const totalPresent = rows.length;
  const lateCount    = rows.filter(r => r.lateMinutes > 0).length;
  const totalWorked  = rows.reduce((s, r) => s + r.workedMinutes, 0);
  const avgLate      = lateCount > 0
    ? Math.round(rows.filter(r => r.lateMinutes > 0).reduce((s, r) => s + r.lateMinutes, 0) / lateCount)
    : 0;

  aoa.push([
    cell(
      `Total Employees: ${totalPresent} | Late: ${lateCount} | Total Hours: ${formatHM(totalWorked)} | Avg Late: ${avgLate} min`,
      S.footer,
    ),
  ]);

  const ws = XLSX.utils.aoa_to_sheet(aoa as any);

  ws['!freeze'] = { xSplit: 0, ySplit: 4 };
  ws['!cols'] = [
    { wch: 28 }, { wch: 13 }, { wch: 18 }, { wch: 12 },
    { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 13 },
    { wch: 11 }, { wch: 20 },
  ];

  return ws;
}

// ─── Main export function ─────────────────────────────────────────────────────

export function exportAttendanceExcel(opts: ExportOptions): void {
  const { view, dailyDate, weekStr, monthStr, rows, settings } = opts;

  const wb = XLSX.utils.book_new();

  if (view === 'daily') {
    const ws = buildDailySheet(rows, dailyDate, settings);
    XLSX.utils.book_append_sheet(wb, ws, 'Attendance');
    XLSX.writeFile(wb, `Attendance_Report_Daily_${dailyDate}.xlsx`);
    return;
  }

  if (view === 'weekly') {
    const summaryAoa: XLSX.CellObject[][] = [
      [cell('Boswa LMS — Attendance Report', S.title)],
      [cell(`View: Weekly | Period: ${weekStr} | Generated: ${new Date().toLocaleString('en-GB')}`)],
      [cell('')],
      [cell('Week summary not available — see per-day sheets', S.normal)],
    ];
    const wsSummary = XLSX.utils.aoa_to_sheet(summaryAoa as any);
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');
    XLSX.writeFile(wb, `Attendance_Report_Weekly_${weekStr}.xlsx`);
    return;
  }

  // Monthly
  const summaryAoa: XLSX.CellObject[][] = [
    [cell('Boswa LMS — Attendance Report', S.title)],
    [cell(`View: Monthly | Period: ${monthStr} | Generated: ${new Date().toLocaleString('en-GB')}`)],
    [cell('')],
    [cell('Monthly summary — see individual sheets for punch detail', S.normal)],
  ];
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryAoa as any);
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');
  XLSX.writeFile(wb, `Attendance_Report_Monthly_${monthStr}.xlsx`);
}
