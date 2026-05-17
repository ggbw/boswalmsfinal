import { useState, useEffect } from 'react';
import { Download } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useApp } from '@/context/AppContext';
import { useUserRole } from '@/hooks/hr/useUserRole';

// ─── Types ────────────────────────────────────────────────────────────────────

interface RawRecord {
  id: number;
  device_serial: string;
  employee_id: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  department: string | null;
  punch_at: string;
  punch_date: string;
  punch_time: string;
  punch_state: string | null;
  weekday: string | null;
  device_name: string | null;
  data_source: string | null;
  imported_at: string | null;
}

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

function fmtDate(s: string): string {
  return new Date(s + 'T00:00:00').toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

function displayName(r: RawRecord): string {
  return r.full_name || `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim() || `ID ${r.employee_id}`;
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function HRAttendanceRecordsPage() {
  const { toast } = useApp();
  const { can }   = useUserRole();

  const today         = new Date().toISOString().slice(0, 10);
  const firstOfMonth  = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
    .toISOString().slice(0, 10);

  const [fromDate, setFromDate]       = useState(firstOfMonth);
  const [toDate, setToDate]           = useState(today);
  const [search, setSearch]           = useState('');
  const [deviceFilter, setDeviceFilter] = useState('all');
  const [records, setRecords]         = useState<RawRecord[]>([]);
  const [devices, setDevices]         = useState<string[]>([]);
  const [loading, setLoading]         = useState(false);

  const refetch = async () => {
    setLoading(true);
    const { data, error } = await (supabase as any)
      .from('attendance_records')
      .select('id,device_serial,employee_id,first_name,last_name,full_name,department,punch_at,punch_date,punch_time,punch_state,weekday,device_name,data_source,imported_at')
      .gte('punch_date', fromDate)
      .lte('punch_date', toDate)
      .order('punch_at', { ascending: false });

    if (error) {
      toast(error.message, 'error');
      setLoading(false);
      return;
    }

    const rows = (data ?? []) as RawRecord[];
    setRecords(rows);
    const uniqueDevices = [...new Set(rows.map(r => r.device_serial).filter(Boolean))].sort();
    setDevices(uniqueDevices);
    setLoading(false);
  };

  useEffect(() => { void refetch(); }, [fromDate, toDate]);

  const filtered = records.filter(r => {
    if (deviceFilter !== 'all' && r.device_serial !== deviceFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      const name = displayName(r).toLowerCase();
      if (!name.includes(q) && !r.employee_id.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const exportCsv = () => {
    const headers = ['Date', 'Time', 'Employee', 'Employee ID', 'Department', 'Punch State', 'Weekday', 'Device', 'Source', 'Imported At'];
    const csvRows = filtered.map(r => [
      fmtDate(r.punch_date),
      fmtTime(r.punch_at),
      displayName(r),
      r.employee_id,
      r.department ?? '',
      r.punch_state ?? '',
      r.weekday ?? '',
      r.device_name ?? r.device_serial,
      r.data_source ?? '',
      r.imported_at ? fmtTime(r.imported_at) : '',
    ].map(v => `"${v}"`).join(','));
    const blob = new Blob([[headers.join(','), ...csvRows].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `raw_punches_${fromDate}_${toDate}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  if (!can('attendance', 'read')) {
    return (
      <>
        <div className="page-header">
          <div><div className="page-title">Raw Punches</div></div>
        </div>
        <div className="card" style={{ padding: 32, textAlign: 'center', color: 'var(--text2)' }}>
          You do not have permission to view attendance records.
        </div>
      </>
    );
  }

  return (
    <>
      {/* Header */}
      <div className="page-header">
        <div>
          <div className="page-title">Raw Punches</div>
          <div className="page-sub">HR Management · {filtered.length} records</div>
        </div>
        <button className="btn btn-outline btn-sm" onClick={exportCsv}>
          <Download size={14} /> Export CSV
        </button>
      </div>

      {/* Filters */}
      <div className="card" style={{ padding: '12px 16px', marginBottom: 12 }}>
        <div className="form-row cols3">
          <div className="form-group">
            <label>From</label>
            <input
              type="date"
              className="form-input"
              value={fromDate}
              onChange={e => setFromDate(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label>To</label>
            <input
              type="date"
              className="form-input"
              value={toDate}
              onChange={e => setToDate(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label>Device</label>
            <select className="form-select" value={deviceFilter} onChange={e => setDeviceFilter(e.target.value)}>
              <option value="all">All Devices</option>
              {devices.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
        </div>
        <div className="form-group" style={{ marginTop: 8 }}>
          <input
            className="form-input"
            placeholder="Search name / employee ID…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Summary bar */}
      <div className="card" style={{ padding: '10px 16px', marginBottom: 12, display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13 }}>
        <span>Total Records: <strong>{filtered.length}</strong></span>
        <span style={{ color: 'var(--border)' }}>|</span>
        <span>Unique Employees: <strong>{new Set(filtered.map(r => r.employee_id)).size}</strong></span>
        <span style={{ color: 'var(--border)' }}>|</span>
        <span>Devices: <strong>{new Set(filtered.map(r => r.device_serial)).size}</strong></span>
      </div>

      {/* Table */}
      <div className="card" style={{ padding: 0 }}>
        {loading ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text2)' }}>Loading…</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Time</th>
                  <th>Employee</th>
                  <th>Emp ID</th>
                  <th>Department</th>
                  <th>Punch State</th>
                  <th>Weekday</th>
                  <th>Device</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => (
                  <tr key={r.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(r.punch_date)}</td>
                    <td style={{ fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{fmtTime(r.punch_at)}</td>
                    <td>
                      <div className="td-name">{displayName(r)}</div>
                    </td>
                    <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{r.employee_id}</td>
                    <td>{r.department ?? <em style={{ color: 'var(--text3)' }}>—</em>}</td>
                    <td>
                      {r.punch_state
                        ? <span className="badge badge-pending">{r.punch_state}</span>
                        : <em style={{ color: 'var(--text3)' }}>—</em>}
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--text2)' }}>{r.weekday ?? '—'}</td>
                    <td style={{ fontSize: 12 }}>{r.device_name ?? r.device_serial}</td>
                    <td style={{ fontSize: 12, color: 'var(--text2)' }}>{r.data_source ?? '—'}</td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={9} style={{ padding: 32, textAlign: 'center', color: 'var(--text2)' }}>
                      No records found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
