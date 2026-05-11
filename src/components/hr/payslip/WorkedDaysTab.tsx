import { getWorkingDays } from '@/lib/hr/payrollEngine';

interface WorkedDayRow {
  description: string;
  code: string;
  days: number;
  hours: number;
}

interface Props {
  periodFrom: string;
  periodTo: string;
  joinDate?: string | null;
  /** Optional hour-based variable lines (e.g. OT150, OT200, LOSS_HRS) to surface as worked-day rows. */
  hourLines?: { description: string; code: string; hours?: number | null }[];
}

const DAILY_HOURS = 8;

export default function WorkedDaysTab({ periodFrom, periodTo, joinDate, hourLines = [] }: Props) {
  const workingDays = getWorkingDays(periodFrom, periodTo, joinDate ?? null);
  const baseRows: WorkedDayRow[] = [
    {
      description: 'Regular Working Days',
      code: 'WORK100',
      days: workingDays,
      hours: workingDays * DAILY_HOURS,
    },
  ];

  const overtimeRows: WorkedDayRow[] = hourLines
    .filter((l) => (l.hours ?? 0) > 0)
    .map((l) => ({
      description: l.description,
      code: l.code,
      days: Math.round(((l.hours ?? 0) / DAILY_HOURS) * 100) / 100,
      hours: l.hours ?? 0,
    }));

  const rows = [...baseRows, ...overtimeRows];
  const totalDays = rows.reduce((s, r) => s + r.days, 0);
  const totalHours = rows.reduce((s, r) => s + r.hours, 0);

  return (
    <div className="card" style={{ padding: 0 }}>
      <div className="card-title" style={{ padding: '14px 20px 10px', borderBottom: '1px solid var(--border)', marginBottom: 0 }}>
        <span>Worked Days & Inputs</span>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Description</th>
              <th style={{ width: 160 }}>Code</th>
              <th style={{ width: 100, textAlign: 'right' }}>Days</th>
              <th style={{ width: 100, textAlign: 'right' }}>Hours</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>{r.description}</td>
                <td style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'var(--text2)' }}>{r.code}</td>
                <td style={{ textAlign: 'right', fontFamily: 'JetBrains Mono, monospace' }}>{r.days}</td>
                <td style={{ textAlign: 'right', fontFamily: 'JetBrains Mono, monospace' }}>{r.hours}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ background: 'var(--surface2)', fontWeight: 700 }}>
              <td colSpan={2} style={{ fontSize: 11, color: 'var(--text2)', textTransform: 'uppercase' }}>Total</td>
              <td style={{ textAlign: 'right', fontFamily: 'JetBrains Mono, monospace' }}>{totalDays}</td>
              <td style={{ textAlign: 'right', fontFamily: 'JetBrains Mono, monospace' }}>{totalHours}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
