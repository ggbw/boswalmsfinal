import { type PayLine } from '@/lib/hr/payrollEngine';
import type { PayComponentDef } from '@/hooks/hr/usePayComponents';

const HOURS_INPUT_CODES = new Set(['OVER1.5', 'OVER2', 'LOSS_HRS', 'OT150', 'OT200']);

interface VariableLine extends PayLine {
  category: 'earning' | 'deduction';
}

interface Props {
  earnings: PayLine[];
  fixedDeductions: PayLine[];
  benefits: PayLine[];
  onEditEarning: (idx: number, patch: Partial<PayLine>) => void;
  onEditDeduction: (idx: number, patch: Partial<PayLine>) => void;
  onEditBenefit: (idx: number, patch: Partial<PayLine>) => void;
  payComponents?: PayComponentDef[];
  writeOk: boolean;
}

export default function MonthlyVariablesTab({
  earnings,
  fixedDeductions,
  benefits,
  onEditEarning,
  onEditDeduction,
  onEditBenefit,
  payComponents = [],
  writeOk,
}: Props) {
  // Use the catalog to surface a "Component" column on the variables table —
  // makes the link back to pay_component_defs visible even though the line is
  // already populated.
  const componentByCode = new Map(payComponents.map((c) => [c.code, c] as const));
  const rows: { line: VariableLine; idx: number; source: 'earning' | 'deduction' | 'benefit' }[] = [];
  earnings.forEach((l, idx) => {
    if (l.isVariable || HOURS_INPUT_CODES.has(l.code)) {
      rows.push({ line: { ...l, category: 'earning' }, idx, source: 'earning' });
    }
  });
  fixedDeductions.forEach((l, idx) => {
    if (l.isVariable) {
      rows.push({ line: { ...l, category: 'deduction' }, idx, source: 'deduction' });
    }
  });
  benefits.forEach((l, idx) => {
    rows.push({ line: { ...l, category: 'earning' }, idx, source: 'benefit' });
  });

  const handleEdit = (source: 'earning' | 'deduction' | 'benefit', idx: number, patch: Partial<PayLine>) => {
    if (source === 'earning') onEditEarning(idx, patch);
    else if (source === 'deduction') onEditDeduction(idx, patch);
    else onEditBenefit(idx, patch);
  };

  return (
    <div className="card" style={{ padding: 0 }}>
      <div className="card-title" style={{ padding: '14px 20px 10px', borderBottom: '1px solid var(--border)', marginBottom: 0 }}>
        <span>Monthly Variable</span>
      </div>
      {rows.length === 0 ? (
        <div style={{ padding: 20, textAlign: 'center', color: 'var(--text2)', fontSize: 12 }}>
          No variable components for this payslip. Add variable earnings, deductions, or taxable benefits from the Salary Computation tab.
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Description</th>
                <th style={{ width: 120 }}>Code</th>
                <th style={{ width: 110 }}>Type</th>
                <th style={{ width: 90, textAlign: 'right' }}>Hrs</th>
                <th style={{ width: 130, textAlign: 'right' }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ line, idx, source }) => {
                const allowHours = HOURS_INPUT_CODES.has(line.code);
                const typeLabel = source === 'benefit'
                  ? 'Benefit'
                  : line.category === 'earning' ? 'Earning' : 'Deduction';
                const typeColor = source === 'benefit'
                  ? { bg: 'rgba(130,80,223,0.13)', fg: '#8250df' }
                  : line.category === 'earning'
                    ? { bg: 'rgba(26,127,55,0.13)', fg: '#1a7f37' }
                    : { bg: 'rgba(207,34,46,0.13)', fg: '#cf222e' };
                return (
                  <tr key={`${source}-${idx}`}>
                    <td>
                      {line.description}
                      {componentByCode.has(line.code) && (
                        <span style={{ marginLeft: 6, fontSize: 9, color: '#2563eb', background: 'rgba(37,99,235,0.12)', padding: '1px 5px', borderRadius: 3 }}>catalog</span>
                      )}
                    </td>
                    <td style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'var(--text2)' }}>{line.code}</td>
                    <td>
                      <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 600, background: typeColor.bg, color: typeColor.fg }}>
                        {typeLabel}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {allowHours ? (
                        <input
                          type="number"
                          min={0}
                          step={0.5}
                          className="form-input"
                          style={{ textAlign: 'right', width: 70 }}
                          disabled={!writeOk}
                          value={line.hours ?? ''}
                          placeholder="hrs"
                          onChange={(e) => handleEdit(source, idx, { hours: Number(e.target.value) || 0 })}
                        />
                      ) : (
                        <span style={{ color: 'var(--text2)' }}>—</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <input
                        type="number"
                        step="0.01"
                        className="form-input"
                        style={{ textAlign: 'right' }}
                        disabled={!writeOk}
                        value={line.amount}
                        onChange={(e) => handleEdit(source, idx, { amount: Number(e.target.value) })}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
