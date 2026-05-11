export function calcWorkingDays(start: Date, end: Date, holidays: string[] = []): number {
  let count = 0;
  const cur = new Date(start);
  cur.setHours(0, 0, 0, 0);
  const last = new Date(end);
  last.setHours(0, 0, 0, 0);
  while (cur <= last) {
    const day = cur.getDay();
    const iso = cur.toISOString().slice(0, 10);
    if (day !== 0 && day !== 6 && !holidays.includes(iso)) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

export function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return '—';
  return new Date(d as string).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function fmtCurrency(n: number | null | undefined): string {
  if (n == null) return '—';
  return 'BWP ' + n.toLocaleString('en-BW', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function calcPAYE(annualTaxable: number): number {
  if (annualTaxable <= 48000) return 0;
  if (annualTaxable <= 84000) return (annualTaxable - 48000) * 0.05;
  if (annualTaxable <= 120000) return 1800 + (annualTaxable - 84000) * 0.125;
  if (annualTaxable <= 156000) return 6300 + (annualTaxable - 120000) * 0.1875;
  return 13050 + (annualTaxable - 156000) * 0.25;
}
