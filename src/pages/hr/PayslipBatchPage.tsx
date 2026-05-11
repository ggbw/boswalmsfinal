import { useMemo, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { useUserRole } from '@/hooks/hr/useUserRole';
import { useEmployees } from '@/hooks/hr/useEmployees';
import { computePayslip, fmtMoney } from '@/lib/hr/payrollEngine';
import { fmtCurrency } from '@/lib/hr/leaveUtils';
import { supabase } from '@/integrations/supabase/client';
import { nextPayslipReference, type PayslipBreakdownLine } from '@/hooks/hr/usePayslips';

const monthRange = () => {
  const today = new Date();
  const from = new Date(today.getFullYear(), today.getMonth() - 1, 25);
  const to = new Date(today.getFullYear(), today.getMonth(), 24);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(from), to: iso(to) };
};

export default function PayslipBatchPage() {
  const { navigate, toast } = useApp();
  const { can } = useUserRole();
  const { employees, loading: empLoading } = useEmployees();

  const writeOk = can('payslips', 'write');

  const range = monthRange();
  const [periodFrom, setPeriodFrom] = useState(range.from);
  const [periodTo, setPeriodTo] = useState(range.to);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<Array<{ employee: string; reference?: string; net?: number; error?: string }>>([]);

  const eligible = useMemo(
    () => employees.filter((e) => (e.status ?? 'active') === 'active' && e.basic_salary > 0),
    [employees],
  );

  const toggle = (id: string) =>
    setSelected((s) => {
      const ns = new Set(s);
      if (ns.has(id)) ns.delete(id);
      else ns.add(id);
      return ns;
    });

  const toggleAll = () =>
    setSelected((s) => (s.size === eligible.length ? new Set() : new Set(eligible.map((e) => e.id))));

  const preview = useMemo(() => {
    const rows = eligible.filter((e) => selected.has(e.id));
    const totals = rows.reduce(
      (acc, e) => {
        const c = computePayslip(e.basic_salary, [], [], [], 0, 0);
        return {
          gross: acc.gross + c.grossSalary,
          paye: acc.paye + c.payeTax,
          net: acc.net + c.netSalary,
        };
      },
      { gross: 0, paye: 0, net: 0 },
    );
    return totals;
  }, [eligible, selected]);

  const handleGenerate = async () => {
    if (selected.size === 0) { toast('Select at least one employee', 'error'); return; }
    if (!periodFrom || !periodTo) { toast('Select period dates', 'error'); return; }
    if (!window.confirm(`Generate ${selected.size} draft payslip(s)?`)) return;

    setRunning(true);
    setResults([]);
    const out: typeof results = [];

    for (const e of eligible) {
      if (!selected.has(e.id)) continue;
      try {
        const reference = await nextPayslipReference();
        const c = computePayslip(e.basic_salary, [], [], [], 0, 0);
        const earningsBreakdown: PayslipBreakdownLine[] = c.allEarnings.map((l) => ({
          description: l.description, code: l.code, amount: l.amount, isTaxable: l.isTaxable,
        }));
        const deductionsBreakdown: PayslipBreakdownLine[] = c.allDeductions.map((l) => ({
          description: l.description, code: l.code, amount: l.amount,
        }));
        const { error } = await supabase.from('payslips').insert({
          reference,
          employee_id: e.id,
          period_from: periodFrom,
          period_to: periodTo,
          payslip_name: `Payslip - ${e.employee_name}`,
          basic_salary: e.basic_salary,
          gross_salary: c.grossSalary,
          total_deductions: c.totalDeductions,
          paye_tax: c.payeTax,
          net_salary: c.netSalary,
          earnings_breakdown: earningsBreakdown,
          deductions_breakdown: deductionsBreakdown,
          benefits_breakdown: [],
          status: 'draft',
        });
        if (error) {
          out.push({ employee: e.employee_name, error: error.message });
        } else {
          out.push({ employee: e.employee_name, reference, net: c.netSalary });
        }
      } catch (err) {
        out.push({ employee: e.employee_name, error: err instanceof Error ? err.message : 'Unknown error' });
      }
      setResults([...out]);
    }
    setRunning(false);
    const ok = out.filter((r) => !r.error).length;
    const fail = out.filter((r) => r.error).length;
    toast(`Generated ${ok} payslip(s)${fail ? ` · ${fail} failed` : ''}`, fail ? 'error' : 'success');
  };

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Batch Payslip Generation</div>
          <div className="page-sub">HR Management · Payroll</div>
        </div>
        <button className="btn btn-outline btn-sm" onClick={() => navigate('hr-payslips')}>
          <i className="fa-solid fa-arrow-left" /> Back
        </button>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title"><span>Period</span></div>
        <div className="form-row cols2">
          <div className="form-group">
            <label>From</label>
            <input type="date" className="form-input" value={periodFrom} onChange={(e) => setPeriodFrom(e.target.value)} />
          </div>
          <div className="form-group">
            <label>To</label>
            <input type="date" className="form-input" value={periodTo} onChange={(e) => setPeriodTo(e.target.value)} />
          </div>
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(37,99,235,0.13)', color: '#2563eb' }}>
            <i className="fa-solid fa-square-check" />
          </div>
          <div>
            <div className="stat-val">{selected.size}</div>
            <div className="stat-label">Selected</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(212,146,10,0.13)', color: '#d4920a' }}>
            <i className="fa-solid fa-money-bill" />
          </div>
          <div>
            <div className="stat-val" style={{ fontSize: 16 }}>{fmtCurrency(preview.gross)}</div>
            <div className="stat-label">Total Gross</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(130,80,223,0.13)', color: '#8250df' }}>
            <i className="fa-solid fa-percent" />
          </div>
          <div>
            <div className="stat-val" style={{ fontSize: 16 }}>{fmtCurrency(preview.paye)}</div>
            <div className="stat-label">Total PAYE</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(26,127,55,0.13)', color: '#1a7f37' }}>
            <i className="fa-solid fa-sack-dollar" />
          </div>
          <div>
            <div className="stat-val" style={{ fontSize: 16, color: '#1a7f37' }}>{fmtCurrency(preview.net)}</div>
            <div className="stat-label">Total Net</div>
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Eligible Employees ({eligible.length})</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-outline btn-sm" onClick={toggleAll}>
              {selected.size === eligible.length ? 'Clear' : 'Select all'}
            </button>
            {writeOk && (
              <button className="btn btn-primary btn-sm" onClick={() => void handleGenerate()} disabled={running || selected.size === 0}>
                <i className="fa-solid fa-play" /> {running ? 'Generating…' : `Generate ${selected.size}`}
              </button>
            )}
          </div>
        </div>
        {empLoading ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text2)' }}>Loading…</div>
        ) : eligible.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text2)' }}>No active employees with salary configured.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 32 }}></th>
                  <th>Employee</th>
                  <th>Code</th>
                  <th style={{ textAlign: 'right' }}>Basic</th>
                  <th style={{ textAlign: 'right' }}>Est. Gross</th>
                  <th style={{ textAlign: 'right' }}>Est. PAYE</th>
                  <th style={{ textAlign: 'right' }}>Est. Net</th>
                </tr>
              </thead>
              <tbody>
                {eligible.map((e) => {
                  const c = computePayslip(e.basic_salary, [], [], [], 0, 0);
                  return (
                    <tr key={e.id}>
                      <td>
                        <input type="checkbox" checked={selected.has(e.id)} onChange={() => toggle(e.id)} />
                      </td>
                      <td className="td-name">{e.employee_name}</td>
                      <td style={{ fontFamily: 'JetBrains Mono, monospace' }}>{e.employee_code}</td>
                      <td style={{ textAlign: 'right' }}>{fmtMoney(e.basic_salary)}</td>
                      <td style={{ textAlign: 'right' }}>{fmtMoney(c.grossSalary)}</td>
                      <td style={{ textAlign: 'right' }}>{fmtMoney(c.payeTax)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600, color: '#1a7f37' }}>{fmtMoney(c.netSalary)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {results.length > 0 && (
        <div className="card" style={{ padding: 0, marginTop: 16 }}>
          <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid var(--border)', fontSize: 13, fontWeight: 600 }}>
            Generation Results ({results.length})
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r, i) => (
                  <tr key={i}>
                    <td>{r.employee}</td>
                    <td>
                      {r.error ? (
                        <span style={{ color: '#cf222e' }}>
                          <i className="fa-solid fa-xmark" /> {r.error}
                        </span>
                      ) : (
                        <span style={{ color: '#1a7f37' }}>
                          <i className="fa-solid fa-check" /> {r.reference} · {fmtMoney(r.net ?? 0)}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
