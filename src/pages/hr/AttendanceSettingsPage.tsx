/**
 * Attendance configuration page (Phase 5 — scoped).
 *
 * Edits the singleton `attendance_settings` row and shows the registered
 * biometric devices from `attendance_devices`. These two tables are added by
 * migration 20260514000004_attendance_devices_and_settings.sql.
 *
 * Device registration itself is intentionally read-only here — devices are
 * meant to be added by the sync edge function on first contact, not typed in
 * by hand. The "Add device manually" affordance is a small admin convenience
 * for environments without a working sync function yet.
 */

import { useCallback, useEffect, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { useUserRole } from '@/hooks/hr/useUserRole';
import { supabase } from '@/integrations/supabase/client';
import { fetchHikConnectAttendance } from '@/lib/hr/hikvisionService';

interface AttendanceSettings {
  id: number;
  work_start_time: string;
  grace_period_minutes: number;
  saturday_enabled?: boolean | null;
  saturday_work_start_time?: string | null;
  saturday_grace_minutes?: number | null;
  updated_at: string | null;
}

interface AttendanceDevice {
  id: number;
  device_serial: string;
  device_name: string | null;
  location: string | null;
  is_active: boolean;
  first_seen: string | null;
  last_seen: string | null;
  last_sync: string | null;
  api_key: string | null;
}

const fmtDateTime = (s: string | null): string => {
  if (!s) return '—';
  try {
    return new Date(s).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return s;
  }
};

export default function AttendanceSettingsPage() {
  const { toast, navigate } = useApp();
  const { can } = useUserRole();
  const writeOk = can('attendance', 'write');

  const [settings, setSettings] = useState<AttendanceSettings | null>(null);
  const [devices, setDevices] = useState<AttendanceDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [workStartTime, setWorkStartTime] = useState('08:00');
  const [graceMinutes, setGraceMinutes] = useState(15);
  const [satEnabled, setSatEnabled] = useState(false);
  const [satStartTime, setSatStartTime] = useState('08:00');
  const [satGraceMinutes, setSatGraceMinutes] = useState(15);

  // Add-device form
  const [addingDevice, setAddingDevice] = useState(false);
  const [deviceForm, setDeviceForm] = useState({ device_serial: '', device_name: '', location: '', api_key: '' });

  // Inline edit state — tracks which device row is being edited
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ device_name: '', location: '', api_key: '' });
  const [syncingId, setSyncingId] = useState<number | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    const [{ data: sett }, { data: devs }] = await Promise.all([
      supabase.from('attendance_settings').select('*').eq('id', 1).maybeSingle(),
      supabase.from('attendance_devices').select('*').order('device_serial'),
    ]);
    const s = (sett as AttendanceSettings | null) ?? null;
    setSettings(s);
    if (s) {
      setWorkStartTime(s.work_start_time);
      setGraceMinutes(s.grace_period_minutes);
      setSatEnabled(Boolean(s.saturday_enabled));
      setSatStartTime(s.saturday_work_start_time ?? s.work_start_time);
      setSatGraceMinutes(s.saturday_grace_minutes ?? s.grace_period_minutes);
    }
    setDevices((devs ?? []) as AttendanceDevice[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const handleSaveSettings = async () => {
    setSaving(true);
    const payload: Record<string, unknown> = {
      id: 1,
      work_start_time: workStartTime,
      grace_period_minutes: graceMinutes,
      saturday_enabled: satEnabled,
      saturday_work_start_time: satEnabled ? satStartTime : null,
      saturday_grace_minutes: satEnabled ? satGraceMinutes : null,
      updated_at: new Date().toISOString(),
    };
    // Falls back gracefully on databases that haven't applied the Saturday
    // columns migration yet: retry stripping the unknown columns.
    let attempt: Record<string, unknown> = payload;
    let { error } = await supabase.from('attendance_settings').upsert(attempt as never, { onConflict: 'id' });
    for (let i = 0; i < 4 && error; i++) {
      const match = /column\s+"?([a-z_]+)"?\s+of\s+relation|could\s+not\s+find\s+the\s+'([a-z_]+)'\s+column/i.exec(error.message);
      const missing = match?.[1] ?? match?.[2];
      if (!missing || !(missing in attempt)) break;
      const next = { ...attempt };
      delete next[missing];
      attempt = next;
      ({ error } = await supabase.from('attendance_settings').upsert(attempt as never, { onConflict: 'id' }));
    }
    setSaving(false);
    if (error) { toast(error.message, 'error'); return; }
    toast('Attendance settings saved', 'success');
    void refetch();
  };

  const handleAddDevice = async () => {
    const serial = deviceForm.device_serial.trim();
    if (!serial) { toast('Device serial is required', 'error'); return; }
    const { error } = await supabase.from('attendance_devices').insert({
      device_serial: serial,
      device_name: deviceForm.device_name.trim() || null,
      location: deviceForm.location.trim() || null,
      api_key: deviceForm.api_key.trim() || null,
      is_active: true,
    });
    if (error) { toast(error.message, 'error'); return; }
    toast(`Device ${serial} added`, 'success');
    setDeviceForm({ device_serial: '', device_name: '', location: '', api_key: '' });
    setAddingDevice(false);
    void refetch();
  };

  const startEdit = (d: AttendanceDevice) => {
    setEditingId(d.id);
    setEditForm({ device_name: d.device_name ?? '', location: d.location ?? '', api_key: d.api_key ?? '' });
  };

  const handleSaveEdit = async (d: AttendanceDevice) => {
    const { error } = await supabase
      .from('attendance_devices')
      .update({
        device_name: editForm.device_name.trim() || null,
        location: editForm.location.trim() || null,
        api_key: editForm.api_key.trim() || null,
      })
      .eq('id', d.id);
    if (error) { toast(error.message, 'error'); return; }
    toast('Device updated', 'success');
    setEditingId(null);
    void refetch();
  };

  const handleSyncDevice = async (d: AttendanceDevice) => {
    setSyncingId(d.id);
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const startTime = `${today}T00:00:00Z`;
    const endTime = now.toISOString();
    const result = await fetchHikConnectAttendance(d.device_serial, startTime, endTime);
    setSyncingId(null);
    if (result.success) {
      toast(`Synced ${(result as { inserted?: number }).inserted ?? 0} new records from ${d.device_serial}`, 'success');
      void refetch();
    } else {
      toast(result.message || 'Sync failed', 'error');
    }
  };

  const handleToggleDevice = async (d: AttendanceDevice) => {
    const { error } = await supabase
      .from('attendance_devices')
      .update({ is_active: !d.is_active })
      .eq('id', d.id);
    if (error) { toast(error.message, 'error'); return; }
    toast(`Device ${d.device_serial} ${d.is_active ? 'deactivated' : 'activated'}`, 'info');
    void refetch();
  };

  if (loading) {
    return <div className="card" style={{ padding: 32, textAlign: 'center', color: 'var(--text2)' }}>Loading…</div>;
  }

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Attendance Settings</div>
          <div className="page-sub">HR Management · Device registry &amp; late-detection</div>
        </div>
        <button className="btn btn-outline btn-sm" onClick={() => navigate('hr-attendance-report')}>
          <i className="fa-solid fa-arrow-left" /> Back to Attendance
        </button>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title"><span>Work Hours &amp; Late Detection</span></div>
        <p style={{ fontSize: 11, color: 'var(--text2)', marginTop: -4, marginBottom: 12 }}>
          Punches arriving more than the grace period after the work start time are flagged late on attendance reports.
        </p>
        <div className="form-row cols2">
          <div className="form-group">
            <label>Work Start Time</label>
            <input
              type="time"
              className="form-input"
              disabled={!writeOk}
              value={workStartTime}
              onChange={(e) => setWorkStartTime(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label>Grace Period (minutes)</label>
            <input
              type="number"
              min={0}
              max={120}
              className="form-input"
              disabled={!writeOk}
              value={graceMinutes}
              onChange={(e) => setGraceMinutes(Math.max(0, Number(e.target.value) || 0))}
            />
          </div>
        </div>

        <div style={{ borderTop: '1px dashed var(--border)', paddingTop: 12, marginTop: 4 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 600, marginBottom: 8 }}>
            <input
              type="checkbox"
              disabled={!writeOk}
              checked={satEnabled}
              onChange={(e) => setSatEnabled(e.target.checked)}
            />
            Treat Saturday as a workday (use these times for Saturday punches)
          </label>
          {satEnabled && (
            <div className="form-row cols2">
              <div className="form-group">
                <label>Saturday Work Start Time</label>
                <input
                  type="time"
                  className="form-input"
                  disabled={!writeOk}
                  value={satStartTime}
                  onChange={(e) => setSatStartTime(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>Saturday Grace Period (minutes)</label>
                <input
                  type="number"
                  min={0}
                  max={120}
                  className="form-input"
                  disabled={!writeOk}
                  value={satGraceMinutes}
                  onChange={(e) => setSatGraceMinutes(Math.max(0, Number(e.target.value) || 0))}
                />
              </div>
            </div>
          )}
          {!satEnabled && (
            <div style={{ fontSize: 11, color: 'var(--text3)' }}>
              Saturday punches won't be flagged late while Saturday is disabled.
            </div>
          )}
        </div>

        {settings?.updated_at && (
          <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 8 }}>
            Last updated: {fmtDateTime(settings.updated_at)}
          </div>
        )}
        {writeOk && (
          <div style={{ textAlign: 'right' }}>
            <button className="btn btn-primary btn-sm" onClick={() => void handleSaveSettings()} disabled={saving}>
              <i className="fa-solid fa-floppy-disk" /> {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        )}
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div
          style={{
            padding: '16px 20px 12px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 600 }}>
            Registered Devices
            <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text2)', fontWeight: 400 }}>
              · {devices.length} {devices.length === 1 ? 'device' : 'devices'}
            </span>
          </div>
          {writeOk && (
            <button className="btn btn-primary btn-sm" onClick={() => setAddingDevice((c) => !c)}>
              <i className="fa-solid fa-plus" /> {addingDevice ? 'Cancel' : 'Add Device'}
            </button>
          )}
        </div>
        {addingDevice && (
          <div style={{ padding: 16, borderBottom: '1px solid var(--border)' }}>
            <div className="form-row cols3">
              <div className="form-group">
                <label>Serial *</label>
                <input
                  className="form-input"
                  value={deviceForm.device_serial}
                  onChange={(e) => setDeviceForm({ ...deviceForm, device_serial: e.target.value })}
                  placeholder="e.g. DS-K1T804AMF-..."
                />
              </div>
              <div className="form-group">
                <label>Name</label>
                <input
                  className="form-input"
                  value={deviceForm.device_name}
                  onChange={(e) => setDeviceForm({ ...deviceForm, device_name: e.target.value })}
                  placeholder="Main Entrance"
                />
              </div>
              <div className="form-group">
                <label>Location</label>
                <input
                  className="form-input"
                  value={deviceForm.location}
                  onChange={(e) => setDeviceForm({ ...deviceForm, location: e.target.value })}
                  placeholder="Reception"
                />
              </div>
            </div>
            <div className="form-group">
              <label>API Key <span style={{ fontWeight: 400, color: 'var(--text2)' }}>(optional — Hik-Connect bearer token for this device)</span></label>
              <input
                className="form-input"
                type="password"
                value={deviceForm.api_key}
                onChange={(e) => setDeviceForm({ ...deviceForm, api_key: e.target.value })}
                placeholder="Leave blank to use global HIK_CONNECT credentials"
                autoComplete="new-password"
              />
            </div>
            <div style={{ textAlign: 'right' }}>
              <button className="btn btn-primary btn-sm" onClick={() => void handleAddDevice()}>
                <i className="fa-solid fa-check" /> Add
              </button>
            </div>
          </div>
        )}
        {devices.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text2)' }}>
            No devices registered yet.
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Serial</th>
                  <th>Name</th>
                  <th>Location</th>
                  <th>API Key</th>
                  <th>Last Seen</th>
                  <th>Last Sync</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {devices.map((d) => {
                  const isEditing = editingId === d.id;
                  return (
                    <tr key={d.id}>
                      <td style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>{d.device_serial}</td>
                      <td>
                        {isEditing ? (
                          <input
                            className="form-input"
                            style={{ minWidth: 120 }}
                            value={editForm.device_name}
                            onChange={(e) => setEditForm({ ...editForm, device_name: e.target.value })}
                          />
                        ) : (d.device_name ?? '—')}
                      </td>
                      <td>
                        {isEditing ? (
                          <input
                            className="form-input"
                            style={{ minWidth: 100 }}
                            value={editForm.location}
                            onChange={(e) => setEditForm({ ...editForm, location: e.target.value })}
                          />
                        ) : (d.location ?? '—')}
                      </td>
                      <td>
                        {isEditing ? (
                          <input
                            className="form-input"
                            type="password"
                            style={{ minWidth: 160 }}
                            value={editForm.api_key}
                            onChange={(e) => setEditForm({ ...editForm, api_key: e.target.value })}
                            placeholder="Enter key (blank = keep current)"
                            autoComplete="new-password"
                          />
                        ) : (
                          d.api_key
                            ? <span className="badge badge-active" title="API key set"><i className="fa-solid fa-key" /> Set</span>
                            : <span style={{ color: 'var(--text3)', fontSize: 11 }}>Global creds</span>
                        )}
                      </td>
                      <td style={{ fontSize: 11 }}>{fmtDateTime(d.last_seen)}</td>
                      <td style={{ fontSize: 11 }}>{fmtDateTime(d.last_sync)}</td>
                      <td>
                        <span className={`badge ${d.is_active ? 'badge-active' : 'badge-fail'}`}>
                          {d.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {writeOk && (
                          <div style={{ display: 'inline-flex', gap: 6 }}>
                            {isEditing ? (
                              <>
                                <button
                                  className="btn btn-primary btn-sm"
                                  onClick={() => void handleSaveEdit(d)}
                                >
                                  <i className="fa-solid fa-check" /> Save
                                </button>
                                <button
                                  className="btn btn-outline btn-sm"
                                  onClick={() => setEditingId(null)}
                                >
                                  Cancel
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  className="btn btn-primary btn-sm"
                                  disabled={syncingId === d.id || !d.is_active}
                                  onClick={() => void handleSyncDevice(d)}
                                  data-testid={`device-sync-${d.id}`}
                                >
                                  <i className={`fa-solid ${syncingId === d.id ? 'fa-spinner fa-spin' : 'fa-rotate'}`} />{' '}
                                  {syncingId === d.id ? 'Syncing…' : 'Sync Now'}
                                </button>
                                <button
                                  className="btn btn-outline btn-sm"
                                  onClick={() => startEdit(d)}
                                >
                                  <i className="fa-solid fa-pen" /> Edit
                                </button>
                                <button
                                  className={`btn btn-sm ${d.is_active ? 'btn-outline' : 'btn-outline'}`}
                                  onClick={() => void handleToggleDevice(d)}
                                >
                                  <i className={`fa-solid ${d.is_active ? 'fa-toggle-on' : 'fa-toggle-off'}`} />{' '}
                                  {d.is_active ? 'Deactivate' : 'Activate'}
                                </button>
                              </>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
