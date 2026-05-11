// Botswana PAYE 2024/2025 Tax Brackets (Annual Income)
// Verified: BWP 493,255.92 annual → BWP 97,363.98 PAYE
//           = BWP 8,113.67 monthly (matches sample payslip)

export function calcPAYE(annualTaxableIncome: number): number {
  if (annualTaxableIncome <= 48000) return 0;
  if (annualTaxableIncome <= 84000)
    return (annualTaxableIncome - 48000) * 0.05;
  if (annualTaxableIncome <= 120000)
    return 1800 + (annualTaxableIncome - 84000) * 0.125;
  if (annualTaxableIncome <= 156000)
    return 6300 + (annualTaxableIncome - 120000) * 0.1875;
  return 13050 + (annualTaxableIncome - 156000) * 0.25;
}

export interface PayLine {
  description: string;
  code: string;
  hours?: number | null;
  amount: number;
  editable?: boolean;
  isVariable?: boolean;
  isTaxable?: boolean;
}

export function computePayslip(
  basicSalary: number,
  earnings: PayLine[],
  fixedDeductions: PayLine[],
  benefits: PayLine[],
  severanceTaxable: number,
  severanceNonTaxable: number,
): {
  allEarnings: PayLine[];
  allDeductions: PayLine[];
  grossSalary: number;
  taxableIncome: number;
  payeTax: number;
  totalDeductions: number;
  netSalary: number;
} {
  const allEarnings: PayLine[] = [
    { description: 'Basic Salary', code: 'BASIC', amount: basicSalary, isTaxable: true },
    ...earnings.filter((e) => e.amount > 0),
  ];

  if (severanceTaxable > 0) {
    allEarnings.push({
      description: 'Severance Benefit-Taxable',
      code: 'SEVERANCE_BENEFIT_TAX',
      amount: severanceTaxable,
      isTaxable: true,
    });
  }
  if (severanceNonTaxable > 0) {
    allEarnings.push({
      description: 'Severance Benefit-Nontaxable',
      code: 'SEVERANCE_BENEFIT_NOTAX',
      amount: severanceNonTaxable,
      isTaxable: false,
    });
  }

  const grossSalary = allEarnings.reduce((s, e) => s + e.amount, 0);

  const taxableBenefitsTotal = benefits
    .filter((b) => b.isTaxable !== false)
    .reduce((s, b) => s + b.amount, 0);

  const taxableMonthly = grossSalary - severanceNonTaxable + taxableBenefitsTotal;
  const payeTax = Math.round((calcPAYE(taxableMonthly * 12) / 12) * 100) / 100;

  const allDeductions: PayLine[] = [
    { description: 'Payee', code: 'PAYEE_TAX', amount: payeTax, editable: false },
    ...fixedDeductions.filter((d) => d.amount > 0),
  ];

  const totalDeductions = allDeductions.reduce((s, d) => s + d.amount, 0);
  const netSalary = Math.round((grossSalary - totalDeductions) * 100) / 100;

  return {
    allEarnings,
    allDeductions,
    grossSalary,
    taxableIncome: taxableMonthly,
    payeTax,
    totalDeductions,
    netSalary,
  };
}

export function fmtMoney(n: number | null | undefined): string {
  if (n == null) return '';
  return n.toLocaleString('en-BW', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function getWorkingDays(periodFrom: string, periodTo: string, joinDate?: string | null): number {
  const DEFAULT_WORKING_DAYS = 22;
  if (!joinDate) return DEFAULT_WORKING_DAYS;

  const join = new Date(joinDate);
  join.setHours(0, 0, 0, 0);
  const from = new Date(periodFrom);
  from.setHours(0, 0, 0, 0);
  const to = new Date(periodTo);
  to.setHours(0, 0, 0, 0);

  if (join <= from) return DEFAULT_WORKING_DAYS;
  if (join > to) return 0;

  let count = 0;
  const cursor = new Date(join);
  cursor.setHours(0, 0, 0, 0);
  while (cursor <= to) {
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) count++;
    cursor.setDate(cursor.getDate() + 1);
  }
  return count > 0 ? count : 1;
}

export function getOTDivisor(periodFrom: string, periodTo: string, joinDate?: string | null): number {
  return 9 * getWorkingDays(periodFrom, periodTo, joinDate);
}

export function fmtDate(d: string | null | undefined): string {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export const BOTSWANA_HOLIDAYS_2026: string[] = [
  '2026-01-01','2026-01-02','2026-04-03','2026-04-04','2026-04-05','2026-04-06',
  '2026-05-01','2026-05-14','2026-07-01','2026-07-20','2026-07-21','2026-09-30',
  '2026-10-01','2026-12-25','2026-12-26',
];

export function calcLeaveDays(startDate: string, endDate: string, holidays: string[] = []): number {
  let count = 0;
  const cursor = new Date(startDate);
  cursor.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(0, 0, 0, 0);
  while (cursor <= end) {
    const day = cursor.getDay();
    const dateStr = cursor.toISOString().split('T')[0];
    if (day !== 0 && day !== 6 && !holidays.includes(dateStr)) count++;
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}

export function isHoliday(date: string, holidays: string[]): boolean {
  return holidays.includes(date);
}
