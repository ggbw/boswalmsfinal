import { useMemo, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { useUserRole } from '@/hooks/hr/useUserRole';
import { useHrDepartments, type HrDepartment } from '@/hooks/hr/useHrDepartments';
import { supabase } from '@/integrations/supabase/client';

interface FormState {
  id: string | null;
  name: string;
  manager: string;
  parent_department: string;
  color: string;
  is_active: boolean;
}

const empty: FormState = {
  id: null,
  name: '',
  manager: '',
  parent_department: '',
  color: '#1E3A5F',
  is_active: true,
};

export default function HrDepartmentsPage() {
  const { toast, showModal, closeModal } = useApp();
  const { can } = useUserRole();
  const { departments, loading, refetch } = useHrDepartments();
  const [form, setForm] = useState<FormState>(empty);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');

  const filteredDepartments = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return departments;
    return departments.filter((d) =>
      d.name.toLowerCase().includes(q) ||
      (d.manager ?? '').toLowerCase().includes(q) ||
      (d.parent_department ?? '').toLowerCase().includes(q),
    );
  }, [departments, search]);

  const update = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const startEdit = (d: HrDepartment) => {
    setForm({
      id: d.id,
      name: d.name,
      manager: d.manager ?? '',
      parent_department: d.parent_department ?? '',
      color: d.color ?? '#1E3A5F',
      is_active: d.is_active,
    });
  };

  const handleSave = async () => {
    if (!form.name.trim()) { toast('Name is required', 'error'); return; }
    setSaving(true);
    const payload = {
      name: form.name.trim(),
      manager: form.manager.trim() || null,
      parent_department: form.parent_department.trim() || null,
      color: form.color || '#1E3A5F',
      is_active: form.is_active,
    };
    const { error } = form.id
      ? await supabase.from('hr_departments').update(payload).eq('id', form.id)
      : await supabase.from('hr_departments').insert(payload);
    setSaving(false);
    if (error) { toast(error.message, 'error'); return; }
    toast(form.id ? 'Department updated' : 'Department created', 'success');
    setForm(empty);
    void refetch();
  };

  const handleDelete = (id: string, name: string) => {
    showModal(
      'Delete Department',
      <div>
        <p style={{ marginBottom: 16 }}>
          Delete <strong>{name}</strong>? Employees referencing it will keep their text department,
          but the link will be cleared.
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn btn-outline btn-sm" onClick={closeModal}>Cancel</button>
          <button
            className="btn btn-danger btn-sm"
            onClick={async () => {
              const { error } = await supabase.from('hr_departments').delete().eq('id', id);
              closeModal();
              if (error) { toast(error.message, 'error'); return; }
              toast(`${name} deleted`, 'info');
              void refetch();
            }}
          >
            Delete
          </button>
        </div>
      </div>,
    );
  };

  const writeOk = can('departments', 'write');

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">HR Departments</div>
          <div className="page-sub">HR Management · {departments.length} total</div>
        </div>
      </div>

      <div className="two-col">
        <div className="card" style={{ padding: 0 }}>
          <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Department List</div>
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
          ) : departments.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--text2)' }}>No departments.</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Manager</th>
                    <th>Parent</th>
                    <th>Status</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDepartments.map((d) => (
                    <tr key={d.id}>
                      <td className="td-name">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ width: 10, height: 10, borderRadius: 2, background: d.color ?? '#1E3A5F' }} />
                          {d.name}
                        </div>
                      </td>
                      <td>{d.manager ?? '—'}</td>
                      <td>{d.parent_department ?? '—'}</td>
                      <td>
                        <span className={d.is_active ? 'badge badge-active' : 'badge badge-inactive'}>
                          {d.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {writeOk && (
                          <>
                            <button className="btn btn-outline btn-sm" onClick={() => startEdit(d)} style={{ marginRight: 4 }}>
                              <i className="fa-solid fa-pen" />
                            </button>
                            <button className="btn btn-danger btn-sm" onClick={() => handleDelete(d.id, d.name)}>
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
              <span>{form.id ? 'Edit Department' : 'New Department'}</span>
              {form.id && (
                <button className="btn btn-outline btn-sm" onClick={() => setForm(empty)}>
                  Cancel edit
                </button>
              )}
            </div>
            <div className="form-group">
              <label>Name *</label>
              <input className="form-input" value={form.name} onChange={(e) => update('name', e.target.value)} />
            </div>
            <div className="form-group">
              <label>Manager</label>
              <input className="form-input" value={form.manager} onChange={(e) => update('manager', e.target.value)} />
            </div>
            <div className="form-group">
              <label>Parent Department</label>
              <input className="form-input" value={form.parent_department} onChange={(e) => update('parent_department', e.target.value)} />
            </div>
            <div className="form-row cols2">
              <div className="form-group">
                <label>Color</label>
                <input
                  type="color"
                  className="form-input"
                  style={{ height: 36, padding: 2 }}
                  value={form.color}
                  onChange={(e) => update('color', e.target.value)}
                />
              </div>
              <div className="form-group" style={{ display: 'flex', alignItems: 'flex-end' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, textTransform: 'none', letterSpacing: 'normal', marginBottom: 8 }}>
                  <input type="checkbox" checked={form.is_active} onChange={(e) => update('is_active', e.target.checked)} />
                  Active
                </label>
              </div>
            </div>
            <button className="btn btn-primary btn-sm" onClick={() => void handleSave()} disabled={saving} style={{ marginTop: 8 }}>
              <i className="fa-solid fa-floppy-disk" /> {saving ? 'Saving…' : form.id ? 'Update' : 'Create'}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
