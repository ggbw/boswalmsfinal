import { useState, useEffect, useMemo, useCallback } from 'react';
import { RefreshCw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useApp } from '@/context/AppContext';
import { useUserRole } from '@/hooks/hr/useUserRole';
import {
  mapPunchesToSlots,
  computeLateMinutes,
  type Punch,
  type SlotResult,
} from '@/pages/hr/HRAttendanceReportPage';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AttendanceDevice {
  id: number;
  device_serial: string;
  device_name: string | null;
  location: string | null;
  is_active: boolean | null;
  last_seen: string | null;
  last_sync: string | null;
}

interface AttendanceSettings {
  work_start_time: string;
  grace_period_minutes: number;
  saturday_enabled?: boolean | null;
  saturday_work_start_time?: string | null;
  saturday_grace_minutes?: number | null;
}

interface EmployeeSummary {
  employeeId: string;
  name: string;
  department: string | null;
  slots: SlotResult;
  firstPunchIso: string;
  punchCount: number;
}

// Botswana is UTC+2, no DST
function getTodayBotswana(): string {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  const bwMs  = utcMs + 2 * 3600000;
  return new Date(bwMs).toISOString().split('T')[0];
}

function getYesterday(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
}

function fmtSlot(d: Date | undefined): string {
  if (!d) return '—';
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function fmtTimestamp(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

// ─── Status helpers ───────────────────────────────────────────────────────────

function getEmployeeStatus(punchCount: number, date: string): { label: string; badgeClass: string } {
  const isEven  = punchCount % 2 === 0;
  const isToday = date === getTodayBotswana();
  if (isEven)  return { label: 'Checked Out', badgeClass: 'badge badge-fail' };
  if (isToday) return { label: 'Still In',    badgeClass: 'badge badge-active' };
  return               { label: 'Missed Punch', badgeClass: 'badge badge-pending' };
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function HRLiveAttendancePage() {
  const { toast } = useApp();
  const { can }   = useUserRole();

  const [devices, setDevices]                 = useState<AttendanceDevice[]>([]);
  const [activeDeviceId, setActiveDeviceId]   = useState<number | null>(null);
  const [recordsByDevice, setRecordsByDevice] = useState<Record<string, any[]>>({});
  const [selectedDate, setSelectedDate]       = useState<string>('');
  const [dateInitialized, setDateInitialized] = useState(false);
  const [loading, setLoading]                 = useState(false);
  const [error, setError]                     = useState<string | null>(null);
  const [lastSyncAt, setLastSyncAt]           = useState<string | null>(null);
  const [settings, setSettings]               = useState<AttendanceSettings>({
    work_start_time: '08:00:00',
    grace_period_minutes: 0,
  });

  const activeDevice = devices.find(d => d.id === activeDeviceId) ?? devices[0];

  // Load device list
  const loadDevices = useCallback(async () => {
    const { data, error: err } = await (supabase as any)
      .from('attendance_devices')
      .select('id, device_serial, device_name, location, is_active, last_seen, last_sync')
      .eq('is_active', true)
      .order('id');
    if (err) { setError(err.message); return; }
    setDevices(data ?? []);
    if (data?.length && !activeDeviceId) setActiveDeviceId(data[0].id);
  }, [activeDeviceId]);

  // On first device load, set date to MAX(punch_date) for that device
  useEffect(() => {
    if (!activeDevice || dateInitialized) return;
    (supabase as any)
      .from('attendance_records')
      .select('punch_date')
      .eq('device_serial', activeDevice.device_serial)
      .order('punch_date', { ascending: false })
      .limit(1)
      .then(({ data }: any) => {
        const latest = (data as any)?.[0]?.punch_date as string | undefined;
        setSelectedDate(latest ?? getYesterday());
        setDateInitialized(true);
      });
  }, [activeDevice, dateInitialized]);

  // Load attendance records for selected date, all devices
  const loadRecords = useCallback(async () => {
    if (!devices.length || !selectedDate) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await (supabase as any)
        .from('attendance_records')
        .select('*')
        .eq('punch_date', selectedDate)
        .order('punch_at', { ascending: true });
      if (err) throw err;

      const grouped: Record<string, any[]> = {};
      for (const r of data ?? []) {
        if (!grouped[r.device_serial]) grouped[r.device_serial] = [];
        grouped[r.device_serial].push(r);
      }
      setRecordsByDevice(grouped);
    } catch (err) {
      const msg = (err as Error).message;
      setError(msg);
      toast(msg, 'error');
    } finally {
      setLoading(false);
    }
  }, [devices, selectedDate, toast]);

  // Load last successful sync. The sync_runs table is part of an unshipped
  // device-sync feature, so swallow "relation does not exist" errors silently
  // and leave the indicator hidden (the header only renders lastSyncAt when
  // truthy).
  const loadLastSync = useCallback(async () => {
    const { data, error } = await (supabase as any)
      .from('sync_runs')
      .select('finished_at')
      .eq('status', 'success')
      .order('finished_at', { ascending: false })
      .limit(1);
    if (error) { setLastSyncAt(null); return; }
    setLastSyncAt(data?.[0]?.finished_at ?? null);
  }, []);

  // Load settings
  useEffect(() => {
    (supabase as any)
      .from('attendance_settings')
      .select('*')
      .eq('id', 1)
      .single()
      .then(({ data }: any) => { if (data) setSettings(data as AttendanceSettings); });
  }, []);

  useEffect(() => { void loadDevices(); }, [loadDevices]);
  useEffect(() => { void loadRecords(); void loadLastSync(); }, [loadRecords, loadLastSync]);

  // Build per-employee summaries
  const employeesByDevice = useMemo<Record<string, EmployeeSummary[]>>(() => {
    const out: Record<string, EmployeeSummary[]> = {};
    for (const [serial, records] of Object.entries(recordsByDevice)) {
      const byEmployee = new Map<string, { meta: any; punches: Punch[] }>();
      for (const r of records) {
        const key: string = r.employee_id;
        if (!byEmployee.has(key)) {
          byEmployee.set(key, { meta: r, punches: [] });
        }
        byEmployee.get(key)!.punches.push({
          time: new Date(r.punch_at),
          deviceSerial: r.device_serial,
        });
      }

      const summaries: EmployeeSummary[] = [];
      for (const [empId, { meta, punches }] of byEmployee) {
        punches.sort((a, b) => a.time.getTime() - b.time.getTime());
        const slots = mapPunchesToSlots(punches);
        summaries.push({
          employeeId: empId,
          name: meta.full_name || `${meta.first_name ?? ''} ${meta.last_name ?? ''}`.trim() || `Employee ${empId}`,
          department: meta.department,
          slots,
          firstPunchIso: punches[0].time.toISOString(),
          punchCount: punches.length,
        });
      }
      out[serial] = summaries;
    }
    return out;
  }, [recordsByDevice]);

  const isLate = useCallback((firstPunchIso: string): boolean => {
    return computeLateMinutes(
      new Date(firstPunchIso),
      settings.work_start_time,
      settings.grace_period_minutes,
      {
        enabled: Boolean(settings.saturday_enabled),
        startTime: settings.saturday_work_start_time ?? null,
        graceMinutes: settings.saturday_grace_minutes ?? null,
      },
    ) > 0;
  }, [settings]);

  const computeStats = useCallback((employees: EmployeeSummary[], date: string) => {
    const today   = getTodayBotswana();
    const isToday = date === today;
    const total        = employees.length;
    const checkedOut   = employees.filter(e => e.punchCount % 2 === 0).length;
    const stillIn      = employees.filter(e => e.punchCount % 2 !== 0 && isToday).length;
    const missedPunch  = employees.filter(e => e.punchCount % 2 !== 0 && !isToday).length;
    const late         = employees.filter(e => isLate(e.firstPunchIso)).length;
    return { total, checkedOut, stillIn, missedPunch, late };
  }, [isLate]);

  const activeEmployees = activeDevice
    ? (employeesByDevice[activeDevice.device_serial] ?? [])
    : [];
  const activeStats = useMemo(
    () => computeStats(activeEmployees, selectedDate),
    [activeEmployees, computeStats, selectedDate],
  );

  if (!can('attendance', 'read')) {
    return (
      <>
        <div className="page-header">
          <div><div className="page-title">Live Dashboard</div></div>
        </div>
        <div className="card" style={{ padding: 32, textAlign: 'center', color: 'var(--text2)' }}>
          You do not have permission to view attendance.
        </div>
      </>
    );
  }

  return (
    <>
      {/* Header */}
      <div className="page-header">
        <div>
          <div className="page-title">Live Dashboard</div>
          <div className="page-sub">
            <i className="fa-solid fa-database" style={{ marginRight: 4 }} />
            Sourced from Hik-Connect daily reports
            {lastSyncAt && ` · Last sync: ${fmtTimestamp(lastSyncAt)}`}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="date"
            className="form-input"
            style={{ width: 160 }}
            value={selectedDate}
            onChange={e => setSelectedDate(e.target.value)}
          />
          <button
            className="btn btn-primary btn-sm"
            onClick={() => { void loadRecords(); void loadLastSync(); }}
            disabled={loading}
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="card" style={{ padding: '12px 16px', background: 'rgba(207,34,46,0.06)', border: '1px solid rgba(207,34,46,0.25)', marginBottom: 12 }}>
          <i className="fa-solid fa-circle-exclamation" style={{ color: '#cf222e', marginRight: 8 }} />
          <span style={{ color: '#cf222e' }}>{error}</span>
        </div>
      )}

      {/* No devices */}
      {!devices.length && !error && (
        <div className="card" style={{ padding: 32, textAlign: 'center', color: 'var(--text2)' }}>
          No devices yet. The first daily report from Hik-Connect will auto-register them.
        </div>
      )}

      {/* Device tabs */}
      {devices.length > 0 && (
        <div style={{ display: 'flex', gap: 4, marginBottom: 12, borderBottom: '1px solid var(--border)', overflowX: 'auto' }}>
          {devices.map(device => {
            const employees = employeesByDevice[device.device_serial] ?? [];
            const s = computeStats(employees, selectedDate);
            const isActive = device.id === activeDevice?.id;
            return (
              <button
                key={device.id}
                onClick={() => setActiveDeviceId(device.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '10px 16px', fontWeight: 500, whiteSpace: 'nowrap',
                  borderBottom: `2px solid ${isActive ? 'var(--primary)' : 'transparent'}`,
                  color: isActive ? 'var(--primary)' : 'var(--text2)',
                  background: 'none', border: 'none', borderBottom: `2px solid ${isActive ? 'var(--primary)' : 'transparent'}`,
                  cursor: 'pointer', fontSize: 14,
                }}
              >
                {device.device_name ?? device.device_serial}
                <span className={isActive ? 'badge badge-active' : 'badge badge-fail'} style={{ fontSize: 11 }}>
                  {s.total} present
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Active device header */}
      {activeDevice && (
        <div className="card" style={{ padding: '12px 16px', marginBottom: 12 }}>
          <div style={{ fontWeight: 600, fontSize: 15 }}>{activeDevice.device_name}</div>
          <div style={{ display: 'flex', gap: 16, marginTop: 4, fontSize: 12, color: 'var(--text2)' }}>
            {activeDevice.location && (
              <span><i className="fa-solid fa-location-dot" style={{ marginRight: 4 }} />{activeDevice.location}</span>
            )}
            <span style={{ fontFamily: 'monospace' }}>Serial: {activeDevice.device_serial}</span>
            {selectedDate && (
              <span><i className="fa-solid fa-calendar" style={{ marginRight: 4 }} />Showing {selectedDate}</span>
            )}
          </div>
        </div>
      )}

      {/* Summary stats */}
      {activeDevice && (
        <div className="stat-grid" style={{ marginBottom: 12 }}>
          <div className="stat-card">
            <div className="stat-icon" style={{ background: 'rgba(37,99,235,0.13)', color: '#2563eb' }}>
              <i className="fa-solid fa-users" />
            </div>
            <div><div className="stat-val">{activeStats.total}</div><div className="stat-label">Total Present</div></div>
          </div>
          <div className="stat-card">
            <div className="stat-icon" style={{ background: 'rgba(100,116,139,0.13)', color: '#64748b' }}>
              <i className="fa-solid fa-right-from-bracket" />
            </div>
            <div><div className="stat-val">{activeStats.checkedOut}</div><div className="stat-label">Checked Out</div></div>
          </div>
          <div className="stat-card">
            <div className="stat-icon" style={{ background: 'rgba(212,146,10,0.13)', color: '#d4920a' }}>
              <i className="fa-solid fa-triangle-exclamation" />
            </div>
            <div><div className="stat-val" style={{ color: '#d4920a' }}>{activeStats.missedPunch}</div><div className="stat-label">Missed Punch</div></div>
          </div>
          <div className="stat-card">
            <div className="stat-icon" style={{ background: 'rgba(207,34,46,0.13)', color: '#cf222e' }}>
              <i className="fa-solid fa-clock" />
            </div>
            <div><div className="stat-val" style={{ color: '#cf222e' }}>{activeStats.late}</div><div className="stat-label">Late Arrivals</div></div>
          </div>
        </div>
      )}

      {/* Employee table */}
      {activeDevice && (
        <div className="card" style={{ padding: 0, marginBottom: 12 }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', fontWeight: 600, fontSize: 13 }}>
            Attendance — {activeDevice.device_name} — {selectedDate}
          </div>
          {activeEmployees.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--text2)' }}>
              {loading ? 'Loading…' : 'No attendance records for this date.'}
            </div>
          ) : (
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
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {activeEmployees.map(e => {
                    const late = isLate(e.firstPunchIso);
                    const { label: statusLabel, badgeClass } = getEmployeeStatus(e.punchCount, selectedDate);
                    const { slots } = e;
                    return (
                      <tr key={e.employeeId}>
                        <td>
                          <div className="td-name">{e.name}</div>
                          <div style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'monospace' }}>#{e.employeeId}</div>
                        </td>
                        <td>{e.department ?? '—'}</td>
                        <td style={{ fontFamily: 'monospace' }}>
                          {fmtSlot(slots.morningIn)}
                          {late && <span style={{ marginLeft: 6, fontSize: 11, color: '#cf222e' }}>late</span>}
                        </td>
                        <td style={{ fontFamily: 'monospace' }}>{fmtSlot(slots.lunchOut)}</td>
                        <td style={{ fontFamily: 'monospace' }}>{fmtSlot(slots.lunchIn)}</td>
                        <td style={{ fontFamily: 'monospace' }}>{fmtSlot(slots.eveningOut)}</td>
                        <td><span className={badgeClass}>{statusLabel}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* All branches summary */}
      {devices.length > 0 && (
        <div className="card">
          <div className="card-title">All Branches — {selectedDate}</div>
          <div className="stat-grid">
            {devices.map(device => {
              const employees = employeesByDevice[device.device_serial] ?? [];
              const s = computeStats(employees, selectedDate);
              return (
                <div
                  key={device.id}
                  className="stat-card"
                  onClick={() => setActiveDeviceId(device.id)}
                  style={{ cursor: 'pointer', flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}
                >
                  <div style={{ fontWeight: 600 }}>{device.device_name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text2)' }}>{device.location ?? device.device_serial}</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px', fontSize: 13 }}>
                    <span><strong style={{ color: '#2563eb' }}>{s.total}</strong> Present</span>
                    <span><strong>{s.checkedOut}</strong> Out</span>
                    <span><strong style={{ color: '#d4920a' }}>{s.missedPunch}</strong> Missed</span>
                    <span><strong style={{ color: '#cf222e' }}>{s.late}</strong> Late</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
