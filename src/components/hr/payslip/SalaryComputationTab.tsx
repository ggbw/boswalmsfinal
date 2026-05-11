import { fmtMoney, type PayLine } from '@/lib/hr/payrollEngine';

interface Props {
  basicSalary: number;
  onBasicChange: (v: number) => void;
  earnings: PayLine[];
  fixedDeductions: PayLine[];
  computedEarnings: PayLine[];
  computedDeductions: PayLine[];
  grossSalary: number;
  totalDeductions: number;
  netSalary: number;
  onEditEarning: (idx: number, patch: Partial<PayLine>) => void;
  onEditDeduction: (idx: number, patch: Partial<PayLine>) => void;
  onAddEarning: () => void;
  onAddDeduction: () => void;
  onRemoveEarning: (idx: number) => void;
  onRemoveDeduction: (idx: number) => void;
  writeOk: boolean;
}

const READONLY_EARNING_CODES = new Set(['BASIC', 'SEVERANCE_BENEFIT_TAX', 'SEVERANCE_BENEFIT_NOTAX']);
const READONLY_DEDUCTION_CODES = new Set(['PAYEE_TAX']);

export default function SalaryComputationTab({
  basicSalary,
  onBasicChange,
  earnings,
  fixedDeductions,
  computedEarnings,
  computedDeductions,
  grossSalary,
  totalDeductions,
  netSalary,
  onEditEarning,
  onEditDeduction,
  onAddEarning,
  onAddDeduction,
  onRemoveEarning,
  onRemoveDeduction,
  writeOk,
}: Props) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        Monthly Fixed
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* Earnings */}
        <div className="card" style={{ padding: 0 }}>
          <div style={{ padding: '10px 16px', background: 'rgba(26,127,55,0.08)', color: '#1a7f37', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>Earnings</span>
            {writeOk && (
              <button className="btn btn-outline btn-sm" onClick={onAddEarning}>
                <i className="fa-solid fa-plus" /> Add
              </button>
            )}
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Description</th>
                  <th style={{ width: 110 }}>Code</th>
                  <th style={{ width: 130, textAlign: 'right' }}>Amount</th>
                  <th style={{ width: 40 }} />
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Basic Salary</td>
                  <td style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'var(--text2)' }}>BASIC</td>
                  <td style={{ textAlign: 'right' }}>
                    <input
                      type="number"
                      step="0.01"
                      className="form-input"
                      style={{ textAlign: 'right' }}
                      disabled={!writeOk}
                      value={basicSalary}
                      onChange={(e) => onBasicChange(Number(e.target.value) || 0)}
                    />
                  </td>
                  <td />
                </tr>
                {earnings.map((l, idx) => {
                  const ro = READONLY_EARNING_CODES.has(l.code);
                  return (
                    <tr key={idx}>
                      <td>
                        <input
                          className="form-input"
                          disabled={!writeOk || ro}
                          value={l.description}
                          onChange={(e) => onEditEarning(idx, { description: e.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          className="form-input"
                          disabled={!writeOk || ro}
                          style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}
                          value={l.code}
                          onChange={(e) => onEditEarning(idx, { code: e.target.value })}
                        />
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <input
                          type="number"
                          step="0.01"
                          className="form-input"
                          style={{ textAlign: 'right' }}
                          disabled={!writeOk}
                          value={l.amount}
                          onChange={(e) => onEditEarning(idx, { amount: Number(e.target.value) })}
                        />
                      </td>
                      <td>
                        {writeOk && !ro && (
                          <button className="btn btn-danger btn-sm" onClick={() => onRemoveEarning(idx)}>
                            <i className="fa-solid fa-trash" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ background: 'rgba(26,127,55,0.08)', fontWeight: 700, color: '#1a7f37' }}>
                  <td colSpan={2} style={{ fontSize: 12 }}>Gross Salary</td>
                  <td style={{ textAlign: 'right', fontFamily: 'JetBrains Mono, monospace' }}>{fmtMoney(grossSalary)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* Deductions */}
        <div className="card" style={{ padding: 0 }}>
          <div style={{ padding: '10px 16px', background: 'rgba(207,34,46,0.08)', color: '#cf222e', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>Deductions</span>
            {writeOk && (
              <button className="btn btn-outline btn-sm" onClick={onAddDeduction}>
                <i className="fa-solid fa-plus" /> Add
              </button>
            )}
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Description</th>
                  <th style={{ width: 110 }}>Code</th>
                  <th style={{ width: 130, textAlign: 'right' }}>Amount</th>
                  <th style={{ width: 40 }} />
                </tr>
              </thead>
              <tbody>
                {computedDeductions.filter((d) => READONLY_DEDUCTION_CODES.has(d.code)).map((d) => (
                  <tr key={d.code} style={{ background: 'rgba(37,99,235,0.04)' }}>
                    <td>{d.description} <span style={{ marginLeft: 6, fontSize: 10, color: '#2563eb', background: 'rgba(37,99,235,0.12)', padding: '1px 6px', borderRadius: 4 }}>auto</span></td>
                    <td style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'var(--text2)' }}>{d.code}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontWeight: 600 }}>{fmtMoney(d.amount)}</td>
                    <td />
                  </tr>
                ))}
                {fixedDeductions.map((l, idx) => (
                  <tr key={idx}>
                    <td>
                      <input
                        className="form-input"
                        disabled={!writeOk}
                        value={l.description}
                        onChange={(e) => onEditDeduction(idx, { description: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        className="form-input"
                        disabled={!writeOk}
                        style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}
                        value={l.code}
                        onChange={(e) => onEditDeduction(idx, { code: e.target.value })}
                      />
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <input
                        type="number"
                        step="0.01"
                        className="form-input"
                        style={{ textAlign: 'right' }}
                        disabled={!writeOk}
                        value={l.amount}
                        onChange={(e) => onEditDeduction(idx, { amount: Number(e.target.value) })}
                      />
                    </td>
                    <td>
                      {writeOk && (
                        <button className="btn btn-danger btn-sm" onClick={() => onRemoveDeduction(idx)}>
                          <i className="fa-solid fa-trash" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: 'rgba(207,34,46,0.08)', fontWeight: 700, color: '#cf222e' }}>
                  <td colSpan={2} style={{ fontSize: 12 }}>Total Deductions</td>
                  <td style={{ textAlign: 'right', fontFamily: 'JetBrains Mono, monospace' }}>{fmtMoney(totalDeductions)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </div>

      {/* Net Salary Summary */}
      <div style={{ background: '#1E3A5F', color: 'white', borderRadius: 'var(--radius)', padding: '16px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 11, opacity: 0.6 }}>Gross Salary</div>
          <div style={{ fontSize: 18, fontWeight: 600, fontFamily: 'JetBrains Mono, monospace' }}>{fmtMoney(grossSalary)}</div>
        </div>
        <div style={{ fontSize: 22, opacity: 0.4 }}>−</div>
        <div>
          <div style={{ fontSize: 11, opacity: 0.6 }}>Total Deductions</div>
          <div style={{ fontSize: 18, fontWeight: 600, color: '#fda4af', fontFamily: 'JetBrains Mono, monospace' }}>{fmtMoney(totalDeductions)}</div>
        </div>
        <div style={{ fontSize: 22, opacity: 0.4 }}>=</div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 11, opacity: 0.6 }}>Net Salary</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: '#C9A84C', fontFamily: 'JetBrains Mono, monospace' }}>{fmtMoney(netSalary)}</div>
        </div>
      </div>

      {/* Optional read-only mirror of computed earnings for transparency (e.g., severance lines) */}
      {computedEarnings.some((e) => e.code.startsWith('SEVERANCE')) && (
        <div className="card" style={{ padding: 12, fontSize: 11, color: 'var(--text2)' }}>
          Severance components are calculated from the Severance fields in Payslip Details and appear automatically in the Gross.
        </div>
      )}
    </div>
  );
}
