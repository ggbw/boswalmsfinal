import * as XLSX from 'xlsx-js-style';
import { supabase } from '@/integrations/supabase/client';
import type {
  EmployeeDay,
  RawPunch,
  AttendanceSettings,
  WeeklyGridRow,
  MonthlyGridRow,
} from '@/pages/hr/HRAttendanceReportPage';
import {
  formatHM,
  getWeekRange,
  getDaysInMonth,
  getWeekdayIndex,
  WEEKDAY_LABELS,
  buildWeeklyGrid,
  buildMonthlyGrid,
  monthlyCellColor,
} from '@/pages/hr/HRAttendanceReportPage';

interface AttendanceDevice {
  device_serial: string;
  device_name: string | null;
}

interface ExportOptions {
  view: 'daily' | 'weekly' | 'monthly';
  dailyDate: string;
  weekStr: string;
  monthStr: string;
  rows: EmployeeDay[];
  devices: AttendanceDevice[];
  settings: AttendanceSettings;
  // Same filters currently applied on screen — passed through so the
  // exported workbook always matches what's displayed, not just the daily
  // view's already-computed rows.
  deptFilter: string;
  deviceFilter: string;
  search: string;
  employeeFilterIds: string[] | null;
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

// ─── Fetch punches for a date range, honoring the same self-service filter
// used on screen ────────────────────────────────────────────────────────────

async function fetchPunchesInRange(
  from: string,
  to: string,
  employeeFilterIds: string[] | null,
): Promise<RawPunch[]> {
  if (employeeFilterIds && employeeFilterIds.length === 0) return [];
  let q = (supabase as any)
    .from('attendance_records')
    .select('employee_id,full_name,first_name,last_name,department,punch_at,punch_date,device_serial')
    .gte('punch_date', from)
    .lte('punch_date', to);
  if (employeeFilterIds && employeeFilterIds.length > 0) {
    q = q.in('employee_id', employeeFilterIds);
  }
  const { data, error } = await q.order('punch_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as RawPunch[];
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

// ─── Weekly sheet builder — built from the same buildWeeklyGrid() the on-
// screen Weekly view renders from, so the export always mirrors the page ────

function weeklyCellStyle(day: EmployeeDay | null): XLSX.CellStyle {
  if (!day || day.status.tone === 'gray') return S.absentRow;
  if (day.status.label === 'Pending Final Punch' || day.status.label === 'Still In') return S.pendingRow;
  if (day.lateMinutes > 0) return S.lateRow;
  return S.normal;
}

function weeklyCellText(day: EmployeeDay | null): string {
  if (!day) return '—';
  if (day.workedMinutes > 0) {
    return formatHM(day.workedMinutes) + (day.lateMinutes > 0 ? ` (late ${day.lateMinutes}m)` : '');
  }
  return day.status.label;
}

function buildWeeklySheet(gridRows: WeeklyGridRow[], days: string[], weekStr: string): XLSX.WorkSheet {
  const now = new Date().toLocaleString('en-GB');

  const aoa: XLSX.CellObject[][] = [
    [cell('Boswa LMS — Attendance Report', S.title)],
    [cell(`View: Weekly | Period: ${weekStr} | Generated: ${now}`)],
    [cell('')],
    [
      cell('Employee', S.headerCell),
      cell('Employee ID', S.headerCell),
      cell('Department', S.headerCell),
      ...days.map(d => cell(
        `${WEEKDAY_LABELS[getWeekdayIndex(d)]} ${new Date(d + 'T12:00:00').getDate()}`,
        S.headerCell,
      )),
    ],
  ];

  let totalWorked = 0;
  let presentDays = 0;
  let lateCount = 0;

  for (const row of gridRows) {
    const rowCells: XLSX.CellObject[] = [
      cell(row.name, S.normal),
      cell(row.employeeId, S.normal),
      cell(row.dept ?? '', S.normal),
    ];
    for (const day of row.days) {
      rowCells.push(cell(weeklyCellText(day), weeklyCellStyle(day)));
      if (day) {
        presentDays++;
        totalWorked += day.workedMinutes;
        if (day.lateMinutes > 0) lateCount++;
      }
    }
    aoa.push(rowCells);
  }

  aoa.push([
    cell(
      `Employees: ${gridRows.length} | Present Days: ${presentDays} | Late Instances: ${lateCount} | Total Hours: ${formatHM(totalWorked)}`,
      S.footer,
    ),
  ]);

  const ws = XLSX.utils.aoa_to_sheet(aoa as any);
  ws['!freeze'] = { xSplit: 0, ySplit: 4 };
  ws['!cols'] = [{ wch: 28 }, { wch: 13 }, { wch: 18 }, ...days.map(() => ({ wch: 16 }))];
  return ws;
}

// ─── Monthly sheet builder — built from buildMonthlyGrid(), colored with the
// exact same monthlyCellColor() the on-screen heatmap uses ─────────────────

function buildMonthlySheet(gridRows: MonthlyGridRow[], days: string[], monthStr: string): XLSX.WorkSheet {
  const now = new Date().toLocaleString('en-GB');

  const aoa: XLSX.CellObject[][] = [
    [cell('Boswa LMS — Attendance Report', S.title)],
    [cell(`View: Monthly | Period: ${monthStr} | Generated: ${now}`)],
    [cell('')],
    [
      cell('Employee', S.headerCell),
      cell('Department', S.headerCell),
      ...days.map(d => cell(String(new Date(d + 'T12:00:00').getDate()), S.headerCell)),
    ],
  ];

  let totalWorked = 0;
  let presentDays = 0;
  let lateCount = 0;

  for (const row of gridRows) {
    const rowCells: XLSX.CellObject[] = [
      cell(row.name, S.normal),
      cell(row.dept ?? '', S.normal),
    ];
    for (const day of row.days) {
      const bg = monthlyCellColor(day).replace('#', '').toUpperCase();
      const text = day ? (day.workedMinutes > 0 ? formatHM(day.workedMinutes) : day.status.label) : '—';
      rowCells.push(cell(text, style({ bg: bg || undefined })));
      if (day) {
        presentDays++;
        totalWorked += day.workedMinutes;
        if (day.lateMinutes > 0) lateCount++;
      }
    }
    aoa.push(rowCells);
  }

  aoa.push([
    cell(
      `Employees: ${gridRows.length} | Present Days: ${presentDays} | Late Instances: ${lateCount} | Total Hours: ${formatHM(totalWorked)}`,
      S.footer,
    ),
  ]);

  const ws = XLSX.utils.aoa_to_sheet(aoa as any);
  ws['!freeze'] = { xSplit: 0, ySplit: 4 };
  ws['!cols'] = [{ wch: 24 }, { wch: 16 }, ...days.map(() => ({ wch: 9 }))];
  return ws;
}

// ─── Main export function ─────────────────────────────────────────────────────

export async function exportAttendanceExcel(opts: ExportOptions): Promise<void> {
  const {
    view, dailyDate, weekStr, monthStr, rows, settings,
    deptFilter, deviceFilter, search, employeeFilterIds,
  } = opts;

  const wb = XLSX.utils.book_new();

  if (view === 'daily') {
    // The daily view's rows are already computed on screen — reuse them
    // directly so the sheet is guaranteed to match what's displayed.
    const ws = buildDailySheet(rows, dailyDate, settings);
    XLSX.utils.book_append_sheet(wb, ws, 'Attendance');
    XLSX.writeFile(wb, `Attendance_Report_Daily_${dailyDate}.xlsx`);
    return;
  }

  if (view === 'weekly') {
    const { start, end } = getWeekRange(weekStr);
    const punches = await fetchPunchesInRange(start, end, employeeFilterIds);
    const { rows: gridRows, days } = buildWeeklyGrid(punches, start, deptFilter, deviceFilter, search, settings);
    const ws = buildWeeklySheet(gridRows, days, weekStr);
    XLSX.utils.book_append_sheet(wb, ws, 'Attendance');
    XLSX.writeFile(wb, `Attendance_Report_Weekly_${weekStr}.xlsx`);
    return;
  }

  // Monthly
  const [year, month] = monthStr.split('-').map(Number);
  const days = getDaysInMonth(year, month);
  const punches = await fetchPunchesInRange(days[0], days[days.length - 1], employeeFilterIds);
  const gridRows = buildMonthlyGrid(punches, days, deptFilter, deviceFilter, search, settings);
  const ws = buildMonthlySheet(gridRows, days, monthStr);
  XLSX.utils.book_append_sheet(wb, ws, 'Attendance');
  XLSX.writeFile(wb, `Attendance_Report_Monthly_${monthStr}.xlsx`);
}
