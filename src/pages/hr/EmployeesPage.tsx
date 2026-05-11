import { useMemo, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { useEmployees } from '@/hooks/hr/useEmployees';
import { useUserRole } from '@/hooks/hr/useUserRole';
import { supabase } from '@/integrations/supabase/client';

const statusClass = (status: string | null): string => {
  const s = status ?? 'active';
  if (s === 'active') return 'badge badge-active';
  if (s === 'inactive') return 'badge badge-pending';
  return 'badge badge-fail';
};

export default function EmployeesPage() {
  const { navigate, toast } = useApp();
  const { can } = useUserRole();
  const { employees, loading, refetch } = useEmployees();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return employees.filter((e) => {
      if (statusFilter !== 'all' && (e.status ?? 'active') !== statusFilter) return false;
      if (!q) return true;
      return (
        (e.employee_name ?? '').toLowerCase().includes(q) ||
        (e.employee_code ?? '').toLowerCase().includes(q) ||
        (e.email ?? '').toLowerCase().includes(q) ||
        (e.job_title ?? '').toLowerCase().includes(q) ||
        (e.department ?? '').toLowerCase().includes(q)
      );
    });
  }, [employees, search, statusFilter]);

  const handleDelete = async (id: string, name: string) => {
    if (!can('employees', 'delete')) {
      toast('You do not have permission to delete employees', 'error');
      return;
    }
    if (!window.confirm(`Delete ${name}? This cannot be undone.`)) return;
    const { error } = await supabase.from('employees').delete().eq('id', id);
    if (error) { toast(error.message, 'error'); return; }
    toast(`${name} deleted`, 'info');
    void refetch();
  };

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Employees</div>
          <div className="page-sub">HR Management · {filtered.length} of {employees.length}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-outline btn-sm" onClick={() => void refetch()} disabled={loading}>
            <i className="fa-solid fa-rotate" /> Refresh
          </button>
          {can('employees', 'write') && (
            <button
              className="btn btn-primary btn-sm"
              onClick={() => navigate('hr-employee-form', { mode: 'create' })}
            >
              <i className="fa-solid fa-user-plus" /> Add Employee
            </button>
          )}
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(37,99,235,0.13)', color: '#2563eb' }}>
            <i className="fa-solid fa-users" />
          </div>
          <div>
            <div className="stat-val">{employees.length}</div>
            <div className="stat-label">Total Employees</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(26,127,55,0.13)', color: '#1a7f37' }}>
            <i className="fa-solid fa-circle-check" />
          </div>
          <div>
            <div className="stat-val">{employees.filter((e) => (e.status ?? 'active') === 'active').length}</div>
            <div className="stat-label">Active</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(212,146,10,0.13)', color: '#d4920a' }}>
            <i className="fa-solid fa-circle-pause" />
          </div>
          <div>
            <div className="stat-val">{employees.filter((e) => e.status === 'inactive').length}</div>
            <div className="stat-label">Inactive</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(207,34,46,0.13)', color: '#cf222e' }}>
            <i className="fa-solid fa-circle-xmark" />
          </div>
          <div>
            <div className="stat-val">{employees.filter((e) => e.status === 'terminated').length}</div>
            <div className="stat-label">Terminated</div>
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '16px 20px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Employee Directory</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              className="search-input"
              placeholder="Search name / code / email…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: 240 }}
            />
            <select
              className="filter-select"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="terminated">Terminated</option>
            </select>
          </div>
        </div>
        {loading ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text2)' }}>Loading employees…</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text2)' }}>
            {employees.length === 0 ? 'No employees yet. Click "Add Employee" to get started.' : 'No matches.'}
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Name</th>
                  <th>Job Title</th>
                  <th>Department</th>
                  <th>Email</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((e) => (
                  <tr key={e.id}>
                    <td style={{ fontFamily: 'JetBrains Mono, monospace' }}>{e.employee_code}</td>
                    <td className="td-name">{e.employee_name}</td>
                    <td>{e.job_title ?? '—'}</td>
                    <td>{e.department ?? '—'}</td>
                    <td>{e.email ?? '—'}</td>
                    <td><span className={statusClass(e.status)}>{e.status ?? 'active'}</span></td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button
                        className="btn btn-outline btn-sm"
                        title="View"
                        onClick={() => navigate('hr-employee-detail', { employeeId: e.id })}
                        style={{ marginRight: 4 }}
                      >
                        <i className="fa-solid fa-eye" />
                      </button>
                      {can('employees', 'write') && (
                        <button
                          className="btn btn-outline btn-sm"
                          title="Edit"
                          onClick={() => navigate('hr-employee-form', { mode: 'edit', employeeId: e.id })}
                          style={{ marginRight: 4 }}
                        >
                          <i className="fa-solid fa-pen" />
                        </button>
                      )}
                      {can('employees', 'delete') && (
                        <button
                          className="btn btn-danger btn-sm"
                          title="Delete"
                          onClick={() => void handleDelete(e.id, e.employee_name)}
                        >
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
