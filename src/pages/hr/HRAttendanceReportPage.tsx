import { useState, useEffect, useMemo } from 'react';
import { Download, Info } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { exportAttendanceExcel } from '@/lib/hr/exportAttendanceExcel';
import { useApp } from '@/context/AppContext';
import { useUserRole } from '@/hooks/hr/useUserRole';

// ─── Types ───────────────────────────────────────────────────────────────────

interface RawPunch {
  employee_id: string;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  department: string | null;
  punch_at: string;
  punch_date: string;
  device_serial: string;
}

interface AttendanceDevice {
  device_serial: string;
  device_name: string | null;
}

interface AttendanceSettings {
  work_start_time: string;
  grace_period_minutes: number;
  saturday_enabled?: boolean | null;
  saturday_work_start_time?: string | null;
  saturday_grace_minutes?: number | null;
}

export interface Punch {
  time: Date;
  deviceSerial: string;
}

export interface SlotResult {
  morningIn?: Date;
  lunchOut?: Date;
  lunchIn?: Date;
  eveningOut?: Date;
  extraPunches: Date[];
}

export interface EmployeeDay {
  employeeId: string;
  name: string;
  department: string | null;
  slots: SlotResult;
  punchCount: number;
  lateMinutes: number;
  workedMinutes: number;
  status: { label: string; tone: 'green' | 'orange' | 'red' | 'gray' | 'blue' };
  rawPunches: Date[];
}

// ─── Pure calculation helpers (exported for Excel) ───────────────────────────

export function mapPunchesToSlots(punches: Punch[]): SlotResult {
  const n = punches.length;
  if (n === 0) return { extraPunches: [] };
  if (n === 1) return { morningIn: punches[0].time, extraPunches: [] };
  if (n === 2) return { morningIn: punches[0].time, eveningOut: punches[1].time, extraPunches: [] };

  if (n === 3) {
    const A = punches[0].time, B = punches[1].time, C = punches[2].time;
    const gapAB = (B.getTime() - A.getTime()) / 60000;
    const gapBC = (C.getTime() - B.getTime()) / 60000;
    const TWO_HRS = 120;

    if (gapAB > TWO_HRS && gapAB > gapBC) {
      return { morningIn: A, lunchOut: undefined, lunchIn: B, eveningOut: C, extraPunches: [] };
    }
    if (gapBC > TWO_HRS && gapBC > gapAB) {
      return { morningIn: A, lunchOut: B, lunchIn: undefined, eveningOut: C, extraPunches: [] };
    }
    return { morningIn: A, lunchOut: B, lunchIn: C, eveningOut: undefined, extraPunches: [] };
  }

  if (n === 4) {
    return {
      morningIn: punches[0].time, lunchOut: punches[1].time,
      lunchIn: punches[2].time, eveningOut: punches[3].time,
      extraPunches: [],
    };
  }

  return {
    morningIn: punches[0].time, lunchOut: punches[1].time,
    lunchIn: punches[2].time, eveningOut: punches[3].time,
    extraPunches: punches.slice(4).map(p => p.time),
  };
}

export function computeLateMinutes(
  morningIn: Date | undefined,
  workStartTime: string,
  gracePeriodMinutes: number,
  saturdayOverride?: { enabled: boolean; startTime: string | null; graceMinutes: number | null },
): number {
  if (!morningIn) return 0;
  const isSaturday = morningIn.getDay() === 6;
  // Saturday handling:
  //   - explicitly disabled  → never late
  //   - enabled with overrides → use Saturday start/grace
  //   - enabled with no override → fall through to weekday defaults
  if (isSaturday) {
    if (!saturdayOverride || saturdayOverride.enabled === false) return 0;
  }
  const effectiveStart = (isSaturday && saturdayOverride?.startTime) || workStartTime;
  const effectiveGrace = isSaturday && saturdayOverride?.graceMinutes != null
    ? saturdayOverride.graceMinutes
    : gracePeriodMinutes;
  const [h, m] = effectiveStart.split(':').map(Number);
  const startToday = new Date(morningIn);
  startToday.setHours(h, m, 0, 0);
  const thresholdMs = startToday.getTime() + effectiveGrace * 60000;
  if (morningIn.getTime() <= thresholdMs) return 0;
  return Math.round((morningIn.getTime() - startToday.getTime()) / 60000);
}

export function computeWorkedMinutes(slots: SlotResult): number {
  const { morningIn, lunchOut, lunchIn, eveningOut } = slots;
  if (!morningIn) return 0;

  if (morningIn && lunchOut && lunchIn && eveningOut) {
    const morning = (lunchOut.getTime() - morningIn.getTime()) / 60000;
    const afternoon = (eveningOut.getTime() - lunchIn.getTime()) / 60000;
    return morning + afternoon;
  }

  if (morningIn && eveningOut && !lunchOut && !lunchIn) {
    return (eveningOut.getTime() - morningIn.getTime()) / 60000;
  }

  if (morningIn && eveningOut && (lunchOut || lunchIn)) {
    const total = (eveningOut.getTime() - morningIn.getTime()) / 60000;
    return Math.max(0, total - 60);
  }

  return 0;
}

export function formatHM(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${h}:${String(m).padStart(2, '0')}`;
}

export function determineStatus(slots: SlotResult, punchCount: number): {
  label: string; tone: 'green' | 'orange' | 'red' | 'gray' | 'blue';
} {
  if (punchCount === 0) return { label: 'Absent', tone: 'gray' };
  if (punchCount === 1) return { label: 'Still In', tone: 'blue' };
  if (slots.eveningOut) return { label: 'Checked Out', tone: 'green' };
  if (punchCount === 3 && !slots.eveningOut) return { label: 'Pending Final Punch', tone: 'orange' };
  return { label: 'Checked Out', tone: 'green' };
}

// ─── Format helpers ───────────────────────────────────────────────────────────

function fmtTime(d: Date | undefined): string {
  if (!d) return '—';
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function fmtDateLabel(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

function getWeekRange(weekStr: string): { start: string; end: string } {
  const [yearStr, wStr] = weekStr.split('-W');
  const year = parseInt(yearStr, 10);
  const week = parseInt(wStr, 10);
  const jan4 = new Date(year, 0, 4);
  const dayOfWeek = jan4.getDay() || 7;
  const weekOne = new Date(jan4.getTime() - (dayOfWeek - 1) * 86400000);
  const start = new Date(weekOne.getTime() + (week - 1) * 7 * 86400000);
  const end   = new Date(start.getTime() + 6 * 86400000);
  return {
    start: start.toISOString().split('T')[0],
    end:   end.toISOString().split('T')[0],
  };
}

function getDaysInMonth(year: number, month: number): string[] {
  const days: string[] = [];
  const d = new Date(year, month - 1, 1);
  while (d.getMonth() === month - 1) {
    days.push(d.toISOString().split('T')[0]);
    d.setDate(d.getDate() + 1);
  }
  return days;
}

// ─── Build per-employee rows from raw punches ─────────────────────────────────

function buildEmployeeDays(
  punches: RawPunch[],
  settings: AttendanceSettings,
): EmployeeDay[] {
  const byEmployee = new Map<string, { meta: RawPunch; punches: Punch[] }>();

  for (const p of punches) {
    if (!byEmployee.has(p.employee_id)) {
      byEmployee.set(p.employee_id, { meta: p, punches: [] });
    }
    byEmployee.get(p.employee_id)!.punches.push({
      time: new Date(p.punch_at),
      deviceSerial: p.device_serial,
    });
  }

  const rows: EmployeeDay[] = [];
  for (const [employeeId, { meta, punches: pList }] of byEmployee) {
    pList.sort((a, b) => a.time.getTime() - b.time.getTime());
    const slots   = mapPunchesToSlots(pList);
    const late    = computeLateMinutes(slots.morningIn, settings.work_start_time, settings.grace_period_minutes, { enabled: Boolean(settings.saturday_enabled), startTime: settings.saturday_work_start_time ?? null, graceMinutes: settings.saturday_grace_minutes ?? null });
    const worked  = computeWorkedMinutes(slots);
    const status  = determineStatus(slots, pList.length);
    rows.push({
      employeeId,
      name: meta.full_name || `${meta.first_name ?? ''} ${meta.last_name ?? ''}`.trim() || `Employee ${employeeId}`,
      department: meta.department,
      slots,
      punchCount: pList.length,
      lateMinutes: late,
      workedMinutes: worked,
      status,
      rawPunches: pList.map(p => p.time),
    });
  }

  rows.sort((a, b) => a.name.localeCompare(b.name));
  return rows;
}

// ─── Weekly helpers ───────────────────────────────────────────────────────────

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function getWeekdayIndex(dateStr: string): number {
  const d = new Date(dateStr + 'T12:00:00');
  return (d.getDay() + 6) % 7;
}

// ─── Status badge mapping ─────────────────────────────────────────────────────

function toneToBadge(tone: string): string {
  if (tone === 'green')  return 'badge badge-active';
  if (tone === 'orange') return 'badge badge-pending';
  if (tone === 'blue')   return 'badge badge-pass';
  return 'badge badge-fail';
}

// ─── Daily view table ─────────────────────────────────────────────────────────

function DailyTable({ rows }: { rows: EmployeeDay[] }) {
  if (rows.length === 0) {
    return <div style={{ padding: 32, textAlign: 'center', color: 'var(--text2)' }}>No attendance records for this date.</div>;
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Employee</th>
            <th>Department</th>
            <th>Morning In</th>
            <th>Lunch Out</th>
            <th>Lunch In</th>
            <th>Evening Out</th>
            <th>Worked</th>
            <th>Late (min)</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.employeeId}>
              <td>
                <div className="td-name">{row.name}</div>
                <div style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'monospace' }}>#{row.employeeId}</div>
              </td>
              <td>{row.department ?? <em style={{ color: 'var(--text3)' }}>—</em>}</td>
              <td style={{ fontFamily: 'monospace' }}>{fmtTime(row.slots.morningIn)}</td>
              <td style={{ fontFamily: 'monospace' }}>{fmtTime(row.slots.lunchOut)}</td>
              <td style={{ fontFamily: 'monospace' }}>{fmtTime(row.slots.lunchIn)}</td>
              <td style={{ fontFamily: 'monospace' }}>{fmtTime(row.slots.eveningOut)}</td>
              <td style={{ fontWeight: 600 }}>
                {row.workedMinutes > 0 ? formatHM(row.workedMinutes) : <em style={{ color: 'var(--text3)', fontWeight: 'normal' }}>—</em>}
              </td>
              <td>
                {row.lateMinutes > 0
                  ? <span style={{ color: '#cf222e', fontWeight: 600 }}>{row.lateMinutes}</span>
                  : <em style={{ color: 'var(--text3)' }}>—</em>}
              </td>
              <td>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span className={toneToBadge(row.status.tone)}>{row.status.label}</span>
                  {row.slots.extraPunches.length > 0 && (
                    <span
                      title={`Extra punches: ${row.slots.extraPunches.map(d => fmtTime(d)).join(', ')}`}
                      style={{ cursor: 'help', lineHeight: 1 }}
                    >
                      <Info size={13} style={{ color: 'var(--text3)' }} />
                    </span>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Weekly view ──────────────────────────────────────────────────────────────

function WeeklyView({
  weekStr, deviceFilter, deptFilter, search, settings, employeeFilterIds,
}: {
  weekStr: string;
  deviceFilter: string;
  deptFilter: string;
  search: string;
  settings: AttendanceSettings;
  employeeFilterIds: string[] | null;
}) {
  const [allPunches, setAllPunches] = useState<RawPunch[]>([]);
  const { start, end } = getWeekRange(weekStr);

  useEffect(() => {
    if (employeeFilterIds && employeeFilterIds.length === 0) {
      setAllPunches([]);
      return;
    }
    let q = (supabase as any)
      .from('attendance_records')
      .select('employee_id,full_name,first_name,last_name,department,punch_at,punch_date,device_serial')
      .gte('punch_date', start)
      .lte('punch_date', end);
    if (employeeFilterIds && employeeFilterIds.length > 0) {
      q = q.in('employee_id', employeeFilterIds);
    }
    q.order('punch_at', { ascending: true })
      .then(({ data }: any) => setAllPunches((data ?? []) as RawPunch[]));
  }, [start, end, employeeFilterIds]);

  const grid = useMemo(() => {
    const byEmpDay = new Map<string, RawPunch[]>();
    for (const p of allPunches) {
      const key = `${p.employee_id}|${p.punch_date}`;
      if (!byEmpDay.has(key)) byEmpDay.set(key, []);
      byEmpDay.get(key)!.push(p);
    }

    const empMeta = new Map<string, { name: string; dept: string | null; deviceSerial: string }>();
    for (const p of allPunches) {
      if (!empMeta.has(p.employee_id)) {
        empMeta.set(p.employee_id, {
          name: p.full_name || `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || `Employee ${p.employee_id}`,
          dept: p.department,
          deviceSerial: p.device_serial,
        });
      }
    }

    const days: string[] = [];
    const cur = new Date(start + 'T12:00:00');
    for (let i = 0; i < 7; i++) {
      days.push(cur.toISOString().split('T')[0]);
      cur.setDate(cur.getDate() + 1);
    }

    const result: {
      employeeId: string; name: string; dept: string | null; deviceSerial: string;
      days: (EmployeeDay | null)[];
    }[] = [];

    for (const [empId, meta] of empMeta) {
      if (deptFilter !== 'all' && meta.dept !== deptFilter) continue;
      if (deviceFilter !== 'all' && meta.deviceSerial !== deviceFilter) continue;
      if (search) {
        const q = search.toLowerCase();
        if (!meta.name.toLowerCase().includes(q) && !empId.toLowerCase().includes(q)) continue;
      }

      const dayRows: (EmployeeDay | null)[] = days.map(day => {
        const punches = byEmpDay.get(`${empId}|${day}`) ?? [];
        if (punches.length === 0) return null;
        const pList = punches.map(p => ({ time: new Date(p.punch_at), deviceSerial: p.device_serial }));
        pList.sort((a, b) => a.time.getTime() - b.time.getTime());
        const slots  = mapPunchesToSlots(pList);
        const late   = computeLateMinutes(slots.morningIn, settings.work_start_time, settings.grace_period_minutes, { enabled: Boolean(settings.saturday_enabled), startTime: settings.saturday_work_start_time ?? null, graceMinutes: settings.saturday_grace_minutes ?? null });
        const worked = computeWorkedMinutes(slots);
        const status = determineStatus(slots, pList.length);
        return { employeeId: empId, name: meta.name, department: meta.dept, slots, punchCount: pList.length, lateMinutes: late, workedMinutes: worked, status, rawPunches: pList.map(p => p.time) };
      });

      result.push({ employeeId: empId, name: meta.name, dept: meta.dept, deviceSerial: meta.deviceSerial, days: dayRows });
    }

    result.sort((a, b) => a.name.localeCompare(b.name));
    return { rows: result, days };
  }, [allPunches, start, deptFilter, deviceFilter, search, settings]);

  if (grid.rows.length === 0) {
    return <div style={{ padding: 32, textAlign: 'center', color: 'var(--text2)' }}>No records found for this week.</div>;
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th style={{ minWidth: 160 }}>Employee</th>
            {grid.days.map((day) => (
              <th key={day} style={{ textAlign: 'center', minWidth: 80 }}>
                {WEEKDAY_LABELS[getWeekdayIndex(day)]}<br />
                <span style={{ fontWeight: 'normal', opacity: 0.7 }}>{new Date(day + 'T12:00:00').getDate()}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.rows.map(row => (
            <tr key={row.employeeId}>
              <td>
                <div style={{ fontWeight: 500 }}>{row.name}</div>
                {row.dept && <div style={{ fontSize: 11, color: 'var(--text3)' }}>{row.dept}</div>}
              </td>
              {row.days.map((day, i) => (
                <td key={i} style={{ textAlign: 'center' }}>
                  {day ? (
                    <span
                      style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 2, cursor: 'default' }}
                      title={[
                        day.slots.morningIn  ? `In: ${fmtTime(day.slots.morningIn)}`  : '',
                        day.slots.lunchOut   ? `Lunch Out: ${fmtTime(day.slots.lunchOut)}` : '',
                        day.slots.lunchIn    ? `Lunch In: ${fmtTime(day.slots.lunchIn)}`   : '',
                        day.slots.eveningOut ? `Out: ${fmtTime(day.slots.eveningOut)}` : '',
                        day.workedMinutes > 0 ? `Worked: ${formatHM(day.workedMinutes)}` : '',
                      ].filter(Boolean).join('\n')}
                    >
                      <span style={{
                        display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                        background: day.status.tone === 'green' ? '#22c55e' : day.status.tone === 'orange' ? '#f97316' : day.status.tone === 'blue' ? '#3b82f6' : '#9ca3af',
                      }} />
                      <span style={{ fontSize: 11, color: 'var(--text2)' }}>{day.workedMinutes > 0 ? formatHM(day.workedMinutes) : '—'}</span>
                    </span>
                  ) : (
                    <span style={{ color: 'var(--text3)', fontSize: 11 }}>—</span>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Monthly view ─────────────────────────────────────────────────────────────

function MonthlyView({
  monthStr, deviceFilter, deptFilter, search, settings, employeeFilterIds,
}: {
  monthStr: string;
  deviceFilter: string;
  deptFilter: string;
  search: string;
  settings: AttendanceSettings;
  employeeFilterIds: string[] | null;
}) {
  const [allPunches, setAllPunches] = useState<RawPunch[]>([]);

  const [year, month] = monthStr.split('-').map(Number);
  const days = getDaysInMonth(year, month);
  const firstDay = days[0];
  const lastDay  = days[days.length - 1];

  useEffect(() => {
    if (employeeFilterIds && employeeFilterIds.length === 0) {
      setAllPunches([]);
      return;
    }
    let q = (supabase as any)
      .from('attendance_records')
      .select('employee_id,full_name,first_name,last_name,department,punch_at,punch_date,device_serial')
      .gte('punch_date', firstDay)
      .lte('punch_date', lastDay);
    if (employeeFilterIds && employeeFilterIds.length > 0) {
      q = q.in('employee_id', employeeFilterIds);
    }
    q.order('punch_at', { ascending: true })
      .then(({ data }: any) => setAllPunches((data ?? []) as RawPunch[]));
  }, [firstDay, lastDay, employeeFilterIds]);

  const grid = useMemo(() => {
    const byEmpDay = new Map<string, RawPunch[]>();
    for (const p of allPunches) {
      const key = `${p.employee_id}|${p.punch_date}`;
      if (!byEmpDay.has(key)) byEmpDay.set(key, []);
      byEmpDay.get(key)!.push(p);
    }

    const empMeta = new Map<string, { name: string; dept: string | null; deviceSerial: string }>();
    for (const p of allPunches) {
      if (!empMeta.has(p.employee_id)) {
        empMeta.set(p.employee_id, {
          name: p.full_name || `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || `Employee ${p.employee_id}`,
          dept: p.department,
          deviceSerial: p.device_serial,
        });
      }
    }

    const result: {
      employeeId: string; name: string; dept: string | null;
      days: (EmployeeDay | null)[];
    }[] = [];

    for (const [empId, meta] of empMeta) {
      if (deptFilter !== 'all' && meta.dept !== deptFilter) continue;
      if (deviceFilter !== 'all' && meta.deviceSerial !== deviceFilter) continue;
      if (search) {
        const q = search.toLowerCase();
        if (!meta.name.toLowerCase().includes(q) && !empId.toLowerCase().includes(q)) continue;
      }

      const dayRows: (EmployeeDay | null)[] = days.map(day => {
        const punches = byEmpDay.get(`${empId}|${day}`) ?? [];
        if (punches.length === 0) return null;
        const pList = punches.map(p => ({ time: new Date(p.punch_at), deviceSerial: p.device_serial }));
        pList.sort((a, b) => a.time.getTime() - b.time.getTime());
        const slots  = mapPunchesToSlots(pList);
        const late   = computeLateMinutes(slots.morningIn, settings.work_start_time, settings.grace_period_minutes, { enabled: Boolean(settings.saturday_enabled), startTime: settings.saturday_work_start_time ?? null, graceMinutes: settings.saturday_grace_minutes ?? null });
        const worked = computeWorkedMinutes(slots);
        const status = determineStatus(slots, pList.length);
        return { employeeId: empId, name: meta.name, department: meta.dept, slots, punchCount: pList.length, lateMinutes: late, workedMinutes: worked, status, rawPunches: pList.map(p => p.time) };
      });

      result.push({ employeeId: empId, name: meta.name, dept: meta.dept, days: dayRows });
    }

    result.sort((a, b) => a.name.localeCompare(b.name));
    return result;
  }, [allPunches, days, deptFilter, deviceFilter, search, settings]);

  function cellColor(day: EmployeeDay | null): string {
    if (!day) return '';
    if (day.status.tone === 'gray') return '#e5e7eb';
    if (day.status.label === 'Pending Final Punch' || day.status.label === 'Still In') return '#fed7aa';
    if (day.lateMinutes > 0) return '#fecaca';
    if (day.workedMinutes > 0 && day.workedMinutes < 7 * 60) return '#fef9c3';
    return '#bbf7d0';
  }

  if (grid.length === 0) {
    return <div style={{ padding: 32, textAlign: 'center', color: 'var(--text2)' }}>No records found for this month.</div>;
  }

  return (
    <div className="table-wrap" style={{ fontSize: 12 }}>
      <table style={{ borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ minWidth: 140, position: 'sticky', left: 0, zIndex: 10 }}>Employee</th>
            {days.map(day => (
              <th key={day} style={{ textAlign: 'center', width: 32, fontWeight: 'normal', padding: '4px 2px' }}>
                {new Date(day + 'T12:00:00').getDate()}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.map(row => (
            <tr key={row.employeeId}>
              <td style={{ position: 'sticky', left: 0, zIndex: 10, background: 'var(--surface)', borderRight: '1px solid var(--border)' }}>
                <div style={{ fontWeight: 500 }}>{row.name}</div>
                {row.dept && <div style={{ fontSize: 11, color: 'var(--text3)' }}>{row.dept}</div>}
              </td>
              {row.days.map((day, i) => (
                <td key={i} style={{ padding: '2px', textAlign: 'center' }}>
                  <span
                    style={{
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      width: 28, height: 28, borderRadius: 4, fontSize: 11, fontWeight: 500,
                      background: cellColor(day), cursor: 'default',
                    }}
                    title={day ? [
                      day.slots.morningIn  ? `In: ${fmtTime(day.slots.morningIn)}`  : '',
                      day.slots.eveningOut ? `Out: ${fmtTime(day.slots.eveningOut)}` : '',
                      day.workedMinutes > 0 ? `${formatHM(day.workedMinutes)}h` : '',
                      day.lateMinutes > 0   ? `Late ${day.lateMinutes}m` : '',
                    ].filter(Boolean).join(' · ') : ''}
                  >
                    {day ? (day.workedMinutes > 0 ? `${Math.floor(day.workedMinutes / 60)}` : '·') : ''}
                  </span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function HRAttendanceReportPage() {
  type ViewMode = 'daily' | 'weekly' | 'monthly';

  const todayStr  = new Date().toISOString().split('T')[0];
  const thisMonth = todayStr.slice(0, 7);

  const getISOWeek = (): string => {
    const d = new Date();
    const thursday = new Date(d);
    thursday.setDate(d.getDate() - (d.getDay() + 6) % 7 + 3);
    const yearStart = new Date(thursday.getFullYear(), 0, 1);
    const weekNum = Math.ceil(((thursday.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
    return `${thursday.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
  };

  const { toast } = useApp();
  const { isEmployee, profile } = useUserRole();

  const [view, setView]             = useState<ViewMode>('daily');
  const [dailyDate, setDailyDate]   = useState(todayStr);
  const [weekStr, setWeekStr]       = useState(getISOWeek());
  const [monthStr, setMonthStr]     = useState(thisMonth);
  const [search, setSearch]         = useState('');
  const [deptFilter, setDeptFilter] = useState('all');
  const [deviceFilter, setDeviceFilter] = useState('all');

  const [rawPunches, setRawPunches]   = useState<RawPunch[]>([]);
  const [devices, setDevices]         = useState<AttendanceDevice[]>([]);
  const [departments, setDepartments] = useState<string[]>([]);
  const [settings, setSettings]       = useState<AttendanceSettings>({ work_start_time: '08:00:00', grace_period_minutes: 0 });
  const [loading, setLoading]         = useState(false);

  const [employeeFilterIds, setEmployeeFilterIds] = useState<string[] | null>(null);

  // Resolve self-view filter for employee role
  useEffect(() => {
    if (!isEmployee) {
      setEmployeeFilterIds(null);
      return;
    }
    const empId = (profile as { employee_id?: string } | null)?.employee_id;
    if (!empId) {
      setEmployeeFilterIds([]);
      return;
    }
    (supabase as any)
      .from('employees')
      .select('biometric_id, employee_code')
      .eq('id', empId)
      .maybeSingle()
      .then(({ data }: any) => {
        const ids = data
          ? ([data.biometric_id, data.employee_code].filter(Boolean) as string[])
          : [];
        setEmployeeFilterIds(ids);
      });
  }, [isEmployee, profile]);

  // Load devices + settings once
  useEffect(() => {
    (supabase as any)
      .from('attendance_devices')
      .select('device_serial, device_name')
      .eq('is_active', true)
      .then(({ data }: any) => setDevices((data ?? []) as AttendanceDevice[]));

    (supabase as any)
      .from('attendance_settings')
      .select('*')
      .eq('id', 1)
      .single()
      .then(({ data }: any) => { if (data) setSettings(data as AttendanceSettings); });
  }, []);

  // Load daily punches
  useEffect(() => {
    if (view !== 'daily') return;
    if (isEmployee && employeeFilterIds === null) return;
    if (isEmployee && employeeFilterIds && employeeFilterIds.length === 0) {
      setRawPunches([]);
      setDepartments([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    let q = (supabase as any)
      .from('attendance_records')
      .select('employee_id,full_name,first_name,last_name,department,punch_at,punch_date,device_serial')
      .eq('punch_date', dailyDate);
    if (isEmployee && employeeFilterIds && employeeFilterIds.length > 0) {
      q = q.in('employee_id', employeeFilterIds);
    }
    q.order('punch_at', { ascending: true })
      .then(({ data }: any) => {
        const punches = (data ?? []) as RawPunch[];
        setRawPunches(punches);
        const depts = [...new Set(punches.map(p => p.department).filter(Boolean) as string[])].sort();
        setDepartments(depts);
        setLoading(false);
      });
  }, [dailyDate, view, isEmployee, employeeFilterIds]);

  const rows: EmployeeDay[] = useMemo(() => {
    if (view !== 'daily') return [];
    let filtered = rawPunches;
    if (deviceFilter !== 'all') filtered = filtered.filter(p => p.device_serial === deviceFilter);
    return buildEmployeeDays(filtered, settings).filter(row => {
      if (deptFilter !== 'all' && row.department !== deptFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!row.name.toLowerCase().includes(q) && !row.employeeId.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [rawPunches, view, deptFilter, deviceFilter, search, settings]);

  const stats = useMemo(() => {
    const totalPresent = rows.length;
    const late = rows.filter(r => r.lateMinutes > 0).length;
    const presentWithHours = rows.filter(r => r.workedMinutes > 0);
    const avgHours = presentWithHours.length > 0
      ? (presentWithHours.reduce((s, r) => s + r.workedMinutes, 0) / 60 / presentWithHours.length).toFixed(1)
      : '0.0';
    const pending = rows.filter(r => r.status.label === 'Pending Final Punch' || r.status.label === 'Still In').length;
    return { totalPresent, late, avgHours, pending };
  }, [rows]);

  const handleExport = () => {
    try {
      exportAttendanceExcel({ view, dailyDate, weekStr, monthStr, rows, devices, settings });
    } catch (e) {
      toast('Export failed: ' + String(e), 'error');
    }
  };

  const periodLabel = view === 'daily'
    ? fmtDateLabel(dailyDate)
    : view === 'weekly'
    ? weekStr
    : new Date(monthStr + '-01').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  return (
    <>
      {/* Header */}
      <div className="page-header">
        <div>
          <div className="page-title">Attendance Report</div>
          <div className="page-sub">HR Management · {periodLabel}</div>
        </div>
        <button className="btn btn-primary btn-sm" onClick={handleExport}>
          <Download size={15} /> Export
        </button>
      </div>

      {/* View toggle + date picker */}
      <div className="card" style={{ padding: '12px 16px', marginBottom: 12 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
          <div style={{ display: 'flex', borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border)' }}>
            {(['daily', 'weekly', 'monthly'] as const).map(v => (
              <button
                key={v}
                onClick={() => setView(v)}
                style={{
                  padding: '4px 14px', fontSize: 13, fontWeight: 500, textTransform: 'capitalize',
                  background: view === v ? 'var(--primary)' : 'var(--surface)',
                  color: view === v ? '#fff' : 'var(--text2)',
                  border: 'none', cursor: 'pointer',
                }}
              >
                {v}
              </button>
            ))}
          </div>

          {view === 'daily' && (
            <input type="date" className="form-input" style={{ width: 160 }} value={dailyDate} onChange={e => setDailyDate(e.target.value)} />
          )}
          {view === 'weekly' && (
            <input type="week" className="form-input" style={{ width: 180 }} value={weekStr} onChange={e => setWeekStr(e.target.value)} />
          )}
          {view === 'monthly' && (
            <input type="month" className="form-input" style={{ width: 160 }} value={monthStr} onChange={e => setMonthStr(e.target.value)} />
          )}

          <span style={{ marginLeft: 'auto', fontSize: 13, color: 'var(--text2)' }}>{periodLabel}</span>
        </div>
      </div>

      {/* Filters — admin/HR/manager only */}
      {!isEmployee && (
        <div className="card" style={{ padding: '12px 16px', marginBottom: 12 }}>
          <div className="form-row cols3">
            <div className="form-group">
              <input
                className="form-input"
                placeholder="Search name / ID…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            <div className="form-group">
              <select className="form-select" value={deptFilter} onChange={e => setDeptFilter(e.target.value)}>
                <option value="all">All Departments</option>
                {departments.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div className="form-group">
              <select className="form-select" value={deviceFilter} onChange={e => setDeviceFilter(e.target.value)}>
                <option value="all">All Devices</option>
                {devices.map(d => (
                  <option key={d.device_serial} value={d.device_serial}>
                    {d.device_name ?? d.device_serial}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Summary cards (daily only) */}
      {view === 'daily' && (
        <div className="stat-grid" style={{ marginBottom: 12 }}>
          <div className="stat-card">
            <div className="stat-icon" style={{ background: 'rgba(37,99,235,0.13)', color: '#2563eb' }}>
              <i className="fa-solid fa-users" />
            </div>
            <div><div className="stat-val">{stats.totalPresent}</div><div className="stat-label">Present</div></div>
          </div>
          <div className="stat-card">
            <div className="stat-icon" style={{ background: 'rgba(207,34,46,0.13)', color: '#cf222e' }}>
              <i className="fa-solid fa-clock" />
            </div>
            <div><div className="stat-val" style={{ color: '#cf222e' }}>{stats.late}</div><div className="stat-label">Late</div></div>
          </div>
          <div className="stat-card">
            <div className="stat-icon" style={{ background: 'rgba(26,127,55,0.13)', color: '#1a7f37' }}>
              <i className="fa-solid fa-hourglass-half" />
            </div>
            <div><div className="stat-val" style={{ color: '#1a7f37' }}>{stats.avgHours}h</div><div className="stat-label">Avg Hours</div></div>
          </div>
          <div className="stat-card">
            <div className="stat-icon" style={{ background: 'rgba(212,146,10,0.13)', color: '#d4920a' }}>
              <i className="fa-solid fa-circle-exclamation" />
            </div>
            <div><div className="stat-val" style={{ color: '#d4920a' }}>{stats.pending}</div><div className="stat-label">Pending</div></div>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="card" style={{ padding: 0 }}>
        {loading && view === 'daily' ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text2)' }}>Loading…</div>
        ) : view === 'daily' ? (
          <DailyTable rows={rows} />
        ) : view === 'weekly' ? (
          <WeeklyView
            weekStr={weekStr}
            deviceFilter={deviceFilter}
            deptFilter={deptFilter}
            search={search}
            settings={settings}
            employeeFilterIds={isEmployee ? employeeFilterIds : null}
          />
        ) : (
          <MonthlyView
            monthStr={monthStr}
            deviceFilter={deviceFilter}
            deptFilter={deptFilter}
            search={search}
            settings={settings}
            employeeFilterIds={isEmployee ? employeeFilterIds : null}
          />
        )}
      </div>
    </>
  );
}
