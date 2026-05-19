import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { useUserRole } from '@/hooks/hr/useUserRole';
import { supabase } from '@/integrations/supabase/client';

interface LoanType {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
}

interface FormState {
  id: string | null;
  name: string;
  description: string;
  is_active: boolean;
}

const empty: FormState = { id: null, name: '', description: '', is_active: true };

export default function LoanTypesPage() {
  const { toast } = useApp();
  const { can } = useUserRole();
  const [types, setTypes] = useState<LoanType[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<FormState>(empty);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');

  const filteredTypes = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return types;
    return types.filter((t) =>
      t.name.toLowerCase().includes(q) || (t.description ?? '').toLowerCase().includes(q),
    );
  }, [types, search]);

  const writeOk = can('loan_types', 'write');

  const refetch = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from('loan_types').select('*').order('name');
    if (error) toast(error.message, 'error');
    else setTypes((data ?? []) as LoanType[]);
    setLoading(false);
  }, [toast]);

  useEffect(() => { void refetch(); }, [refetch]);

  const update = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const startEdit = (t: LoanType) =>
    setForm({ id: t.id, name: t.name, description: t.description ?? '', is_active: t.is_active });

  const handleSave = async () => {
    if (!form.name.trim()) { toast('Name is required', 'error'); return; }
    setSaving(true);
    const payload = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      is_active: form.is_active,
    };
    const { error } = form.id
      ? await supabase.from('loan_types').update(payload).eq('id', form.id)
      : await supabase.from('loan_types').insert(payload);
    setSaving(false);
    if (error) { toast(error.message, 'error'); return; }
    toast(form.id ? 'Loan type updated' : 'Loan type created', 'success');
    setForm(empty);
    void refetch();
  };

  const handleDelete = async (t: LoanType) => {
    if (!window.confirm(`Delete "${t.name}"?`)) return;
    const { error } = await supabase.from('loan_types').delete().eq('id', t.id);
    if (error) { toast(error.message, 'error'); return; }
    toast(`${t.name} deleted`, 'info');
    void refetch();
  };

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Loan Types</div>
          <div className="page-sub">HR Management · {types.length} types</div>
        </div>
      </div>

      <div className="two-col">
        <div className="card" style={{ padding: 0 }}>
          <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Loan Type Catalog</div>
            <input
              className="search-input"
              placeholder="Search…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: 180 }}
            />
          </div>
          {loading ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--text2)' }}>Loading…</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Description</th>
                    <th>Status</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTypes.map((t) => (
                    <tr key={t.id} style={{ opacity: t.is_active ? 1 : 0.55 }}>
                      <td className="td-name">{t.name}</td>
                      <td>{t.description ?? '—'}</td>
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
              <span>{form.id ? 'Edit Loan Type' : 'New Loan Type'}</span>
              {form.id && <button className="btn btn-outline btn-sm" onClick={() => setForm(empty)}>Cancel edit</button>}
            </div>
            <div className="form-group">
              <label>Name *</label>
              <input className="form-input" value={form.name} onChange={(e) => update('name', e.target.value)} />
            </div>
            <div className="form-group">
              <label>Description</label>
              <textarea
                rows={3}
                className="form-textarea"
                value={form.description}
                onChange={(e) => update('description', e.target.value)}
              />
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, marginBottom: 12 }}>
              <input type="checkbox" checked={form.is_active} onChange={(e) => update('is_active', e.target.checked)} />
              Active
            </label>
            <button className="btn btn-primary btn-sm" onClick={() => void handleSave()} disabled={saving}>
              <i className="fa-solid fa-floppy-disk" /> {saving ? 'Saving…' : form.id ? 'Update' : 'Create'}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
