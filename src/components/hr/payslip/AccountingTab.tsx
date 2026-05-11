import { fmtMoney } from '@/lib/hr/payrollEngine';
import { fmtDate } from '@/lib/hr/leaveUtils';

interface Props {
  reference: string;
  payslipName: string;
  employeeName: string;
  employeeCode: string;
  department?: string | null;
  jobTitle?: string | null;
  contract?: string | null;
  structure?: string | null;
  periodFrom: string;
  periodTo: string;
  grossSalary: number;
  netSalary: number;
  status: 'draft' | 'confirmed' | 'cancelled';
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="info-row">
      <div className="info-label">{label}</div>
      <div className="info-val">{value}</div>
    </div>
  );
}

export default function AccountingTab({
  reference,
  payslipName,
  employeeName,
  employeeCode,
  department,
  jobTitle,
  contract,
  structure,
  periodFrom,
  periodTo,
  grossSalary,
  netSalary,
  status,
}: Props) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        Accounting Information
      </div>
      <div className="card">
        <Row label="Reference" value={reference || '—'} />
        <Row label="Payslip Name" value={payslipName || '—'} />
        <Row label="Employee" value={employeeName ? `${employeeName} (${employeeCode || '—'})` : '—'} />
        <Row label="Department" value={department || '—'} />
        <Row label="Job Position" value={jobTitle || '—'} />
        <Row label="Contract" value={contract || 'Employee'} />
        <Row label="Structure" value={structure || 'Employee'} />
        <Row label="Period" value={`${fmtDate(periodFrom)} → ${fmtDate(periodTo)}`} />
        <Row label="Gross Salary" value={fmtMoney(grossSalary)} />
        <Row label="Net Salary" value={fmtMoney(netSalary)} />
        <Row label="Status" value={status.charAt(0).toUpperCase() + status.slice(1)} />
      </div>
      <div style={{ background: 'rgba(212,146,10,0.08)', border: '1px solid rgba(212,146,10,0.30)', borderRadius: 'var(--radius)', padding: '10px 14px', fontSize: 12, color: '#a36a07' }}>
        <i className="fa-solid fa-circle-info" style={{ marginRight: 6 }} />
        Journal entries will be generated upon payslip confirmation.
      </div>
    </div>
  );
}
