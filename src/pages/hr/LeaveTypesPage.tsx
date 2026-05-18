import { useCallback, useEffect, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { useUserRole } from '@/hooks/hr/useUserRole';
import { supabase } from '@/integrations/supabase/client';

interface LeaveType {
  id: string;
  name: string;
  max_days: number;
  requires_approval: boolean;
  carry_forward: boolean;
  color: string | null;
  is_active: boolean;
  created_at: string;
}

interface FormState {
  id: string | null;
  name: string;
  code: string;
  max_days: string;
  requires_approval: boolean;
  carry_forward: boolean;
  color: string;
  is_active: boolean;
  is_paid: boolean;
  requires_certificate: boolean;
  description: string;
  min_days_notice: string;
}

const empty: FormState = {
  id: null,
  name: '',
  code: '',
  max_days: '0',
  requires_approval: true,
  carry_forward: false,
  color: '#0D9488',
  is_active: true,
  is_paid: true,
  requires_certificate: false,
  description: '',
  min_days_notice: '0',
};

export default function LeaveTypesPage() {
  const { toast } = useApp();
  const { can } = useUserRole();
  const [types, setTypes] = useState<LeaveType[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<FormState>(empty);
  const [saving, setSaving] = useState(false);

  const writeOk = can('leave_types', 'write');

  const refetch = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from('leave_types').select('*').order('name');
    if (error) toast(error.message, 'error');
    else setTypes((data ?? []) as LeaveType[]);
    setLoading(false);
  }, [toast]);

  useEffect(() => { void refetch(); }, [refetch]);

  const update = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const startEdit = (t: LeaveType) =>
    setForm({
      id: t.id,
      name: t.name,
      code: (t as any).code ?? '',
      max_days: String(t.max_days),
      requires_approval: t.requires_approval,
      carry_forward: t.carry_forward,
      color: t.color ?? '#0D9488',
      is_active: t.is_active,
      is_paid: (t as any).is_paid ?? true,
      requires_certificate: (t as any).requires_certificate ?? false,
      description: (t as any).description ?? '',
      min_days_notice: String((t as any).min_days_notice ?? 0),
    });

  const handleSave = async () => {
    if (!form.name.trim()) { toast('Name is required', 'error'); return; }
    setSaving(true);
    const payload = {
      name: form.name.trim(),
      code: form.code.trim().toUpperCase() || null,
      max_days: Number(form.max_days) || 0,
      requires_approval: form.requires_approval,
      carry_forward: form.carry_forward,
      color: form.color,
      is_active: form.is_active,
      is_paid: form.is_paid,
      requires_certificate: form.requires_certificate,
      description: form.description.trim() || null,
      min_days_notice: Number(form.min_days_notice) || 0,
    };
    const { error } = form.id
      ? await supabase.from('leave_types').update(payload).eq('id', form.id)
      : await supabase.from('leave_types').insert(payload);
    setSaving(false);
    if (error) { toast(error.message, 'error'); return; }
    toast(form.id ? 'Leave type updated' : 'Leave type created', 'success');
    setForm(empty);
    void refetch();
  };

  const handleDelete = async (t: LeaveType) => {
    if (!window.confirm(`Delete "${t.name}"?`)) return;
    const { error } = await supabase.from('leave_types').delete().eq('id', t.id);
    if (error) { toast(error.message, 'error'); return; }
    toast(`${t.name} deleted`, 'info');
    void refetch();
  };

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Leave Types</div>
          <div className="page-sub">HR Management · {types.length} types</div>
        </div>
      </div>

      <div className="two-col">
        <div className="card" style={{ padding: 0 }}>
          <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid var(--border)', fontSize: 13, fontWeight: 600 }}>
            Active Leave Types
          </div>
          {loading ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--text2)' }}>Loading…</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Max Days</th>
                    <th>Approval</th>
                    <th>Carry Fwd</th>
                    <th>Status</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {types.map((t) => (
                    <tr key={t.id} style={{ opacity: t.is_active ? 1 : 0.55 }}>
                      <td className="td-name">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ width: 10, height: 10, borderRadius: 2, background: t.color ?? '#0D9488' }} />
                          {t.name}
                        </div>
                      </td>
                      <td>{t.max_days}</td>
                      <td>{t.requires_approval ? 'Required' : 'No'}</td>
                      <td>{t.carry_forward ? 'Yes' : 'No'}</td>
                      <td>
                        <span className={t.is_active ? 'badge badge-active' : 'badge badge-inactive'}>
                          {t.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {writeOk && (
                          <>
                            <button className="btn btn-outline btn-sm" onClick={() => startEdit(t)} style={{ marginRight: 4 }}>
                              <i className="fa-solid fa-pen" />
                            </button>
                            <button className="btn btn-danger btn-sm" onClick={() => void handleDelete(t)}>
                              <i className="fa-solid fa-trash" />
                            </button>
                          </>
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
            <div className="card-title">
              <span>{form.id ? 'Edit Leave Type' : 'New Leave Type'}</span>
              {form.id && <button className="btn btn-outline btn-sm" onClick={() => setForm(empty)}>Cancel edit</button>}
            </div>
            <div className="form-row cols2">
              <div className="form-group">
                <label>Name *</label>
                <input className="form-input" value={form.name} onChange={(e) => update('name', e.target.value)} />
              </div>
              <div className="form-group">
                <label>Code <span style={{ fontSize: 10, color: 'var(--text3)' }}>(e.g. AL, SL)</span></label>
                <input className="form-input" value={form.code} maxLength={5} placeholder="Auto" onChange={(e) => update('code', e.target.value)} />
              </div>
            </div>
            <div className="form-row cols3">
              <div className="form-group">
                <label>Max Days / Year</label>
                <input type="number" step="0.5" className="form-input" value={form.max_days} onChange={(e) => update('max_days', e.target.value)} />
              </div>
              <div className="form-group">
                <label>Min Notice Days</label>
                <input type="number" step="1" className="form-input" value={form.min_days_notice} onChange={(e) => update('min_days_notice', e.target.value)} />
              </div>
              <div className="form-group">
                <label>Color</label>
                <input type="color" className="form-input" style={{ height: 36, padding: 2 }} value={form.color} onChange={(e) => update('color', e.target.value)} />
              </div>
            </div>
            <div className="form-group">
              <label>Description</label>
              <textarea rows={2} className="form-textarea" value={form.description} onChange={(e) => update('description', e.target.value)} />
            </div>
            <div style={{ display: 'flex', gap: 16, flexDirection: 'column', marginBottom: 12 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                <input type="checkbox" checked={form.requires_approval} onChange={(e) => update('requires_approval', e.target.checked)} />
                Requires approval
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                <input type="checkbox" checked={form.carry_forward} onChange={(e) => update('carry_forward', e.target.checked)} />
                Carry forward unused days
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                <input type="checkbox" checked={form.is_paid} onChange={(e) => update('is_paid', e.target.checked)} />
                Paid leave
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                <input type="checkbox" checked={form.requires_certificate} onChange={(e) => update('requires_certificate', e.target.checked)} />
                Requires medical certificate
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                <input type="checkbox" checked={form.is_active} onChange={(e) => update('is_active', e.target.checked)} />
                Active
              </label>
            </div>
            <button className="btn btn-primary btn-sm" onClick={() => void handleSave()} disabled={saving}>
              <i className="fa-solid fa-floppy-disk" /> {saving ? 'Saving…' : form.id ? 'Update' : 'Create'}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
