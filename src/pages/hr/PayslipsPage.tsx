import { useMemo, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { useUserRole } from '@/hooks/hr/useUserRole';
import { usePayslips, type PayslipWithEmployee } from '@/hooks/hr/usePayslips';
import { fmtCurrency, fmtDate } from '@/lib/hr/leaveUtils';
import { supabase } from '@/integrations/supabase/client';

const statusBadge = (s: string): string => {
  if (s === 'confirmed') return 'badge badge-active';
  if (s === 'cancelled') return 'badge badge-fail';
  return 'badge badge-inactive';
};

export default function PayslipsPage() {
  const { navigate, toast } = useApp();
  const { can } = useUserRole();
  const { payslips, loading, refetch } = usePayslips();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const writeOk = can('payslips', 'write');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return payslips.filter((p) => {
      if (statusFilter !== 'all' && p.status !== statusFilter) return false;
      if (!q) return true;
      return (
        (p.reference ?? '').toLowerCase().includes(q) ||
        (p.employee_name ?? '').toLowerCase().includes(q) ||
        (p.employee_code ?? '').toLowerCase().includes(q)
      );
    });
  }, [payslips, search, statusFilter]);

  const handleDelete = async (p: PayslipWithEmployee) => {
    if (!window.confirm(`Delete payslip ${p.reference}?`)) return;
    const { error } = await supabase.from('payslips').delete().eq('id', p.id);
    if (error) { toast(error.message, 'error'); return; }
    toast('Payslip deleted', 'info');
    void refetch();
  };

  const handleConfirm = async (p: PayslipWithEmployee) => {
    const { error } = await supabase.from('payslips').update({ status: 'confirmed' }).eq('id', p.id);
    if (error) { toast(error.message, 'error'); return; }
    toast(`${p.reference} confirmed`, 'success');
    void refetch();
  };

  const totals = {
    gross: filtered.reduce((s, p) => s + Number(p.gross_salary), 0),
    deductions: filtered.reduce((s, p) => s + Number(p.total_deductions), 0),
    net: filtered.reduce((s, p) => s + Number(p.net_salary), 0),
  };

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Payslips</div>
          <div className="page-sub">HR Management · {filtered.length} of {payslips.length}</div>
        </div>
        {writeOk && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-outline btn-sm" onClick={() => navigate('hr-payslip-batch')}>
              <i className="fa-solid fa-layer-group" /> Batch Generate
            </button>
            <button className="btn btn-primary btn-sm" onClick={() => navigate('hr-payslip-detail', { mode: 'create' })}>
              <i className="fa-solid fa-plus" /> New Payslip
            </button>
          </div>
        )}
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(37,99,235,0.13)', color: '#2563eb' }}>
            <i className="fa-solid fa-file-invoice" />
          </div>
          <div>
            <div className="stat-val">{filtered.length}</div>
            <div className="stat-label">Records</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(212,146,10,0.13)', color: '#d4920a' }}>
            <i className="fa-solid fa-money-bill-wave" />
          </div>
          <div>
            <div className="stat-val" style={{ fontSize: 16 }}>{fmtCurrency(totals.gross)}</div>
            <div className="stat-label">Total Gross</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(207,34,46,0.13)', color: '#cf222e' }}>
            <i className="fa-solid fa-receipt" />
          </div>
          <div>
            <div className="stat-val" style={{ fontSize: 16 }}>{fmtCurrency(totals.deductions)}</div>
            <div className="stat-label">Total Deductions</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(26,127,55,0.13)', color: '#1a7f37' }}>
            <i className="fa-solid fa-sack-dollar" />
          </div>
          <div>
            <div className="stat-val" style={{ fontSize: 16, color: '#1a7f37' }}>{fmtCurrency(totals.net)}</div>
            <div className="stat-label">Total Net</div>
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Payslip List</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input className="search-input" placeholder="Search reference / employee…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: 240 }} />
            <select className="filter-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="all">All</option>
              <option value="draft">Draft</option>
              <option value="confirmed">Confirmed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
        </div>
        {loading ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text2)' }}>Loading…</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text2)' }}>
            {payslips.length === 0 ? 'No payslips yet.' : 'No matches.'}
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Employee</th>
                  <th>Period</th>
                  <th style={{ textAlign: 'right' }}>Basic</th>
                  <th style={{ textAlign: 'right' }}>Gross</th>
                  <th style={{ textAlign: 'right' }}>PAYE</th>
                  <th style={{ textAlign: 'right' }}>Net</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr key={p.id}>
                    <td style={{ fontFamily: 'JetBrains Mono, monospace' }}>{p.reference}</td>
                    <td>
                      <div className="td-name">{p.employee_name ?? '—'}</div>
                      <div style={{ fontSize: 10, color: 'var(--text3)' }}>{p.employee_code}</div>
                    </td>
                    <td>{fmtDate(p.period_from)} → {fmtDate(p.period_to)}</td>
                    <td style={{ textAlign: 'right' }}>{fmtCurrency(p.basic_salary)}</td>
                    <td style={{ textAlign: 'right' }}>{fmtCurrency(p.gross_salary)}</td>
                    <td style={{ textAlign: 'right' }}>{fmtCurrency(p.paye_tax)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600, color: '#1a7f37' }}>{fmtCurrency(p.net_salary)}</td>
                    <td><span className={statusBadge(p.status)}>{p.status}</span></td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button className="btn btn-outline btn-sm" onClick={() => navigate('hr-payslip-detail', { payslipId: p.id })} style={{ marginRight: 4 }} title="View">
                        <i className="fa-solid fa-eye" />
                      </button>
                      {writeOk && p.status === 'draft' && (
                        <button className="btn btn-green btn-sm" onClick={() => void handleConfirm(p)} style={{ marginRight: 4 }} title="Confirm">
                          <i className="fa-solid fa-check" />
                        </button>
                      )}
                      {writeOk && (
                        <button className="btn btn-danger btn-sm" onClick={() => void handleDelete(p)} title="Delete">
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
