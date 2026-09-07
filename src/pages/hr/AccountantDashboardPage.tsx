import { useEffect, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { supabase } from '@/integrations/supabase/client';
import { fmtCurrency, fmtDate } from '@/lib/hr/leaveUtils';
import { BreakdownDonut } from '@/components/charts/DashboardCharts';

/**
 * Accountant dashboard.
 *
 * The Accountant role covers payroll and contracts and nothing else, so this
 * answers the questions someone opens it to decide, rather than restating how
 * many employees the school has:
 *
 *   • What does this month cost, and how much of it is already paid?
 *   • What is waiting on me — unfinished payslips, contracts about to lapse?
 *   • Where is the money going — which departments, and earnings vs deductions?
 *
 * Every figure is a link to the page that acts on it. A number that cannot be
 * acted on is decoration.
 */

interface PayslipRow {
  id: string;
  employee_id: string | null;
  reference: string;
  payslip_name: string | null;
  status: string | null;
  period_from: string;
  period_to: string;
  gross_salary: number | null;
  net_salary: number | null;
  paye_tax: number | null;
  total_deductions: number | null;
}

interface ContractRow {
  id: string;
  employee_id: string | null;
  contract_name: string | null;
  job_position: string | null;
  department: string | null;
  status: string | null;
  end_date: string | null;
}

interface EmployeeRow {
  id: string;
  employee_name: string;
  department: string | null;
  status: string | null;
  basic_salary: number | null;
}

interface Stats {
  monthlyPayrollEstimate: number;
  activeEmployees: number;
  periodGross: number;
  periodNet: number;
  periodPaye: number;
  periodDeductions: number;
  periodCount: number;
  draftPayslips: number;
  activeContracts: number;
  expiringContracts: ContractRow[];
  noContract: EmployeeRow[];
  byDepartment: { name: string; value: number }[];
  recentPayslips: Array<PayslipRow & { employee_name: string | null }>;
}

/** A payslip counts as settled only when it has been marked paid or final. */
const SETTLED = ['paid', 'final', 'approved', 'completed'];
const isSettled = (s: string | null) => SETTLED.includes((s ?? '').toLowerCase());

const statusBadge = (s: string | null) => {
  const v = (s ?? '').toLowerCase();
  if (isSettled(v)) return 'badge badge-active';
  if (v === 'cancelled' || v === 'void') return 'badge badge-inactive';
  return 'badge badge-pending';
};

export default function AccountantDashboardPage() {
  const { navigate } = useApp();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
      const today = now.toISOString().slice(0, 10);
      // 60 days is far enough ahead to renew a contract without rushing, and
      // near enough that the list stays short enough to act on.
      const horizon = new Date(now.getTime() + 60 * 86400000).toISOString().slice(0, 10);

      const [empRes, slipRes, conRes, recentRes] = await Promise.all([
        supabase.from('employees').select('id, employee_name, department, status, basic_salary'),
        // Payslips whose period OVERLAPS this month, not merely those starting
        // in it — a period running 26th to 25th belongs to both months and
        // would otherwise vanish from one of them.
        supabase.from('payslips')
          .select('id, employee_id, reference, payslip_name, status, period_from, period_to, gross_salary, net_salary, paye_tax, total_deductions')
          .lte('period_from', monthEnd).gte('period_to', monthStart),
        supabase.from('contracts')
          .select('id, employee_id, contract_name, job_position, department, status, end_date'),
        supabase.from('payslips')
          .select('id, employee_id, reference, payslip_name, status, period_from, period_to, gross_salary, net_salary, paye_tax, total_deductions')
          .order('period_to', { ascending: false }).limit(8),
      ]);

      if (!active) return;

      // Surface a failed query rather than rendering zeros. An empty table and
      // a refused read look identical once the error is swallowed, and that
      // has been the single most expensive habit in this codebase.
      const failed = [empRes, slipRes, conRes, recentRes].find(r => r.error);
      if (failed?.error) {
        setError(failed.error.message);
        setLoading(false);
        return;
      }

      const employees = (empRes.data ?? []) as EmployeeRow[];
      const slips = (slipRes.data ?? []) as PayslipRow[];
      const contracts = (conRes.data ?? []) as ContractRow[];
      const recent = (recentRes.data ?? []) as PayslipRow[];

      const activeEmp = employees.filter(e => (e.status ?? 'active') === 'active');
      const nameOf = (id: string | null) =>
        employees.find(e => e.id === id)?.employee_name ?? null;

      const withContract = new Set(
        contracts.filter(c => (c.status ?? 'active') === 'active').map(c => c.employee_id),
      );

      // Cost by department, from the salary on record rather than from issued
      // payslips, so the split still reads correctly before a run is made.
      const deptTotals = new Map<string, number>();
      activeEmp.forEach(e => {
        const key = e.department?.trim() || 'Unassigned';
        deptTotals.set(key, (deptTotals.get(key) ?? 0) + (e.basic_salary ?? 0));
      });

      setStats({
        monthlyPayrollEstimate: activeEmp.reduce((s, e) => s + (e.basic_salary ?? 0), 0),
        activeEmployees: activeEmp.length,
        periodGross: slips.reduce((s, p) => s + (p.gross_salary ?? 0), 0),
        periodNet: slips.filter(p => isSettled(p.status)).reduce((s, p) => s + (p.net_salary ?? 0), 0),
        periodPaye: slips.reduce((s, p) => s + (p.paye_tax ?? 0), 0),
        periodDeductions: slips.reduce((s, p) => s + (p.total_deductions ?? 0), 0),
        periodCount: slips.length,
        draftPayslips: slips.filter(p => !isSettled(p.status)).length,
        activeContracts: contracts.filter(c => (c.status ?? 'active') === 'active').length,
        expiringContracts: contracts
          .filter(c => c.end_date && c.end_date >= today && c.end_date <= horizon)
          .sort((a, b) => (a.end_date ?? '').localeCompare(b.end_date ?? ''))
          .slice(0, 6),
        noContract: activeEmp.filter(e => !withContract.has(e.id)).slice(0, 6),
        byDepartment: [...deptTotals.entries()]
          .map(([name, value]) => ({ name, value: Math.round(value) }))
          .sort((a, b) => b.value - a.value),
        recentPayslips: recent.map(p => ({ ...p, employee_name: nameOf(p.employee_id) })),
      });
      setLoading(false);
    })();
    return () => { active = false; };
  }, []);

  const statTile = (
    label: string,
    value: React.ReactNode,
    icon: string,
    color: string,
    sub?: string,
    onClick?: () => void,
  ) => (
    <div className="stat-card" onClick={onClick} style={onClick ? { cursor: 'pointer' } : undefined}>
      <div className="stat-icon" style={{ background: `${color}22`, color }}>
        <i className={icon} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div className="stat-val" style={{ fontSize: 18 }}>{value}</div>
        <div className="stat-label">{label}</div>
        {sub && <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>{sub}</div>}
      </div>
    </div>
  );

  const monthName = new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  if (error) {
    return (
      <>
        <div className="page-header"><div><div className="page-title">Accountant Dashboard</div></div></div>
        <div className="card" style={{ padding: 24, color: 'var(--danger)', fontSize: 13, lineHeight: 1.7 }}>
          <strong><i className="fa-solid fa-triangle-exclamation" /> Could not load payroll data.</strong>
          <div style={{ marginTop: 8, color: 'var(--text2)' }}>{error}</div>
          <div style={{ marginTop: 8, color: 'var(--text2)' }}>
            If this says permission denied, the payroll access migration may not have been applied yet.
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Accountant Dashboard</div>
          <div className="page-sub">Payroll &amp; contracts · {monthName}</div>
        </div>
      </div>

      {loading || !stats ? (
        <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text2)', fontSize: 13 }}>
          Loading payroll figures…
        </div>
      ) : (
        <>
          <div className="stat-grid">
            {statTile('Est. Monthly Payroll', fmtCurrency(stats.monthlyPayrollEstimate),
              'fa-solid fa-money-check-dollar', '#1a7f37',
              `${stats.activeEmployees} active employee(s)`)}
            {statTile('Gross This Period', fmtCurrency(stats.periodGross),
              'fa-solid fa-file-invoice-dollar', '#0550ae',
              `${stats.periodCount} payslip(s)`, () => navigate('hr-payslips'))}
            {statTile('Net Paid', fmtCurrency(stats.periodNet),
              'fa-solid fa-circle-check', '#1a7f37',
              'settled payslips only', () => navigate('hr-payslips'))}
            {statTile('PAYE This Period', fmtCurrency(stats.periodPaye),
              'fa-solid fa-landmark', '#8250df', 'tax withheld')}
            {statTile('Total Deductions', fmtCurrency(stats.periodDeductions),
              'fa-solid fa-scissors', '#cf222e', 'all payslips this period')}
            {statTile('Payslips To Finish', stats.draftPayslips,
              'fa-solid fa-pen-to-square',
              stats.draftPayslips > 0 ? '#d4920a' : '#1a7f37',
              stats.draftPayslips > 0 ? 'not yet marked paid' : 'all settled',
              () => navigate('hr-payslips'))}
            {statTile('Active Contracts', stats.activeContracts,
              'fa-solid fa-file-signature', '#0550ae',
              undefined, () => navigate('hr-contracts'))}
            {statTile('Expiring in 60 Days', stats.expiringContracts.length,
              'fa-solid fa-hourglass-half',
              stats.expiringContracts.length > 0 ? '#d4920a' : '#1a7f37',
              stats.expiringContracts.length > 0 ? 'needs renewal' : 'none due',
              () => navigate('hr-contracts'))}
          </div>

          <div className="two-col">
            <div className="card">
              <div className="card-title"><span><i className="fa-solid fa-chart-pie" /> Payroll cost by department</span></div>
              {/* Salary on record, not issued payslips, so the split reads
                  correctly before a run has been made. */}
              <BreakdownDonut data={stats.byDepartment} />
            </div>

            <div className="card">
              <div className="card-title">
                <span><i className="fa-solid fa-triangle-exclamation" /> Needs attention</span>
              </div>
              {stats.expiringContracts.length === 0 && stats.noContract.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 28, color: 'var(--text2)', fontSize: 12 }}>
                  <i className="fa-solid fa-circle-check" style={{ color: '#1a7f37', marginRight: 6 }} />
                  No contracts expiring and everyone is on one.
                </div>
              ) : (
                <div style={{ display: 'grid', gap: 8 }}>
                  {stats.expiringContracts.map(c => (
                    <div key={c.id} className="info-row">
                      <span className="info-label">
                        {c.contract_name || c.job_position || 'Contract'}
                        {c.department && <span style={{ color: 'var(--text3)' }}> · {c.department}</span>}
                      </span>
                      <span className="badge badge-pending">expires {fmtDate(c.end_date)}</span>
                    </div>
                  ))}
                  {stats.noContract.map(e => (
                    <div key={e.id} className="info-row">
                      <span className="info-label">{e.employee_name}
                        {e.department && <span style={{ color: 'var(--text3)' }}> · {e.department}</span>}
                      </span>
                      <span className="badge badge-fail">no active contract</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-title">
              <span><i className="fa-solid fa-receipt" /> Recent payslips</span>
              <button className="btn btn-sm btn-outline" onClick={() => navigate('hr-payslips')}>View all</button>
            </div>
            {stats.recentPayslips.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 28, color: 'var(--text2)', fontSize: 12 }}>
                No payslips have been generated yet.
              </div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Employee</th><th>Reference</th><th>Period</th>
                      <th style={{ textAlign: 'right' }}>Gross</th>
                      <th style={{ textAlign: 'right' }}>Net</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.recentPayslips.map(p => (
                      <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => navigate('hr-payslips')}>
                        <td className="td-name">{p.employee_name || <span style={{ color: 'var(--text3)' }}>—</span>}</td>
                        <td style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11 }}>{p.reference}</td>
                        <td style={{ fontSize: 11 }}>{fmtDate(p.period_from)} — {fmtDate(p.period_to)}</td>
                        <td style={{ textAlign: 'right', fontFamily: "'JetBrains Mono',monospace", fontSize: 11 }}>{fmtCurrency(p.gross_salary)}</td>
                        <td style={{ textAlign: 'right', fontFamily: "'JetBrains Mono',monospace", fontSize: 11, fontWeight: 700 }}>{fmtCurrency(p.net_salary)}</td>
                        <td><span className={statusBadge(p.status)}>{p.status || 'draft'}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
