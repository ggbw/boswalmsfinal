/**
 * Severance Benefit Calculator (ported from motho2/src/lib/severanceBenefit.ts).
 *
 * Mirrors the Odoo Python salary-rule logic:
 *   - Service start rounds UP to the first full month after joining
 *   - Service end rounds DOWN to the last fully-worked month
 *   - amount = (contract_wage / 24) * completed_months
 *
 * Pure utility — no UI wiring. Call from payslip flow when an exit_date is set.
 */

export interface SeveranceInput {
  contract_wage: number;
  join_date: string | Date;
  exit_date: string | Date;
}

export interface SeveranceResult {
  service_start: { year: number; month: number };
  service_end: { year: number; month: number };
  completed_months: number;
  amount: number;
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

export function calcSeveranceBenefit(input: SeveranceInput): SeveranceResult {
  const { contract_wage } = input;

  const joinDate = new Date(input.join_date);
  const exitDate = new Date(input.exit_date);

  const joinYear  = joinDate.getFullYear();
  const joinMonth = joinDate.getMonth() + 1;
  const joinDay   = joinDate.getDate();

  const exitYear  = exitDate.getFullYear();
  const exitMonth = exitDate.getMonth() + 1;
  const exitDay   = exitDate.getDate();

  let startYear: number;
  let startMonth: number;
  if (joinDay === 1) {
    startYear  = joinYear;
    startMonth = joinMonth;
  } else if (joinMonth === 12) {
    startYear  = joinYear + 1;
    startMonth = 1;
  } else {
    startYear  = joinYear;
    startMonth = joinMonth + 1;
  }

  let endYear: number;
  let endMonth: number;
  const lastDayOfExitMonth = lastDayOfMonth(exitYear, exitMonth);
  if (exitDay === lastDayOfExitMonth) {
    endYear  = exitYear;
    endMonth = exitMonth;
  } else if (exitMonth === 1) {
    endYear  = exitYear - 1;
    endMonth = 12;
  } else {
    endYear  = exitYear;
    endMonth = exitMonth - 1;
  }

  const completed_months = Math.max(
    0,
    (endYear - startYear) * 12 + (endMonth - startMonth) + 1,
  );

  const amount = (contract_wage / 24) * completed_months;

  return {
    service_start: { year: startYear, month: startMonth },
    service_end:   { year: endYear,   month: endMonth   },
    completed_months,
    amount,
  };
}

/**
 * Split a severance amount into the two halves the Botswana PAYE model needs:
 *   taxable    = amount * 0.5   (subject to PAYE)
 *   nonTaxable = amount * 0.5   (exempt from PAYE)
 *
 * Total is preserved by construction. Useful when feeding into `computePayslip`
 * which expects severanceTaxable and severanceNonTaxable as separate inputs.
 */
export function splitSeverance(amount: number): { taxable: number; nonTaxable: number } {
  const half = Math.round((amount * 0.5) * 100) / 100;
  return { taxable: half, nonTaxable: Math.round((amount - half) * 100) / 100 };
}
