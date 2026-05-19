import { fmtMoney, type PayLine } from '@/lib/hr/payrollEngine';
import logoImg from '@/assets/logo.jpg';

interface Props {
  reference: string;
  payslipName: string;
  employeeName: string;
  employeeCode: string;
  employeeId?: string | number | null;
  department?: string | null;
  jobTitle?: string | null;
  contract?: string | null;
  structure?: string | null;
  periodFrom: string;
  periodTo: string;
  payslipDate?: string | null;
  bankName?: string | null;
  bankAccount?: string | null;
  joinDate?: string | null;
  grossSalary: number;
  totalDeductions: number;
  netSalary: number;
  earnings: PayLine[];
  deductions: PayLine[];
  hourLines?: { description: string; code: string; hours?: number | null }[];
  openingAnnualLeave?: number;
  annualLeaveTaken?: number;
  balanceAnnualLeave?: number;
  openingSickLeave?: number;
  sickLeaveTaken?: number;
  balanceSickLeave?: number;
  totalSchoolLoan?: number;
  remainingSchoolLoan?: number;
}

const PHONE = '+267 686 0261';
const EMAIL = 'info@boswa.ac.bw';
const ADDRESS = 'Plot 2830, Sedie Ward, Maun';
const POBOX = 'PO Box 661, Maun';
const WEBSITE = 'www.boswa.ac.bw';

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function twoDigit(n: number): string {
  if (n < 20) return ONES[n];
  const t = Math.floor(n / 10);
  const o = n % 10;
  return o === 0 ? TENS[t] : `${TENS[t]}-${ONES[o]}`;
}

function threeDigit(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  const parts: string[] = [];
  if (h > 0) parts.push(`${ONES[h]} Hundred`);
  if (r > 0) parts.push((h > 0 ? 'And ' : '') + twoDigit(r));
  return parts.join(' ');
}

function intToWords(n: number): string {
  if (n === 0) return 'Zero';
  const parts: string[] = [];
  const million = Math.floor(n / 1_000_000);
  const thousand = Math.floor((n % 1_000_000) / 1000);
  const rest = n % 1000;
  if (million > 0) parts.push(`${threeDigit(million)} Million`);
  if (thousand > 0) parts.push(`${threeDigit(thousand)} Thousand`);
  if (rest > 0) parts.push(threeDigit(rest));
  return parts.join(', ');
}

function netToWords(n: number): string {
  // Split into whole Pula + thebe so 1999.96 doesn't round up to "Two Thousand"
  // on legal payslips.
  const safe = isFinite(n) ? Math.max(0, n) : 0;
  const whole = Math.floor(safe);
  const thebe = Math.round((safe - whole) * 100);
  const wholeWords = intToWords(whole);
  return thebe > 0 ? `${wholeWords} and ${thebe}/100` : wholeWords;
}

function formatPayslipDate(d?: string | null): string {
  if (!d) {
    const dt = new Date();
    const dd = String(dt.getDate()).padStart(2, '0');
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    return `${dd}-${mm}-${dt.getFullYear()}`;
  }
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  const dd = String(dt.getDate()).padStart(2, '0');
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  return `${dd}-${mm}-${dt.getFullYear()}`;
}

export default function PayslipPDF({
  employeeName,
  employeeCode,
  employeeId,
  department,
  jobTitle,
  periodTo,
  payslipDate,
  bankName,
  bankAccount,
  grossSalary,
  totalDeductions: _totalDeductions,
  netSalary,
  earnings,
  deductions,
  openingAnnualLeave = 0,
  annualLeaveTaken = 0,
  balanceAnnualLeave = 0,
  openingSickLeave = 0,
  sickLeaveTaken = 0,
  balanceSickLeave = 0,
  totalSchoolLoan = 0,
  remainingSchoolLoan = 0,
}: Props) {
  const cashEarnings = earnings.filter((l) => l.amount !== 0);
  const realDeductions = deductions.filter((l) => l.amount !== 0);
  const dateStr = formatPayslipDate(payslipDate ?? periodTo);

  return (
    <div
      id="payslip-pdf"
      style={{
        width: '210mm',
        minHeight: '297mm',
        boxSizing: 'border-box',
        fontSize: 10.5,
        background: 'white',
        color: '#111',
        fontFamily: 'Arial, Helvetica, sans-serif',
        display: 'flex',
        flexDirection: 'column',
        padding: 0,
        lineHeight: 1.35,
      }}
    >
      <div style={{ padding: '14mm 14mm 0 14mm', flex: 1 }}>
        {/* Header: employee name + BOSWA logo (logo already contains tagline) */}
        <div style={{ textAlign: 'center', marginBottom: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>{employeeName || ''}</div>
          <img
            src={logoImg}
            alt="BOSWA"
            crossOrigin="anonymous"
            style={{ width: 130, height: 'auto', objectFit: 'contain', display: 'inline-block' }}
          />
        </div>

        <div style={{ borderBottom: '1px solid #999', marginBottom: 14 }} />

        {/* Employee details — three columns */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1.2fr 1.1fr',
            columnGap: 16,
            rowGap: 4,
            marginBottom: 14,
            fontSize: 10.5,
          }}
        >
          <div>
            <div><b>Designation:</b>{jobTitle ? ` ${jobTitle}` : ''}</div>
            <div><b>Department:</b>{department ? ` ${department}` : ''}</div>
          </div>
          <div>
            <div><b>Employee Name:</b> {employeeName || ''}</div>
            <div><b>Employee Code:</b>{employeeCode ? ` ${employeeCode}` : ''}</div>
            <div><b>Employee Id:</b>{employeeId ? `${employeeId}` : ''}</div>
          </div>
          <div>
            <div><b>Date :</b>{dateStr}</div>
            <div><b>Bank Name:</b>{bankName || ''}</div>
            <div><b>Bank Account:</b>{bankAccount || ''}</div>
          </div>
        </div>

        {/* Earnings/Deductions table */}
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: 10.5,
            marginBottom: 14,
            border: '1px solid #d8d8d8',
            color: '#111',
            fontFamily: 'Arial, Helvetica, sans-serif',
          }}
        >
          <thead>
            <tr style={{ background: '#f5f5f5', borderBottom: '1px solid #d0d0d0' }}>
              <th style={thHead}>Description</th>
              <th style={{ ...thHead, textAlign: 'right' }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {/* Cash Benefits section */}
            <tr>
              <td colSpan={2} style={sectionRow}>Cash Benefits</td>
            </tr>
            {cashEarnings.map((e, i) => (
              <tr key={`e-${i}`}>
                <td style={{ ...rowCell, paddingLeft: 26 }}>{e.description}</td>
                <td style={{ ...rowCell, textAlign: 'right' }}>BWP {fmtMoney(e.amount)}</td>
              </tr>
            ))}
            <tr>
              <td style={{ ...rowCell, paddingLeft: 26 }}>Gross</td>
              <td style={{ ...rowCell, textAlign: 'right' }}>BWP {fmtMoney(grossSalary)}</td>
            </tr>

            {/* Deductions section */}
            <tr>
              <td colSpan={2} style={sectionRow}>Deductions</td>
            </tr>
            {realDeductions.map((d, i) => {
              const isPaye = d.code === 'PAYEE_TAX';
              const label = isPaye ? 'PAYE Tax' : d.description;
              return (
                <tr key={`d-${i}`}>
                  <td style={{ ...rowCell, paddingLeft: 26, fontWeight: isPaye ? 700 : 400 }}>{label}</td>
                  <td style={{ ...rowCell, textAlign: 'right', fontWeight: isPaye ? 700 : 400 }}>BWP {fmtMoney(d.amount)}</td>
                </tr>
              );
            })}

            {/* Net in Hand Salary */}
            <tr>
              <td style={{ ...rowCell, paddingLeft: 26, fontWeight: 700 }}>Net in Hand Salary</td>
              <td style={{ ...rowCell, textAlign: 'right', fontWeight: 700 }}>BWP {fmtMoney(netSalary)}</td>
            </tr>

            {/* Net in Words */}
            <tr>
              <td colSpan={2} style={{ ...rowCell, height: 'auto', lineHeight: 1.35, paddingTop: 8, paddingBottom: 8 }}>
                <b>Net Salary in Words:</b> BWP {netToWords(netSalary)} Pula
              </td>
            </tr>
          </tbody>
        </table>

        {/* Leave Summary */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 11, marginBottom: 8 }}>Leave Summary</div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr 1fr',
              columnGap: 12,
              rowGap: 6,
              fontSize: 10.5,
            }}
          >
            <div><b>Opening Annual Leave:</b> {openingAnnualLeave} days</div>
            <div><b>Leave Taken:</b> {annualLeaveTaken} days</div>
            <div><b>Balance Annual Leave:</b> {balanceAnnualLeave} days</div>
            <div><b>Opening Sick Leave:</b> {openingSickLeave} days</div>
            <div><b>Sick Leave Taken:</b> {sickLeaveTaken} days</div>
            <div><b>Balance Sick Leave:</b> {balanceSickLeave} days</div>
          </div>
        </div>

        {/* Loan Summary */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 11, marginBottom: 8 }}>Loan Summary</div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr 1fr',
              columnGap: 12,
              fontSize: 10.5,
            }}
          >
            <div><b>Loan</b></div>
            <div><b>Total Loan:</b> BWP {fmtMoney(totalSchoolLoan)}</div>
            <div><b>Remaining Loan:</b> BWP {fmtMoney(remainingSchoolLoan)}</div>
          </div>
        </div>

        <div style={{ minHeight: 30 }} />
      </div>

      {/* Footer band — anchored to bottom */}
      <div>
        <div
          style={{
            background: '#1E2A4A',
            color: '#ffffff',
            padding: '10px 14mm',
            display: 'grid',
            gridTemplateColumns: '1fr 1fr 1fr 1fr',
            gap: 8,
            alignItems: 'center',
            fontSize: 10,
          }}
        >
          <div>☎ {PHONE}</div>
          <div>✉ {EMAIL}</div>
          <div>{ADDRESS}</div>
          <div>{POBOX}</div>
        </div>
        <div
          style={{
            background: '#1E2A4A',
            color: '#ffffff',
            textAlign: 'center',
            padding: '0 0 8px 0',
            fontSize: 10,
          }}
        >
          {WEBSITE}
        </div>
        <div style={{ textAlign: 'center', marginTop: 8, fontSize: 10, fontWeight: 700 }}>
          This is a system generated payslip
        </div>
        <div
          style={{
            textAlign: 'center',
            fontSize: 9,
            fontStyle: 'italic',
            color: '#555',
            marginTop: 2,
            paddingBottom: 6,
          }}
        >
          System designed by Automate Africa - www.automate.co.bw
        </div>
      </div>
    </div>
  );
}

// All three styles set every property the global index.css `table`/`th`/`td`
// rules touch — otherwise the global "uppercase + gray text2" header rule
// leaks into the PDF.
const thHead: React.CSSProperties = {
  borderBottom: '1px solid #d0d0d0',
  borderTop: 'none',
  borderLeft: 'none',
  borderRight: 'none',
  padding: '8px 12px',
  textAlign: 'left',
  fontWeight: 700,
  fontSize: 10.5,
  background: '#f5f5f5',
  color: '#111',
  textTransform: 'none',
  letterSpacing: 'normal',
  whiteSpace: 'nowrap',
  verticalAlign: 'middle',
  height: 28,
  lineHeight: 1,
  fontFamily: 'Arial, Helvetica, sans-serif',
};

const rowCell: React.CSSProperties = {
  padding: '8px 12px',
  borderBottom: '1px solid #ececec',
  borderTop: 'none',
  borderLeft: 'none',
  borderRight: 'none',
  verticalAlign: 'middle',
  height: 28,
  lineHeight: 1,
  fontSize: 10.5,
  color: '#111',
  textTransform: 'none',
  letterSpacing: 'normal',
  fontFamily: 'Arial, Helvetica, sans-serif',
  background: '#ffffff',
};

const sectionRow: React.CSSProperties = {
  padding: '8px 12px',
  fontWeight: 700,
  background: '#f5f5f5',
  borderBottom: '1px solid #e0e0e0',
  borderTop: '1px solid #e0e0e0',
  borderLeft: 'none',
  borderRight: 'none',
  verticalAlign: 'middle',
  height: 28,
  lineHeight: 1,
  fontSize: 10.5,
  color: '#111',
  textTransform: 'none',
  letterSpacing: 'normal',
  fontFamily: 'Arial, Helvetica, sans-serif',
};
