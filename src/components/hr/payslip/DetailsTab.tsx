import { fmtMoney, type PayLine } from '@/lib/hr/payrollEngine';

interface Props {
  earnings: PayLine[];
  deductions: PayLine[];
}

interface Section {
  key: 'earning' | 'deduction';
  label: string;
  color: string;
  bg: string;
  lines: PayLine[];
}

export default function DetailsTab({ earnings, deductions }: Props) {
  const sections: Section[] = [
    { key: 'earning', label: 'Earnings', color: '#1a7f37', bg: 'rgba(26,127,55,0.08)', lines: earnings.filter((l) => l.amount !== 0) },
    { key: 'deduction', label: 'Deductions', color: '#cf222e', bg: 'rgba(207,34,46,0.08)', lines: deductions.filter((l) => l.amount !== 0) },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        Details by Salary Rule Category
      </div>
      {sections.map((s) => {
        const total = s.lines.reduce((sum, l) => sum + l.amount, 0);
        return (
          <div key={s.key} className="card" style={{ padding: 0 }}>
            <div style={{ padding: '10px 16px', background: s.bg, color: s.color, borderBottom: '1px solid var(--border)', fontSize: 12, fontWeight: 600 }}>
              {s.label}
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Rule</th>
                    <th style={{ width: 160 }}>Code</th>
                    <th style={{ width: 160, textAlign: 'right' }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {s.lines.length === 0 ? (
                    <tr>
                      <td colSpan={3} style={{ padding: 16, textAlign: 'center', color: 'var(--text2)' }}>No entries</td>
                    </tr>
                  ) : (
                    s.lines.map((l) => (
                      <tr key={l.code}>
                        <td>{l.description}</td>
                        <td style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'var(--text2)' }}>{l.code}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontWeight: 600 }}>{fmtMoney(l.amount)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
                <tfoot>
                  <tr style={{ background: 'var(--surface2)', fontWeight: 700 }}>
                    <td colSpan={2} style={{ fontSize: 12 }}>Total</td>
                    <td style={{ textAlign: 'right', fontFamily: 'JetBrains Mono, monospace' }}>{fmtMoney(total)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}
