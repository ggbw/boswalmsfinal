import { useMemo, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { useUserRole } from '@/hooks/hr/useUserRole';
import { usePayComponents, type PayComponentDef } from '@/hooks/hr/usePayComponents';
import { supabase } from '@/integrations/supabase/client';

interface FormState {
  id: string | null;
  name: string;
  code: string;
  category: 'earning' | 'deduction' | 'benefit';
  component_type: 'fixed' | 'variable' | 'formula' | 'overtime';
  default_amount: string;
  is_statutory: boolean;
  is_taxable: boolean;
  sequence: string;
  is_active: boolean;
}

const empty: FormState = {
  id: null,
  name: '',
  code: '',
  category: 'earning',
  component_type: 'fixed',
  default_amount: '',
  is_statutory: false,
  is_taxable: true,
  sequence: '0',
  is_active: true,
};

export default function PayComponentsPage() {
  const { toast, showModal, closeModal } = useApp();
  const { can } = useUserRole();
  const { components, loading, refetch } = usePayComponents();
  const [form, setForm] = useState<FormState>(empty);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');

  const filteredComponents = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return components;
    return components.filter((c) =>
      c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q),
    );
  }, [components, search]);

  const writeOk = can('pay_components', 'write');

  const update = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const startEdit = (c: PayComponentDef) => {
    setForm({
      id: c.id,
      name: c.name,
      code: c.code,
      category: c.category,
      component_type: c.component_type,
      default_amount: c.default_amount != null ? String(c.default_amount) : '',
      is_statutory: c.is_statutory,
      is_taxable: c.is_taxable,
      sequence: String(c.sequence),
      is_active: c.is_active,
    });
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.code.trim()) { toast('Name and code are required', 'error'); return; }
    setSaving(true);
    const payload = {
      name: form.name.trim(),
      code: form.code.trim().toUpperCase(),
      category: form.category,
      component_type: form.component_type,
      default_amount: form.default_amount ? Number(form.default_amount) : null,
      is_statutory: form.is_statutory,
      is_taxable: form.is_taxable,
      sequence: Number(form.sequence) || 0,
      is_active: form.is_active,
    };
    const { error } = form.id
      ? await supabase.from('pay_component_defs').update(payload).eq('id', form.id)
      : await supabase.from('pay_component_defs').insert(payload);
    setSaving(false);
    if (error) { toast(error.message, 'error'); return; }
    toast(form.id ? 'Component updated' : 'Component created', 'success');
    setForm(empty);
    void refetch();
  };

  const handleDelete = (c: PayComponentDef) => {
    showModal(
      'Delete Pay Component',
      <div>
        <p style={{ marginBottom: 16 }}>
          Delete <strong>{c.name}</strong> ({c.code})? Per-employee overrides referencing it will be removed.
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn btn-outline btn-sm" onClick={closeModal}>Cancel</button>
          <button
            className="btn btn-danger btn-sm"
            onClick={async () => {
              const { error } = await supabase.from('pay_component_defs').delete().eq('id', c.id);
              closeModal();
              if (error) { toast(error.message, 'error'); return; }
              toast(`${c.name} deleted`, 'info');
              void refetch();
            }}
          >
            Delete
          </button>
        </div>
      </div>,
    );
  };

  const grouped = {
    earning: filteredComponents.filter((c) => c.category === 'earning'),
    deduction: filteredComponents.filter((c) => c.category === 'deduction'),
    benefit: filteredComponents.filter((c) => c.category === 'benefit'),
  };

  const renderTable = (items: PayComponentDef[], title: string) => (
    <div className="card" style={{ padding: 0, marginBottom: 16 }}>
      <div style={{ padding: '14px 20px 10px', fontSize: 13, fontWeight: 600, borderBottom: '1px solid var(--border)' }}>
        {title} ({items.length})
      </div>
      {items.length === 0 ? (
        <div style={{ padding: 16, color: 'var(--text2)', fontSize: 12, textAlign: 'center' }}>None</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Type</th>
                <th style={{ textAlign: 'right' }}>Default</th>
                <th>Flags</th>
                <th>Seq</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id} style={{ opacity: c.is_active ? 1 : 0.55 }}>
                  <td style={{ fontFamily: 'JetBrains Mono, monospace' }}>{c.code}</td>
                  <td className="td-name">{c.name}</td>
                  <td style={{ textTransform: 'capitalize' }}>{c.component_type}</td>
                  <td style={{ textAlign: 'right' }}>
                    {c.default_amount != null ? c.default_amount.toFixed(2) : '—'}
                  </td>
                  <td>
                    {c.is_statutory && <span className="badge badge-pending" style={{ marginRight: 4 }}>Statutory</span>}
                    {c.is_taxable && <span className="badge badge-pass">Taxable</span>}
                  </td>
                  <td>{c.sequence}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {writeOk && (
                      <>
                        <button className="btn btn-outline btn-sm" onClick={() => startEdit(c)} style={{ marginRight: 4 }}>
                          <i className="fa-solid fa-pen" />
                        </button>
                        <button className="btn btn-danger btn-sm" onClick={() => handleDelete(c)}>
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
  );

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Pay Components</div>
          <div className="page-sub">HR Management · {components.length} total</div>
        </div>
        <input
          className="search-input"
          placeholder="Search…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: 220 }}
        />
      </div>

      {loading ? (
        <div className="card" style={{ textAlign: 'center', color: 'var(--text2)' }}>Loading…</div>
      ) : (
        <>
          {renderTable(grouped.earning, 'Earnings')}
          {renderTable(grouped.deduction, 'Deductions')}
          {renderTable(grouped.benefit, 'Benefits')}
        </>
      )}

      {writeOk && (
        <div className="card">
          <div className="card-title">
            <span>{form.id ? 'Edit Component' : 'New Component'}</span>
            {form.id && <button className="btn btn-outline btn-sm" onClick={() => setForm(empty)}>Cancel edit</button>}
          </div>
          <div className="form-row cols3">
            <div className="form-group">
              <label>Name *</label>
              <input className="form-input" value={form.name} onChange={(e) => update('name', e.target.value)} />
            </div>
            <div className="form-group">
              <label>Code *</label>
              <input className="form-input" value={form.code} onChange={(e) => update('code', e.target.value)} />
            </div>
            <div className="form-group">
              <label>Category</label>
              <select className="form-select" value={form.category} onChange={(e) => update('category', e.target.value as FormState['category'])}>
                <option value="earning">Earning</option>
                <option value="deduction">Deduction</option>
                <option value="benefit">Benefit</option>
              </select>
            </div>
          </div>
          <div className="form-row cols3">
            <div className="form-group">
              <label>Type</label>
              <select className="form-select" value={form.component_type} onChange={(e) => update('component_type', e.target.value as FormState['component_type'])}>
                <option value="fixed">Fixed</option>
                <option value="variable">Variable</option>
                <option value="formula">Formula</option>
                <option value="overtime">Overtime</option>
              </select>
            </div>
            <div className="form-group">
              <label>Default Amount</label>
              <input type="number" step="0.01" className="form-input" value={form.default_amount} onChange={(e) => update('default_amount', e.target.value)} />
            </div>
            <div className="form-group">
              <label>Sequence</label>
              <input type="number" className="form-input" value={form.sequence} onChange={(e) => update('sequence', e.target.value)} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 16, marginTop: 8, flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
              <input type="checkbox" checked={form.is_statutory} onChange={(e) => update('is_statutory', e.target.checked)} />
              Statutory
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
              <input type="checkbox" checked={form.is_taxable} onChange={(e) => update('is_taxable', e.target.checked)} />
              Taxable
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
              <input type="checkbox" checked={form.is_active} onChange={(e) => update('is_active', e.target.checked)} />
              Active
            </label>
          </div>
          <div style={{ textAlign: 'right', marginTop: 16 }}>
            <button className="btn btn-primary btn-sm" onClick={() => void handleSave()} disabled={saving}>
              <i className="fa-solid fa-floppy-disk" /> {saving ? 'Saving…' : form.id ? 'Update' : 'Create'}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
