import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { useUserRole } from '@/hooks/hr/useUserRole';
import { supabase } from '@/integrations/supabase/client';

interface DocumentSetting {
  id: string;
  document_type: string;
  alert_30_days: boolean;
  alert_7_days: boolean;
  alert_on_expiry: boolean;
  is_required: boolean;
  created_at: string;
}

interface FormState {
  id: string | null;
  document_type: string;
  alert_30_days: boolean;
  alert_7_days: boolean;
  alert_on_expiry: boolean;
  is_required: boolean;
}

const empty: FormState = {
  id: null,
  document_type: '',
  alert_30_days: true,
  alert_7_days: true,
  alert_on_expiry: true,
  is_required: false,
};

export default function DocumentSettingsPage() {
  const { toast, showModal, closeModal } = useApp();
  const { can } = useUserRole();
  const [settings, setSettings] = useState<DocumentSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<FormState>(empty);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');

  const filteredSettings = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return settings;
    return settings.filter((s) => s.document_type.toLowerCase().includes(q));
  }, [settings, search]);

  const writeOk = can('documents', 'write');

  const refetch = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('document_settings')
      .select('*')
      .order('document_type');
    if (error) toast(error.message, 'error');
    else setSettings((data ?? []) as DocumentSetting[]);
    setLoading(false);
  }, [toast]);

  useEffect(() => { void refetch(); }, [refetch]);

  const update = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const startEdit = (s: DocumentSetting) =>
    setForm({
      id: s.id,
      document_type: s.document_type,
      alert_30_days: s.alert_30_days,
      alert_7_days: s.alert_7_days,
      alert_on_expiry: s.alert_on_expiry,
      is_required: s.is_required,
    });

  const handleSave = async () => {
    if (!form.document_type.trim()) { toast('Document type name is required', 'error'); return; }
    setSaving(true);
    const payload = {
      document_type: form.document_type.trim(),
      alert_30_days: form.alert_30_days,
      alert_7_days: form.alert_7_days,
      alert_on_expiry: form.alert_on_expiry,
      is_required: form.is_required,
    };
    const { error } = form.id
      ? await supabase.from('document_settings').update(payload).eq('id', form.id)
      : await supabase.from('document_settings').insert(payload);
    setSaving(false);
    if (error) { toast(error.message, 'error'); return; }
    toast(form.id ? 'Document type updated' : 'Document type added', 'success');
    setForm(empty);
    void refetch();
  };

  const handleDelete = (s: DocumentSetting) => {
    showModal(
      'Delete Document Type',
      <div>
        <p style={{ marginBottom: 16 }}>
          Delete <strong>{s.document_type}</strong>? Existing employee documents of this type will
          remain, but new uploads won't see this option in the catalog.
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn btn-outline btn-sm" onClick={closeModal}>Cancel</button>
          <button
            className="btn btn-danger btn-sm"
            onClick={async () => {
              const { error } = await supabase.from('document_settings').delete().eq('id', s.id);
              closeModal();
              if (error) { toast(error.message, 'error'); return; }
              toast(`${s.document_type} deleted`, 'info');
              void refetch();
            }}
          >
            Delete
          </button>
        </div>
      </div>,
    );
  };

  const stats = {
    total: settings.length,
    required: settings.filter((s) => s.is_required).length,
    alerting: settings.filter((s) => s.alert_30_days || s.alert_7_days || s.alert_on_expiry).length,
  };

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Document Settings</div>
          <div className="page-sub">HR Management · Document type catalog and expiry alerts</div>
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(37,99,235,0.13)', color: '#2563eb' }}>
            <i className="fa-solid fa-folder-tree" />
          </div>
          <div>
            <div className="stat-val">{stats.total}</div>
            <div className="stat-label">Total Types</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(207,34,46,0.13)', color: '#cf222e' }}>
            <i className="fa-solid fa-asterisk" />
          </div>
          <div>
            <div className="stat-val">{stats.required}</div>
            <div className="stat-label">Required</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(212,146,10,0.13)', color: '#d4920a' }}>
            <i className="fa-solid fa-bell" />
          </div>
          <div>
            <div className="stat-val">{stats.alerting}</div>
            <div className="stat-label">With Alerts</div>
          </div>
        </div>
      </div>

      <div className="two-col">
        <div className="card" style={{ padding: 0 }}>
          <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Document Type Catalog</div>
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
          ) : settings.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--text2)' }}>
              No document types configured.
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Document Type</th>
                    <th>Required</th>
                    <th>Alerts</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSettings.map((s) => (
                    <tr key={s.id}>
                      <td className="td-name">{s.document_type}</td>
                      <td>
                        <span className={s.is_required ? 'badge badge-fail' : 'badge badge-inactive'}>
                          {s.is_required ? 'Required' : 'Optional'}
                        </span>
                      </td>
                      <td style={{ fontSize: 11 }}>
                        {s.alert_30_days && <span className="badge badge-pass" style={{ marginRight: 3 }}>30d</span>}
                        {s.alert_7_days && <span className="badge badge-pending" style={{ marginRight: 3 }}>7d</span>}
                        {s.alert_on_expiry && <span className="badge badge-fail" style={{ marginRight: 3 }}>On expiry</span>}
                        {!s.alert_30_days && !s.alert_7_days && !s.alert_on_expiry && (
                          <span style={{ color: 'var(--text3)' }}>—</span>
                        )}
                      </td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {writeOk && (
                          <>
                            <button className="btn btn-outline btn-sm" onClick={() => startEdit(s)} style={{ marginRight: 4 }}>
                              <i className="fa-solid fa-pen" />
                            </button>
                            <button className="btn btn-danger btn-sm" onClick={() => handleDelete(s)}>
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
              <span>{form.id ? 'Edit Document Type' : 'New Document Type'}</span>
              {form.id && (
                <button className="btn btn-outline btn-sm" onClick={() => setForm(empty)}>Cancel edit</button>
              )}
            </div>
            <div className="form-group">
              <label>Document Type *</label>
              <input
                className="form-input"
                placeholder="e.g. Driver's License"
                value={form.document_type}
                onChange={(e) => update('document_type', e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>Required Document</label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, textTransform: 'none', letterSpacing: 'normal' }}>
                <input
                  type="checkbox"
                  checked={form.is_required}
                  onChange={(e) => update('is_required', e.target.checked)}
                />
                All employees must have this document on file
              </label>
            </div>
            <div className="form-group" style={{ marginTop: 8 }}>
              <label>Expiry Alerts</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, textTransform: 'none', letterSpacing: 'normal' }}>
                  <input
                    type="checkbox"
                    checked={form.alert_30_days}
                    onChange={(e) => update('alert_30_days', e.target.checked)}
                  />
                  Alert 30 days before expiry
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, textTransform: 'none', letterSpacing: 'normal' }}>
                  <input
                    type="checkbox"
                    checked={form.alert_7_days}
                    onChange={(e) => update('alert_7_days', e.target.checked)}
                  />
                  Alert 7 days before expiry
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, textTransform: 'none', letterSpacing: 'normal' }}>
                  <input
                    type="checkbox"
                    checked={form.alert_on_expiry}
                    onChange={(e) => update('alert_on_expiry', e.target.checked)}
                  />
                  Alert on the day of expiry
                </label>
              </div>
            </div>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => void handleSave()}
              disabled={saving}
              style={{ marginTop: 12 }}
            >
              <i className="fa-solid fa-floppy-disk" /> {saving ? 'Saving…' : form.id ? 'Update' : 'Create'}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
