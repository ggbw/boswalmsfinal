import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { useUserRole } from '@/hooks/hr/useUserRole';
import { useEmployees } from '@/hooks/hr/useEmployees';
import { fmtDate } from '@/lib/hr/leaveUtils';
import { supabase } from '@/integrations/supabase/client';

interface AttendanceRecord {
  id: string;
  employee_id: string | null;
  attendance_date: string;
  check_in: string | null;
  check_out: string | null;
  hours_worked: number | null;
  status: 'present' | 'absent' | 'leave' | 'half-day';
  notes: string | null;
  created_at: string;
}

interface RecordWithEmployee extends AttendanceRecord {
  employee_name?: string | null;
  employee_code?: string | null;
}

const statusBadge = (s: string): string => {
  if (s === 'present') return 'badge badge-active';
  if (s === 'half-day') return 'badge badge-pending';
  if (s === 'leave') return 'badge badge-pass';
  return 'badge badge-fail';
};

const calcHours = (checkIn: string | null, checkOut: string | null): number | null => {
  if (!checkIn || !checkOut) return null;
  const [h1, m1] = checkIn.split(':').map(Number);
  const [h2, m2] = checkOut.split(':').map(Number);
  const minutes = (h2 - h1) * 60 + (m2 - m1);
  if (minutes <= 0) return null;
  return Math.round((minutes / 60) * 100) / 100;
};

export default function HRAttendancePage() {
  const { toast } = useApp();
  const { can } = useUserRole();
  const { employees } = useEmployees();
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [records, setRecords] = useState<RecordWithEmployee[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    employee_id: '',
    attendance_date: today,
    check_in: '',
    check_out: '',
    status: 'present' as AttendanceRecord['status'],
    notes: '',
  });

  const writeOk = can('attendance', 'write');

  const refetch = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('hr_attendance')
      .select('*, employees(employee_name, employee_code)')
      .eq('attendance_date', date)
      .order('check_in', { ascending: true, nullsFirst: false });
    if (error) toast(error.message, 'error');
    else
      setRecords(((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
        ...(r as unknown as AttendanceRecord),
        employee_name: (r.employees as { employee_name?: string } | null)?.employee_name ?? null,
        employee_code: (r.employees as { employee_code?: string } | null)?.employee_code ?? null,
      })));
    setLoading(false);
  }, [date, toast]);

  useEffect(() => { void refetch(); }, [refetch]);

  const handleCreate = async () => {
    if (!form.employee_id) { toast('Select employee', 'error'); return; }
    const hours = calcHours(form.check_in || null, form.check_out || null);
    const { error } = await supabase.from('hr_attendance').insert({
      employee_id: form.employee_id,
      attendance_date: form.attendance_date,
      check_in: form.check_in || null,
      check_out: form.check_out || null,
      hours_worked: hours,
      status: form.status,
      notes: form.notes.trim() || null,
    });
    if (error) { toast(error.message, 'error'); return; }
    toast('Attendance recorded', 'success');
    setForm({ ...form, employee_id: '', check_in: '', check_out: '', notes: '' });
    setCreating(false);
    void refetch();
  };

  const handleDelete = async (r: RecordWithEmployee) => {
    if (!window.confirm('Delete this record?')) return;
    const { error } = await supabase.from('hr_attendance').delete().eq('id', r.id);
    if (error) { toast(error.message, 'error'); return; }
    toast('Record deleted', 'info');
    void refetch();
  };

  const stats = useMemo(() => ({
    total: records.length,
    present: records.filter((r) => r.status === 'present').length,
    halfDay: records.filter((r) => r.status === 'half-day').length,
    onLeave: records.filter((r) => r.status === 'leave').length,
    absent: records.filter((r) => r.status === 'absent').length,
  }), [records]);

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Attendance</div>
          <div className="page-sub">HR Management · {fmtDate(date)}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input type="date" className="form-input" style={{ width: 160 }} value={date} onChange={(e) => setDate(e.target.value)} />
          {writeOk && (
            <button className="btn btn-primary btn-sm" onClick={() => setCreating((c) => !c)}>
              <i className="fa-solid fa-plus" /> {creating ? 'Cancel' : 'Add Record'}
            </button>
          )}
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(37,99,235,0.13)', color: '#2563eb' }}>
            <i className="fa-solid fa-clipboard-list" />
          </div>
          <div><div className="stat-val">{stats.total}</div><div className="stat-label">Records</div></div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(26,127,55,0.13)', color: '#1a7f37' }}>
            <i className="fa-solid fa-check" />
          </div>
          <div><div className="stat-val" style={{ color: '#1a7f37' }}>{stats.present}</div><div className="stat-label">Present</div></div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(212,146,10,0.13)', color: '#d4920a' }}>
            <i className="fa-solid fa-clock-rotate-left" />
          </div>
          <div><div className="stat-val" style={{ color: '#d4920a' }}>{stats.halfDay}</div><div className="stat-label">Half Day</div></div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(37,99,235,0.13)', color: '#2563eb' }}>
            <i className="fa-solid fa-umbrella-beach" />
          </div>
          <div><div className="stat-val" style={{ color: '#2563eb' }}>{stats.onLeave}</div><div className="stat-label">On Leave</div></div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(207,34,46,0.13)', color: '#cf222e' }}>
            <i className="fa-solid fa-xmark" />
          </div>
          <div><div className="stat-val" style={{ color: '#cf222e' }}>{stats.absent}</div><div className="stat-label">Absent</div></div>
        </div>
      </div>

      {creating && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-title"><span>Add Attendance Record</span></div>
          <div className="form-row cols3">
            <div className="form-group">
              <label>Employee *</label>
              <select className="form-select" value={form.employee_id} onChange={(e) => setForm({ ...form, employee_id: e.target.value })}>
                <option value="">— Select —</option>
                {employees.map((e) => <option key={e.id} value={e.id}>{e.employee_name} ({e.employee_code})</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Date</label>
              <input type="date" className="form-input" value={form.attendance_date} onChange={(e) => setForm({ ...form, attendance_date: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Status</label>
              <select className="form-select" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as AttendanceRecord['status'] })}>
                <option value="present">Present</option>
                <option value="half-day">Half-day</option>
                <option value="leave">On Leave</option>
                <option value="absent">Absent</option>
              </select>
            </div>
          </div>
          <div className="form-row cols2">
            <div className="form-group">
              <label>Check-in</label>
              <input type="time" className="form-input" value={form.check_in} onChange={(e) => setForm({ ...form, check_in: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Check-out</label>
              <input type="time" className="form-input" value={form.check_out} onChange={(e) => setForm({ ...form, check_out: e.target.value })} />
            </div>
          </div>
          <div className="form-group">
            <label>Notes</label>
            <input className="form-input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
          <div style={{ textAlign: 'right' }}>
            <button className="btn btn-primary btn-sm" onClick={() => void handleCreate()}>
              <i className="fa-solid fa-floppy-disk" /> Save
            </button>
          </div>
        </div>
      )}

      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid var(--border)', fontSize: 13, fontWeight: 600 }}>
          Attendance for {fmtDate(date)}
        </div>
        {loading ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text2)' }}>Loading…</div>
        ) : records.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text2)' }}>No records for this date.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Check-in</th>
                  <th>Check-out</th>
                  <th>Hours</th>
                  <th>Status</th>
                  <th>Notes</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <div className="td-name">{r.employee_name ?? '—'}</div>
                      <div style={{ fontSize: 10, color: 'var(--text3)' }}>{r.employee_code}</div>
                    </td>
                    <td style={{ fontFamily: 'JetBrains Mono, monospace' }}>{r.check_in ?? '—'}</td>
                    <td style={{ fontFamily: 'JetBrains Mono, monospace' }}>{r.check_out ?? '—'}</td>
                    <td>{r.hours_worked ?? '—'}</td>
                    <td><span className={statusBadge(r.status)}>{r.status}</span></td>
                    <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.notes ?? ''}>{r.notes ?? '—'}</td>
                    <td style={{ textAlign: 'right' }}>
                      {writeOk && (
                        <button className="btn btn-danger btn-sm" onClick={() => void handleDelete(r)}>
                          <i className="fa-solid fa-trash" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
