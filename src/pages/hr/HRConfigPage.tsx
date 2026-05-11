import { useCallback, useEffect, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { useUserRole } from '@/hooks/hr/useUserRole';
import { supabase } from '@/integrations/supabase/client';
import { fmtDate } from '@/lib/hr/leaveUtils';

interface Holiday {
  id: string;
  name: string;
  date: string;
}

export default function HRConfigPage() {
  const { toast } = useApp();
  const { can } = useUserRole();
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: '', date: '' });

  const writeOk = can('departments', 'write');

  const refetch = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from('public_holidays').select('*').order('date');
    if (error) toast(error.message, 'error');
    else setHolidays((data ?? []) as Holiday[]);
    setLoading(false);
  }, [toast]);

  useEffect(() => { void refetch(); }, [refetch]);

  const handleAdd = async () => {
    if (!form.name.trim() || !form.date) { toast('Name and date are required', 'error'); return; }
    const { error } = await supabase.from('public_holidays').insert({
      name: form.name.trim(),
      date: form.date,
    });
    if (error) { toast(error.message, 'error'); return; }
    toast('Holiday added', 'success');
    setForm({ name: '', date: '' });
    void refetch();
  };

  const handleDelete = async (h: Holiday) => {
    if (!window.confirm(`Delete "${h.name}" on ${fmtDate(h.date)}?`)) return;
    const { error } = await supabase.from('public_holidays').delete().eq('id', h.id);
    if (error) { toast(error.message, 'error'); return; }
    toast(`${h.name} deleted`, 'info');
    void refetch();
  };

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">HR Configuration</div>
          <div className="page-sub">Public holidays and HR settings</div>
        </div>
      </div>

      <div className="two-col">
        <div className="card" style={{ padding: 0 }}>
          <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid var(--border)', fontSize: 13, fontWeight: 600 }}>
            Public Holidays
          </div>
          {loading ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--text2)' }}>Loading…</div>
          ) : holidays.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--text2)' }}>No holidays configured.</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Holiday</th>
                    <th>Date</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {holidays.map((h) => (
                    <tr key={h.id}>
                      <td className="td-name">{h.name}</td>
                      <td>{fmtDate(h.date)}</td>
                      <td style={{ textAlign: 'right' }}>
                        {writeOk && (
                          <button className="btn btn-danger btn-sm" onClick={() => void handleDelete(h)}>
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

        {writeOk && (
          <div className="card">
            <div className="card-title"><span>Add Holiday</span></div>
            <div className="form-group">
              <label>Name *</label>
              <input className="form-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Date *</label>
              <input type="date" className="form-input" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </div>
            <button className="btn btn-primary btn-sm" onClick={() => void handleAdd()}>
              <i className="fa-solid fa-plus" /> Add Holiday
            </button>
          </div>
        )}
      </div>
    </>
  );
}
