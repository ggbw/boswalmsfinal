import { useEffect, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/hooks/useAuth';
import { usePayslips } from '@/hooks/hr/usePayslips';
import { fmtCurrency, fmtDate } from '@/lib/hr/leaveUtils';
import { supabase } from '@/integrations/supabase/client';

const statusBadge = (s: string): string => {
  if (s === 'confirmed') return 'badge badge-active';
  if (s === 'cancelled') return 'badge badge-fail';
  return 'badge badge-inactive';
};

export default function MyPayslipsPage() {
  const { navigate } = useApp();
  const { user } = useAuth();
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [employeeLoaded, setEmployeeLoaded] = useState(false);

  useEffect(() => {
    if (!user) return;
    void supabase
      .from('employees')
      .select('id')
      .eq('auth_user_id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        setEmployeeId((data?.id as string) ?? null);
        setEmployeeLoaded(true);
      });
  }, [user]);

  const { payslips, loading } = usePayslips(employeeId ? { employeeId } : undefined);

  if (employeeLoaded && !employeeId) {
    return (
      <>
        <div className="page-header">
          <div>
            <div className="page-title">My Payslips</div>
            <div className="page-sub">Self-service</div>
          </div>
        </div>
        <div className="card" style={{ padding: 32, textAlign: 'center' }}>
          <i className="fa-solid fa-circle-info" style={{ fontSize: 24, color: '#d4920a', marginBottom: 12 }} />
          <div style={{ marginBottom: 8 }}>Your account is not linked to an employee record.</div>
          <div style={{ fontSize: 12, color: 'var(--text2)' }}>Contact HR to enable self-service features.</div>
        </div>
      </>
    );
  }

  const ytdNet = payslips
    .filter((p) => p.status === 'confirmed' && new Date(p.period_to).getFullYear() === new Date().getFullYear())
    .reduce((s, p) => s + Number(p.net_salary), 0);

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">My Payslips</div>
          <div className="page-sub">Self-service · {payslips.length} payslips</div>
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(37,99,235,0.13)', color: '#2563eb' }}>
            <i className="fa-solid fa-receipt" />
          </div>
          <div>
            <div className="stat-val">{payslips.length}</div>
            <div className="stat-label">Total Payslips</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(26,127,55,0.13)', color: '#1a7f37' }}>
            <i className="fa-solid fa-circle-check" />
          </div>
          <div>
            <div className="stat-val">{payslips.filter((p) => p.status === 'confirmed').length}</div>
            <div className="stat-label">Confirmed</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(212,146,10,0.13)', color: '#d4920a' }}>
            <i className="fa-solid fa-sack-dollar" />
          </div>
          <div>
            <div className="stat-val" style={{ fontSize: 16, color: '#1a7f37' }}>{fmtCurrency(ytdNet)}</div>
            <div className="stat-label">YTD Net</div>
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid var(--border)', fontSize: 13, fontWeight: 600 }}>
          Payslip History
        </div>
        {loading ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text2)' }}>Loading…</div>
        ) : payslips.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text2)' }}>No payslips yet.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Period</th>
                  <th style={{ textAlign: 'right' }}>Gross</th>
                  <th style={{ textAlign: 'right' }}>PAYE</th>
                  <th style={{ textAlign: 'right' }}>Net</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {payslips.map((p) => (
                  <tr key={p.id}>
                    <td style={{ fontFamily: 'JetBrains Mono, monospace' }}>{p.reference}</td>
                    <td>{fmtDate(p.period_from)} → {fmtDate(p.period_to)}</td>
                    <td style={{ textAlign: 'right' }}>{fmtCurrency(p.gross_salary)}</td>
                    <td style={{ textAlign: 'right' }}>{fmtCurrency(p.paye_tax)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600, color: '#1a7f37' }}>{fmtCurrency(p.net_salary)}</td>
                    <td><span className={statusBadge(p.status)}>{p.status}</span></td>
                    <td style={{ textAlign: 'right' }}>
                      <button className="btn btn-outline btn-sm" onClick={() => navigate('hr-payslip-detail', { payslipId: p.id })}>
                        <i className="fa-solid fa-eye" /> View
                      </button>
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
