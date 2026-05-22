import { useEffect, useMemo, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { useUserRole } from '@/hooks/hr/useUserRole';
import { supabase } from '@/integrations/supabase/client';
import { fmtCurrency, fmtDate } from '@/lib/hr/leaveUtils';

type ReportType = 'payroll' | 'leaves' | 'loans';

interface PayrollRow {
  id: string;
  reference: string;
  employee_name: string | null;
  employee_code: string | null;
  period_from: string;
  period_to: string;
  basic_salary: number;
  gross_salary: number;
  paye_tax: number;
  total_deductions: number;
  net_salary: number;
  status: string;
}

interface LeaveRow {
  id: string;
  employee_name: string | null;
  leave_type: string | null;
  start_date: string;
  end_date: string;
  number_of_days: number;
  status: string;
}

interface LoanRow {
  id: string;
  reference: string;
  employee_name: string | null;
  loan_type: string | null;
  total_amount: number;
  monthly_installment: number;
  remaining_amount: number | null;
  status: string;
  request_date: string;
}

export default function HRReportsPage() {
  const { toast, activePage } = useApp();
  const { isHR } = useUserRole();
  // Pre-select the tab matching the sidebar entry that opened this page so
  // "Loan Report" lands on Loans, "Payroll Report" lands on Payroll, etc.
  const initialTab: ReportType =
    activePage === 'hr-loan-report'    ? 'loans' :
    activePage === 'hr-leave-report'   ? 'leaves' :
                                         'payroll';
  const [tab, setTab] = useState<ReportType>(initialTab);
  // Default to a wide window around today so payslips with a period_to in the
  // near future (e.g. cycle ending on the 23rd while today is the 22nd) still
  // show up without the user having to fiddle with the date pickers.
  const now = new Date();
  const defaultFrom = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 10);
  const defaultTo = new Date(now.getFullYear(), now.getMonth() + 2, 0).toISOString().slice(0, 10);
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [loading, setLoading] = useState(false);
  const [payroll, setPayroll] = useState<PayrollRow[]>([]);
  const [leaves, setLeaves] = useState<LeaveRow[]>([]);
  const [loans, setLoans] = useState<LoanRow[]>([]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void (async () => {
      if (tab === 'payroll') {
        const { data, error } = await supabase
          .from('payslips')
          .select('id, reference, period_from, period_to, basic_salary, gross_salary, paye_tax, total_deductions, net_salary, status, employees(employee_name, employee_code)')
          .gte('period_to', from)
          .lte('period_to', to)
          .order('period_to', { ascending: false });
        if (!active) return;
        if (error) toast(error.message, 'error');
        setPayroll(((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
          id: r.id as string,
          reference: r.reference as string,
          period_from: r.period_from as string,
          period_to: r.period_to as string,
          basic_salary: r.basic_salary as number,
          gross_salary: r.gross_salary as number,
          paye_tax: r.paye_tax as number,
          total_deductions: r.total_deductions as number,
          net_salary: r.net_salary as number,
          status: r.status as string,
          employee_name: (r.employees as { employee_name?: string } | null)?.employee_name ?? null,
          employee_code: (r.employees as { employee_code?: string } | null)?.employee_code ?? null,
        })));
      } else if (tab === 'leaves') {
        const { data, error } = await supabase
          .from('leave_requests')
          .select(
            'id, start_date, end_date, number_of_days, status, employees!leave_requests_employee_id_fkey(employee_name), leave_types(name)',
          )
          .gte('start_date', from)
          .lte('end_date', to)
          .order('start_date', { ascending: false });
        if (!active) return;
        if (error) toast(error.message, 'error');
        setLeaves(((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
          id: r.id as string,
          start_date: r.start_date as string,
          end_date: r.end_date as string,
          number_of_days: r.number_of_days as number,
          status: r.status as string,
          employee_name: (r.employees as { employee_name?: string } | null)?.employee_name ?? null,
          leave_type: (r.leave_types as { name?: string } | null)?.name ?? null,
        })));
      } else {
        const { data, error } = await supabase
          .from('advance_salaries')
          .select('id, reference, loan_type, total_amount, monthly_installment, remaining_amount, status, request_date, employees(employee_name)')
          .gte('request_date', from)
          .lte('request_date', to)
          .order('request_date', { ascending: false });
        if (!active) return;
        if (error) toast(error.message, 'error');
        setLoans(((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
          id: r.id as string,
          reference: r.reference as string,
          loan_type: r.loan_type as string | null,
          total_amount: r.total_amount as number,
          monthly_installment: r.monthly_installment as number,
          remaining_amount: r.remaining_amount as number | null,
          status: r.status as string,
          request_date: r.request_date as string,
          employee_name: (r.employees as { employee_name?: string } | null)?.employee_name ?? null,
        })));
      }
      setLoading(false);
    })();
    return () => { active = false; };
  }, [tab, from, to, toast]);

  const totals = useMemo(() => {
    if (tab === 'payroll') {
      return {
        records: payroll.length,
        gross: payroll.reduce((s, r) => s + r.gross_salary, 0),
        paye: payroll.reduce((s, r) => s + r.paye_tax, 0),
        net: payroll.reduce((s, r) => s + r.net_salary, 0),
      };
    }
    if (tab === 'leaves') {
      return {
        records: leaves.length,
        days: leaves.reduce((s, r) => s + Number(r.number_of_days), 0),
        approved: leaves.filter((r) => r.status === 'approved').length,
        pending: leaves.filter((r) => r.status === 'pending').length,
      };
    }
    return {
      records: loans.length,
      total: loans.reduce((s, r) => s + r.total_amount, 0),
      outstanding: loans.reduce((s, r) => s + (r.remaining_amount ?? 0), 0),
      approved: loans.filter((r) => r.status === 'Approved').length,
    };
  }, [tab, payroll, leaves, loans]);

  const exportCSV = () => {
    let csv = '';
    if (tab === 'payroll') {
      csv = 'Reference,Employee,Code,Period From,Period To,Basic,Gross,PAYE,Deductions,Net,Status\n';
      payroll.forEach((r) => {
        csv += [r.reference, r.employee_name ?? '', r.employee_code ?? '', r.period_from, r.period_to, r.basic_salary, r.gross_salary, r.paye_tax, r.total_deductions, r.net_salary, r.status].join(',') + '\n';
      });
    } else if (tab === 'leaves') {
      csv = 'Employee,Leave Type,Start,End,Days,Status\n';
      leaves.forEach((r) => {
        csv += [r.employee_name ?? '', r.leave_type ?? '', r.start_date, r.end_date, r.number_of_days, r.status].join(',') + '\n';
      });
    } else {
      csv = 'Reference,Employee,Type,Total,Monthly,Outstanding,Date,Status\n';
      loans.forEach((r) => {
        csv += [r.reference, r.employee_name ?? '', r.loan_type ?? '', r.total_amount, r.monthly_installment, r.remaining_amount ?? '', r.request_date, r.status].join(',') + '\n';
      });
    }
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hr-${tab}-${from}-to-${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!isHR) {
    return <div className="card" style={{ padding: 32, textAlign: 'center' }}>Permission denied.</div>;
  }

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">HR Reports</div>
          <div className="page-sub">HR Management · Analytics</div>
        </div>
        <button className="btn btn-outline btn-sm" onClick={exportCSV}>
          <i className="fa-solid fa-file-csv" /> Export CSV
        </button>
      </div>

      <div className="tabs">
        {(['payroll', 'leaves', 'loans'] as ReportType[]).map((t) => (
          <div
            key={t}
            className={`tab ${tab === t ? 'active' : ''}`}
            onClick={() => setTab(t)}
            style={{ textTransform: 'capitalize' }}
          >
            {t}
          </div>
        ))}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="form-row cols2">
          <div className="form-group">
            <label>From</label>
            <input type="date" className="form-input" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="form-group">
            <label>To</label>
            <input type="date" className="form-input" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
      </div>

      <div className="stat-grid">
        {tab === 'payroll' && (
          <>
            <div className="stat-card">
              <div className="stat-icon" style={{ background: 'rgba(37,99,235,0.13)', color: '#2563eb' }}><i className="fa-solid fa-list" /></div>
              <div><div className="stat-val">{totals.records}</div><div className="stat-label">Records</div></div>
            </div>
            <div className="stat-card">
              <div className="stat-icon" style={{ background: 'rgba(212,146,10,0.13)', color: '#d4920a' }}><i className="fa-solid fa-money-bill" /></div>
              <div><div className="stat-val" style={{ fontSize: 16 }}>{fmtCurrency(totals.gross ?? 0)}</div><div className="stat-label">Total Gross</div></div>
            </div>
            <div className="stat-card">
              <div className="stat-icon" style={{ background: 'rgba(130,80,223,0.13)', color: '#8250df' }}><i className="fa-solid fa-percent" /></div>
              <div><div className="stat-val" style={{ fontSize: 16 }}>{fmtCurrency(totals.paye ?? 0)}</div><div className="stat-label">Total PAYE</div></div>
            </div>
            <div className="stat-card">
              <div className="stat-icon" style={{ background: 'rgba(26,127,55,0.13)', color: '#1a7f37' }}><i className="fa-solid fa-sack-dollar" /></div>
              <div><div className="stat-val" style={{ fontSize: 16, color: '#1a7f37' }}>{fmtCurrency(totals.net ?? 0)}</div><div className="stat-label">Total Net</div></div>
            </div>
          </>
        )}
        {tab === 'leaves' && (
          <>
            <div className="stat-card">
              <div className="stat-icon" style={{ background: 'rgba(37,99,235,0.13)', color: '#2563eb' }}><i className="fa-solid fa-list" /></div>
              <div><div className="stat-val">{totals.records}</div><div className="stat-label">Requests</div></div>
            </div>
            <div className="stat-card">
              <div className="stat-icon" style={{ background: 'rgba(212,146,10,0.13)', color: '#d4920a' }}><i className="fa-solid fa-calendar-day" /></div>
              <div><div className="stat-val">{totals.days ?? 0}</div><div className="stat-label">Total Days</div></div>
            </div>
            <div className="stat-card">
              <div className="stat-icon" style={{ background: 'rgba(26,127,55,0.13)', color: '#1a7f37' }}><i className="fa-solid fa-check" /></div>
              <div><div className="stat-val">{totals.approved ?? 0}</div><div className="stat-label">Approved</div></div>
            </div>
            <div className="stat-card">
              <div className="stat-icon" style={{ background: 'rgba(212,146,10,0.13)', color: '#d4920a' }}><i className="fa-solid fa-clock" /></div>
              <div><div className="stat-val">{totals.pending ?? 0}</div><div className="stat-label">Pending</div></div>
            </div>
          </>
        )}
        {tab === 'loans' && (
          <>
            <div className="stat-card">
              <div className="stat-icon" style={{ background: 'rgba(37,99,235,0.13)', color: '#2563eb' }}><i className="fa-solid fa-list" /></div>
              <div><div className="stat-val">{totals.records}</div><div className="stat-label">Records</div></div>
            </div>
            <div className="stat-card">
              <div className="stat-icon" style={{ background: 'rgba(212,146,10,0.13)', color: '#d4920a' }}><i className="fa-solid fa-money-bill" /></div>
              <div><div className="stat-val" style={{ fontSize: 16 }}>{fmtCurrency(totals.total ?? 0)}</div><div className="stat-label">Total Issued</div></div>
            </div>
            <div className="stat-card">
              <div className="stat-icon" style={{ background: 'rgba(207,34,46,0.13)', color: '#cf222e' }}><i className="fa-solid fa-hand-holding-dollar" /></div>
              <div><div className="stat-val" style={{ fontSize: 16 }}>{fmtCurrency(totals.outstanding ?? 0)}</div><div className="stat-label">Outstanding</div></div>
            </div>
            <div className="stat-card">
              <div className="stat-icon" style={{ background: 'rgba(26,127,55,0.13)', color: '#1a7f37' }}><i className="fa-solid fa-check" /></div>
              <div><div className="stat-val">{totals.approved ?? 0}</div><div className="stat-label">Approved</div></div>
            </div>
          </>
        )}
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid var(--border)', fontSize: 13, fontWeight: 600, textTransform: 'capitalize' }}>
          {tab} Detail
        </div>
        {loading ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text2)' }}>Loading…</div>
        ) : (
          <div className="table-wrap">
            {tab === 'payroll' && (
              <table>
                <thead>
                  <tr>
                    <th>Reference</th>
                    <th>Employee</th>
                    <th>Period</th>
                    <th style={{ textAlign: 'right' }}>Gross</th>
                    <th style={{ textAlign: 'right' }}>PAYE</th>
                    <th style={{ textAlign: 'right' }}>Net</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {payroll.map((r) => (
                    <tr key={r.id}>
                      <td style={{ fontFamily: 'JetBrains Mono, monospace' }}>{r.reference}</td>
                      <td>{r.employee_name ?? '—'}</td>
                      <td>{fmtDate(r.period_from)} → {fmtDate(r.period_to)}</td>
                      <td style={{ textAlign: 'right' }}>{fmtCurrency(r.gross_salary)}</td>
                      <td style={{ textAlign: 'right' }}>{fmtCurrency(r.paye_tax)}</td>
                      <td style={{ textAlign: 'right', color: '#1a7f37' }}>{fmtCurrency(r.net_salary)}</td>
                      <td style={{ textTransform: 'capitalize' }}>{r.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {tab === 'leaves' && (
              <table>
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Type</th>
                    <th>Period</th>
                    <th>Days</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {leaves.map((r) => (
                    <tr key={r.id}>
                      <td>{r.employee_name ?? '—'}</td>
                      <td>{r.leave_type ?? '—'}</td>
                      <td>{fmtDate(r.start_date)} → {fmtDate(r.end_date)}</td>
                      <td>{r.number_of_days}</td>
                      <td style={{ textTransform: 'capitalize' }}>{r.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {tab === 'loans' && (
              <table>
                <thead>
                  <tr>
                    <th>Reference</th>
                    <th>Employee</th>
                    <th>Type</th>
                    <th style={{ textAlign: 'right' }}>Total</th>
                    <th style={{ textAlign: 'right' }}>Monthly</th>
                    <th style={{ textAlign: 'right' }}>Outstanding</th>
                    <th>Date</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {loans.map((r) => (
                    <tr key={r.id}>
                      <td style={{ fontFamily: 'JetBrains Mono, monospace' }}>{r.reference}</td>
                      <td>{r.employee_name ?? '—'}</td>
                      <td>{r.loan_type ?? '—'}</td>
                      <td style={{ textAlign: 'right' }}>{fmtCurrency(r.total_amount)}</td>
                      <td style={{ textAlign: 'right' }}>{fmtCurrency(r.monthly_installment)}</td>
                      <td style={{ textAlign: 'right' }}>{fmtCurrency(r.remaining_amount)}</td>
                      <td>{fmtDate(r.request_date)}</td>
                      <td>{r.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </>
  );
}
