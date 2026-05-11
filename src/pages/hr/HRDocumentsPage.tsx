import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { useUserRole } from '@/hooks/hr/useUserRole';
import { useEmployees } from '@/hooks/hr/useEmployees';
import { fmtDate } from '@/lib/hr/leaveUtils';
import { supabase } from '@/integrations/supabase/client';

interface EmployeeDocument {
  id: string;
  employee_id: string | null;
  document_name: string;
  document_type: string | null;
  expiry_date: string | null;
  notes: string | null;
  file_path: string | null;
  uploaded_at: string;
}

interface DocWithEmployee extends EmployeeDocument {
  employee_name?: string | null;
  employee_code?: string | null;
}

const expiryInfo = (date: string | null): { className: string; label: string } => {
  if (!date) return { className: 'badge badge-inactive', label: 'No expiry' };
  const days = Math.floor((new Date(date).getTime() - Date.now()) / (24 * 3600 * 1000));
  if (days < 0) return { className: 'badge badge-fail', label: `Expired ${-days}d ago` };
  if (days <= 30) return { className: 'badge badge-pending', label: `${days}d left` };
  return { className: 'badge badge-active', label: `${days}d left` };
};

export default function HRDocumentsPage() {
  const { toast } = useApp();
  const { can } = useUserRole();
  const { employees } = useEmployees();
  const [documents, setDocuments] = useState<DocWithEmployee[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'expiring' | 'expired'>('all');
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    employee_id: '',
    document_name: '',
    document_type: '',
    expiry_date: '',
    notes: '',
    file_path: '',
  });

  const writeOk = can('documents', 'write');

  const refetch = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('employee_documents')
      .select('*, employees(employee_name, employee_code)')
      .order('expiry_date', { ascending: true, nullsFirst: false });
    if (error) toast(error.message, 'error');
    else
      setDocuments(((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
        ...(r as unknown as EmployeeDocument),
        employee_name: (r.employees as { employee_name?: string } | null)?.employee_name ?? null,
        employee_code: (r.employees as { employee_code?: string } | null)?.employee_code ?? null,
      })));
    setLoading(false);
  }, [toast]);

  useEffect(() => { void refetch(); }, [refetch]);

  const filtered = useMemo(() => {
    if (filter === 'all') return documents;
    return documents.filter((d) => {
      if (!d.expiry_date) return false;
      const days = Math.floor((new Date(d.expiry_date).getTime() - Date.now()) / (24 * 3600 * 1000));
      if (filter === 'expired') return days < 0;
      return days >= 0 && days <= 30;
    });
  }, [documents, filter]);

  const handleCreate = async () => {
    if (!form.employee_id || !form.document_name) { toast('Employee and name are required', 'error'); return; }
    const { error } = await supabase.from('employee_documents').insert({
      employee_id: form.employee_id,
      document_name: form.document_name.trim(),
      document_type: form.document_type.trim() || 'OTHER',
      expiry_date: form.expiry_date || null,
      notes: form.notes.trim() || null,
      file_path: form.file_path.trim() || null,
    });
    if (error) { toast(error.message, 'error'); return; }
    toast('Document added', 'success');
    setForm({ employee_id: '', document_name: '', document_type: '', expiry_date: '', notes: '', file_path: '' });
    setCreating(false);
    void refetch();
  };

  const handleDelete = async (d: DocWithEmployee) => {
    if (!window.confirm(`Delete "${d.document_name}"?`)) return;
    const { error } = await supabase.from('employee_documents').delete().eq('id', d.id);
    if (error) { toast(error.message, 'error'); return; }
    toast('Document deleted', 'info');
    void refetch();
  };

  const counts = useMemo(() => {
    let expired = 0;
    let expiring = 0;
    documents.forEach((d) => {
      if (!d.expiry_date) return;
      const days = Math.floor((new Date(d.expiry_date).getTime() - Date.now()) / (24 * 3600 * 1000));
      if (days < 0) expired += 1;
      else if (days <= 30) expiring += 1;
    });
    return { total: documents.length, expired, expiring };
  }, [documents]);

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Documents</div>
          <div className="page-sub">HR Management · {filtered.length} of {documents.length}</div>
        </div>
        {writeOk && (
          <button className="btn btn-primary btn-sm" onClick={() => setCreating((c) => !c)}>
            <i className="fa-solid fa-plus" /> {creating ? 'Cancel' : 'New Document'}
          </button>
        )}
      </div>

      <div className="stat-grid">
        <div className="stat-card" onClick={() => setFilter('all')} style={{ cursor: 'pointer' }}>
          <div className="stat-icon" style={{ background: 'rgba(37,99,235,0.13)', color: '#2563eb' }}>
            <i className="fa-solid fa-folder-open" />
          </div>
          <div>
            <div className="stat-val">{counts.total}</div>
            <div className="stat-label">Total</div>
          </div>
        </div>
        <div className="stat-card" onClick={() => setFilter('expiring')} style={{ cursor: 'pointer' }}>
          <div className="stat-icon" style={{ background: 'rgba(212,146,10,0.13)', color: '#d4920a' }}>
            <i className="fa-solid fa-triangle-exclamation" />
          </div>
          <div>
            <div className="stat-val" style={{ color: '#d4920a' }}>{counts.expiring}</div>
            <div className="stat-label">Expiring (≤ 30 days)</div>
          </div>
        </div>
        <div className="stat-card" onClick={() => setFilter('expired')} style={{ cursor: 'pointer' }}>
          <div className="stat-icon" style={{ background: 'rgba(207,34,46,0.13)', color: '#cf222e' }}>
            <i className="fa-solid fa-circle-xmark" />
          </div>
          <div>
            <div className="stat-val" style={{ color: '#cf222e' }}>{counts.expired}</div>
            <div className="stat-label">Expired</div>
          </div>
        </div>
      </div>

      {creating && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-title"><span>New Document</span></div>
          <div className="form-row cols2">
            <div className="form-group">
              <label>Employee *</label>
              <select className="form-select" value={form.employee_id} onChange={(e) => setForm({ ...form, employee_id: e.target.value })}>
                <option value="">— Select —</option>
                {employees.map((e) => <option key={e.id} value={e.id}>{e.employee_name} ({e.employee_code})</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Document Name *</label>
              <input className="form-input" value={form.document_name} onChange={(e) => setForm({ ...form, document_name: e.target.value })} />
            </div>
          </div>
          <div className="form-row cols2">
            <div className="form-group">
              <label>Type</label>
              <input className="form-input" placeholder="ID, Visa, Contract…" value={form.document_type} onChange={(e) => setForm({ ...form, document_type: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Expiry Date</label>
              <input type="date" className="form-input" value={form.expiry_date} onChange={(e) => setForm({ ...form, expiry_date: e.target.value })} />
            </div>
          </div>
          <div className="form-group">
            <label>File URL</label>
            <input className="form-input" placeholder="https://…" value={form.file_path} onChange={(e) => setForm({ ...form, file_path: e.target.value })} />
          </div>
          <div className="form-group">
            <label>Notes</label>
            <textarea rows={2} className="form-textarea" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
          <div style={{ textAlign: 'right' }}>
            <button className="btn btn-primary btn-sm" onClick={() => void handleCreate()}>
              <i className="fa-solid fa-floppy-disk" /> Save
            </button>
          </div>
        </div>
      )}

      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Document List</div>
          <select className="filter-select" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
            <option value="all">All</option>
            <option value="expiring">Expiring (≤ 30 days)</option>
            <option value="expired">Expired</option>
          </select>
        </div>
        {loading ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text2)' }}>Loading…</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text2)' }}>No documents.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Document</th>
                  <th>Type</th>
                  <th>Expiry</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((d) => {
                  const ec = expiryInfo(d.expiry_date);
                  return (
                    <tr key={d.id}>
                      <td>
                        <div className="td-name">{d.employee_name ?? '—'}</div>
                        <div style={{ fontSize: 10, color: 'var(--text3)' }}>{d.employee_code}</div>
                      </td>
                      <td>
                        {d.file_path ? (
                          <a href={d.file_path} target="_blank" rel="noreferrer" style={{ color: 'var(--accent2)' }}>
                            {d.document_name} <i className="fa-solid fa-up-right-from-square" style={{ fontSize: 9 }} />
                          </a>
                        ) : (
                          d.document_name
                        )}
                      </td>
                      <td>{d.document_type ?? '—'}</td>
                      <td>{d.expiry_date ? fmtDate(d.expiry_date) : '—'}</td>
                      <td><span className={ec.className}>{ec.label}</span></td>
                      <td style={{ textAlign: 'right' }}>
                        {writeOk && (
                          <button className="btn btn-danger btn-sm" onClick={() => void handleDelete(d)}>
                            <i className="fa-solid fa-trash" />
                          </button>
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
