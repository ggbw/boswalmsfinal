import { useEffect, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { useUserRole } from '@/hooks/hr/useUserRole';
import { supabase } from '@/integrations/supabase/client';
import { fmtCurrency, fmtDate } from '@/lib/hr/leaveUtils';

interface Stats {
  totalEmployees: number;
  activeEmployees: number;
  pendingLeaves: number;
  pendingLoans: number;
  outstandingLoans: number;
  monthlyPayrollEstimate: number;
  upcomingHolidays: Array<{ id: string; name: string; date: string }>;
  recentLeaves: Array<{
    id: string;
    employee_name: string | null;
    leave_type: string | null;
    start_date: string;
    end_date: string;
    status: string;
  }>;
}

const statusBadge = (s: string) => {
  if (s === 'approved') return 'badge badge-active';
  if (s === 'rejected') return 'badge badge-fail';
  if (s === 'cancelled') return 'badge badge-inactive';
  return 'badge badge-pending';
};

export default function HRDashboardPage() {
  const { navigate } = useApp();
  const { isHR } = useUserRole();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void (async () => {
      const today = new Date().toISOString().slice(0, 10);
      const [empRes, leaveRes, loanRes, holidayRes, recentRes] = await Promise.all([
        supabase.from('employees').select('id, status, basic_salary'),
        supabase.from('leave_requests').select('id, status'),
        supabase.from('advance_salaries').select('id, status, remaining_amount'),
        supabase.from('public_holidays').select('id, name, date').gte('date', today).order('date').limit(5),
        supabase
          .from('leave_requests')
          .select(
            'id, status, start_date, end_date, employees!leave_requests_employee_id_fkey(employee_name), leave_types(name)',
          )
          .order('created_at', { ascending: false })
          .limit(5),
      ]);
      if (!active) return;

      const employees = (empRes.data ?? []) as Array<{ id: string; status: string | null; basic_salary: number | null }>;
      const leaves = (leaveRes.data ?? []) as Array<{ status: string }>;
      const loans = (loanRes.data ?? []) as Array<{ status: string; remaining_amount: number | null }>;

      setStats({
        totalEmployees: employees.length,
        activeEmployees: employees.filter((e) => (e.status ?? 'active') === 'active').length,
        pendingLeaves: leaves.filter((l) => l.status === 'pending').length,
        pendingLoans: loans.filter((l) => l.status === 'Submitted').length,
        outstandingLoans: loans
          .filter((l) => l.status === 'Approved')
          .reduce((s, l) => s + (l.remaining_amount ?? 0), 0),
        monthlyPayrollEstimate: employees
          .filter((e) => (e.status ?? 'active') === 'active')
          .reduce((s, e) => s + (e.basic_salary ?? 0), 0),
        upcomingHolidays: (holidayRes.data ?? []) as Stats['upcomingHolidays'],
        recentLeaves: ((recentRes.data ?? []) as Array<Record<string, unknown>>).map((r) => ({
          id: r.id as string,
          employee_name: (r.employees as { employee_name?: string } | null)?.employee_name ?? null,
          leave_type: (r.leave_types as { name?: string } | null)?.name ?? null,
          start_date: r.start_date as string,
          end_date: r.end_date as string,
          status: r.status as string,
        })),
      });
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  if (!isHR) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: 32 }}>
        You do not have permission to view the HR Dashboard.
      </div>
    );
  }

  const statTile = (
    label: string,
    value: React.ReactNode,
    icon: string,
    color: string,
    onClick?: () => void,
  ) => (
    <div className="stat-card" onClick={onClick} style={onClick ? { cursor: 'pointer' } : undefined}>
      <div className="stat-icon" style={{ background: `${color}22`, color }}>
        <i className={icon} />
      </div>
      <div>
        <div className="stat-val">{value}</div>
        <div className="stat-label">{label}</div>
      </div>
    </div>
  );

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">HR Dashboard</div>
          <div className="page-sub">Overview · all-time</div>
        </div>
      </div>

      {loading || !stats ? (
        <div className="card" style={{ textAlign: 'center', color: 'var(--text2)' }}>Loading…</div>
      ) : (
        <>
          <div className="stat-grid">
            {statTile(
              `Active Employees · of ${stats.totalEmployees}`,
              stats.activeEmployees,
              'fa-solid fa-users',
              '#2563eb',
              () => navigate('hr-employees'),
            )}
            {statTile(
              'Pending Leaves',
              stats.pendingLeaves,
              'fa-solid fa-calendar-days',
              '#d4920a',
              () => navigate('hr-leaves'),
            )}
            {statTile(
              'Pending Loans',
              stats.pendingLoans,
              'fa-solid fa-credit-card',
              '#8250df',
              () => navigate('hr-loans'),
            )}
            {statTile(
              'Outstanding Loans',
              fmtCurrency(stats.outstandingLoans),
              'fa-solid fa-hand-holding-dollar',
              '#cf222e',
            )}
            {statTile(
              'Est. Monthly Payroll',
              fmtCurrency(stats.monthlyPayrollEstimate),
              'fa-solid fa-money-check-dollar',
              '#1a7f37',
            )}
          </div>

          <div className="two-col">
            <div className="card">
              <div className="card-title">
                <span>Recent Leave Requests</span>
                <button className="btn btn-sm btn-outline" onClick={() => navigate('hr-leaves')}>
                  View all
                </button>
              </div>
              {stats.recentLeaves.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 24, color: 'var(--text2)', fontSize: 12 }}>
                  None yet.
                </div>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Employee</th>
                        <th>Type</th>
                        <th>Period</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.recentLeaves.map((l) => (
                        <tr key={l.id}>
                          <td className="td-name">{l.employee_name ?? '—'}</td>
                          <td>{l.leave_type ?? '—'}</td>
                          <td>{fmtDate(l.start_date)} → {fmtDate(l.end_date)}</td>
                          <td><span className={statusBadge(l.status)}>{l.status}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div className="card">
              <div className="card-title">
                <span>Upcoming Public Holidays</span>
                <button className="btn btn-sm btn-outline" onClick={() => navigate('hr-config')}>
                  Manage
                </button>
              </div>
              {stats.upcomingHolidays.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 24, color: 'var(--text2)', fontSize: 12 }}>
                  No upcoming holidays.
                </div>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Holiday</th>
                        <th>Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.upcomingHolidays.map((h) => (
                        <tr key={h.id}>
                          <td className="td-name">{h.name}</td>
                          <td>{fmtDate(h.date)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
