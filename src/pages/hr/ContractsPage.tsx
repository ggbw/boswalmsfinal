import { useMemo, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { useUserRole } from '@/hooks/hr/useUserRole';
import { useContracts, type ContractWithEmployee } from '@/hooks/hr/useContracts';
import { useEmployees } from '@/hooks/hr/useEmployees';
import { fmtCurrency, fmtDate } from '@/lib/hr/leaveUtils';
import { supabase } from '@/integrations/supabase/client';

const statusBadge = (s: string): string => {
  if (s === 'active') return 'badge badge-active';
  if (s === 'suspended') return 'badge badge-pending';
  return 'badge badge-inactive';
};

export default function ContractsPage() {
  const { navigate, toast } = useApp();
  const { can } = useUserRole();
  const { contracts, loading, refetch } = useContracts();
  const { employees } = useEmployees();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ employee_id: '', contract_name: '', wage: '', start_date: '' });

  const writeOk = can('contracts', 'write');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return contracts.filter((c) => {
      if (statusFilter !== 'all' && c.status !== statusFilter) return false;
      if (!q) return true;
      return (
        (c.employee_name ?? '').toLowerCase().includes(q) ||
        (c.employee_code ?? '').toLowerCase().includes(q) ||
        (c.contract_name ?? '').toLowerCase().includes(q) ||
        (c.job_position ?? '').toLowerCase().includes(q)
      );
    });
  }, [contracts, search, statusFilter]);

  const handleCreate = async () => {
    if (!form.employee_id || !form.wage) { toast('Employee and wage are required', 'error'); return; }
    const { data, error } = await supabase
      .from('contracts')
      .insert({
        employee_id: form.employee_id,
        contract_name: form.contract_name.trim() || null,
        wage: Number(form.wage),
        start_date: form.start_date || null,
        status: 'active',
      })
      .select('id')
      .single();
    if (error) { toast(error.message, 'error'); return; }
    toast('Contract created', 'success');
    setForm({ employee_id: '', contract_name: '', wage: '', start_date: '' });
    setCreating(false);
    void refetch();
    if (data?.id) navigate('hr-contract-detail', { contractId: data.id as string });
  };

  const handleDelete = async (c: ContractWithEmployee) => {
    if (!window.confirm(`Delete contract for ${c.employee_name ?? '—'}?`)) return;
    const { error } = await supabase.from('contracts').delete().eq('id', c.id);
    if (error) { toast(error.message, 'error'); return; }
    toast('Contract deleted', 'info');
    void refetch();
  };

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Contracts</div>
          <div className="page-sub">HR Management · {filtered.length} of {contracts.length}</div>
        </div>
        {writeOk && (
          <button className="btn btn-primary btn-sm" onClick={() => setCreating((c) => !c)}>
            <i className="fa-solid fa-plus" /> {creating ? 'Cancel' : 'New Contract'}
          </button>
        )}
      </div>

      {creating && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-title"><span>New Contract</span></div>
          <div className="form-row cols2">
            <div className="form-group">
              <label>Employee *</label>
              <select className="form-select" value={form.employee_id} onChange={(e) => setForm({ ...form, employee_id: e.target.value })}>
                <option value="">— Select —</option>
                {employees.map((e) => <option key={e.id} value={e.id}>{e.employee_name} ({e.employee_code})</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Contract Name</label>
              <input className="form-input" value={form.contract_name} onChange={(e) => setForm({ ...form, contract_name: e.target.value })} />
            </div>
          </div>
          <div className="form-row cols2">
            <div className="form-group">
              <label>Monthly Wage *</label>
              <input type="number" step="0.01" className="form-input" value={form.wage} onChange={(e) => setForm({ ...form, wage: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Start Date</label>
              <input type="date" className="form-input" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <button className="btn btn-primary btn-sm" onClick={() => void handleCreate()}>
              <i className="fa-solid fa-floppy-disk" /> Create & Edit Lines
            </button>
          </div>
        </div>
      )}

      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Contract Directory</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input className="search-input" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: 220 }} />
            <select className="filter-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="all">All</option>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
        </div>
        {loading ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text2)' }}>Loading…</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text2)' }}>
            {contracts.length === 0 ? 'No contracts yet.' : 'No matches.'}
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Contract Name</th>
                  <th>Job Position</th>
                  <th style={{ textAlign: 'right' }}>Wage</th>
                  <th>Period</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <div className="td-name">{c.employee_name ?? '—'}</div>
                      <div style={{ fontSize: 10, color: 'var(--text3)' }}>{c.employee_code}</div>
                    </td>
                    <td>{c.contract_name ?? '—'}</td>
                    <td>{c.job_position ?? '—'}</td>
                    <td style={{ textAlign: 'right' }}>{fmtCurrency(c.wage)}</td>
                    <td>
                      {c.start_date ? fmtDate(c.start_date) : '—'}
                      {c.end_date ? ` → ${fmtDate(c.end_date)}` : ''}
                    </td>
                    <td><span className={statusBadge(c.status)}>{c.status}</span></td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button className="btn btn-outline btn-sm" onClick={() => navigate('hr-contract-detail', { contractId: c.id })} style={{ marginRight: 4 }} title="Open">
                        <i className="fa-solid fa-eye" />
                      </button>
                      {writeOk && (
                        <button className="btn btn-danger btn-sm" onClick={() => void handleDelete(c)} title="Delete">
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
