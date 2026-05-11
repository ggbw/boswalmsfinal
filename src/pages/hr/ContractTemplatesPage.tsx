import { useState } from 'react';
import { useApp } from '@/context/AppContext';
import { useUserRole } from '@/hooks/hr/useUserRole';
import { useContractTemplates, type ContractTemplate } from '@/hooks/hr/useContracts';
import { supabase } from '@/integrations/supabase/client';

export default function ContractTemplatesPage() {
  const { toast } = useApp();
  const { can } = useUserRole();
  const { templates, loading, refetch } = useContractTemplates();
  const [form, setForm] = useState<{ id: string | null; name: string; is_active: boolean }>({
    id: null,
    name: '',
    is_active: true,
  });
  const [saving, setSaving] = useState(false);

  const writeOk = can('contract_templates', 'write');

  const startEdit = (t: ContractTemplate) =>
    setForm({ id: t.id, name: t.name, is_active: t.is_active });

  const handleSave = async () => {
    if (!form.name.trim()) { toast('Name is required', 'error'); return; }
    setSaving(true);
    const payload = { name: form.name.trim(), is_active: form.is_active };
    const { error } = form.id
      ? await supabase.from('contract_templates').update(payload).eq('id', form.id)
      : await supabase.from('contract_templates').insert(payload);
    setSaving(false);
    if (error) { toast(error.message, 'error'); return; }
    toast(form.id ? 'Template updated' : 'Template created', 'success');
    setForm({ id: null, name: '', is_active: true });
    void refetch();
  };

  const handleDelete = async (t: ContractTemplate) => {
    if (!window.confirm(`Delete "${t.name}"? Lines using it will be unlinked.`)) return;
    const { error } = await supabase.from('contract_templates').delete().eq('id', t.id);
    if (error) { toast(error.message, 'error'); return; }
    toast(`${t.name} deleted`, 'info');
    void refetch();
  };

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Contract Templates</div>
          <div className="page-sub">HR Management · {templates.length} templates</div>
        </div>
      </div>

      <div className="two-col">
        <div className="card" style={{ padding: 0 }}>
          <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid var(--border)', fontSize: 13, fontWeight: 600 }}>
            Template List
          </div>
          {loading ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--text2)' }}>Loading…</div>
          ) : templates.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--text2)' }}>No templates yet.</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Status</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {templates.map((t) => (
                    <tr key={t.id} style={{ opacity: t.is_active ? 1 : 0.55 }}>
                      <td className="td-name">{t.name}</td>
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
              <span>{form.id ? 'Edit Template' : 'New Template'}</span>
              {form.id && (
                <button className="btn btn-outline btn-sm" onClick={() => setForm({ id: null, name: '', is_active: true })}>
                  Cancel edit
                </button>
              )}
            </div>
            <div className="form-group">
              <label>Name *</label>
              <input className="form-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, marginBottom: 12 }}>
              <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
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
