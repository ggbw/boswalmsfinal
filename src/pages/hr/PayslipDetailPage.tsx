import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { useUserRole } from '@/hooks/hr/useUserRole';
import { useEmployees } from '@/hooks/hr/useEmployees';
import { usePayComponents } from '@/hooks/hr/usePayComponents';
import { computePayslip, fmtMoney, type PayLine } from '@/lib/hr/payrollEngine';
import { fmtCurrency, fmtDate } from '@/lib/hr/leaveUtils';
import { calcSeveranceBenefit, splitSeverance } from '@/lib/hr/severanceBenefit';
import { supabase } from '@/integrations/supabase/client';
import { nextPayslipReference, type Payslip, type PayslipBreakdownLine } from '@/hooks/hr/usePayslips';
import WorkedDaysTab from '@/components/hr/payslip/WorkedDaysTab';
import DetailsTab from '@/components/hr/payslip/DetailsTab';
import SalaryComputationTab from '@/components/hr/payslip/SalaryComputationTab';
import MonthlyVariablesTab from '@/components/hr/payslip/MonthlyVariablesTab';
import AccountingTab from '@/components/hr/payslip/AccountingTab';
import PayslipPDF from '@/components/hr/payslip/PayslipPDF';
import html2pdf from 'html2pdf.js';

type TabKey = 'salary' | 'monthly' | 'workeddays' | 'details' | 'accounting';

interface FormState {
  id: string | null;
  reference: string;
  employee_id: string;
  period_from: string;
  period_to: string;
  payslip_name: string;
  basic_salary: string;
  earnings: PayLine[];
  fixedDeductions: PayLine[];
  benefits: PayLine[];
  severanceTaxable: string;
  severanceNonTaxable: string;
  status: 'draft' | 'confirmed' | 'cancelled';
  notes: string;
}

const monthRange = (): { from: string; to: string } => {
  const today = new Date();
  const from = new Date(today.getFullYear(), today.getMonth() - 1, 25);
  const to = new Date(today.getFullYear(), today.getMonth(), 24);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(from), to: iso(to) };
};

const empty = (): FormState => {
  const r = monthRange();
  return {
    id: null,
    reference: '',
    employee_id: '',
    period_from: r.from,
    period_to: r.to,
    payslip_name: '',
    basic_salary: '0',
    earnings: [],
    fixedDeductions: [],
    benefits: [],
    severanceTaxable: '0',
    severanceNonTaxable: '0',
    status: 'draft',
    notes: '',
  };
};

const fromPayslip = (p: Payslip): FormState => ({
  id: p.id,
  reference: p.reference,
  employee_id: p.employee_id ?? '',
  period_from: p.period_from,
  period_to: p.period_to,
  payslip_name: p.payslip_name ?? '',
  basic_salary: String(p.basic_salary),
  earnings: (p.earnings_breakdown ?? []).filter((l) => l.code !== 'BASIC' && !l.code?.startsWith('SEVERANCE')) as unknown as PayLine[],
  fixedDeductions: (p.deductions_breakdown ?? []).filter((l) => l.code !== 'PAYEE_TAX') as unknown as PayLine[],
  benefits: (p.benefits_breakdown ?? []) as unknown as PayLine[],
  severanceTaxable: String(
    (p.earnings_breakdown ?? []).find((l) => l.code === 'SEVERANCE_BENEFIT_TAX')?.amount ?? 0,
  ),
  severanceNonTaxable: String(
    (p.earnings_breakdown ?? []).find((l) => l.code === 'SEVERANCE_BENEFIT_NOTAX')?.amount ?? 0,
  ),
  status: p.status,
  notes: p.notes ?? '',
});

export default function PayslipDetailPage() {
  const { navigate, pageParams, toast } = useApp();
  const { can } = useUserRole();
  const { employees } = useEmployees();
  const { components: payComponents } = usePayComponents();
  const writeOk = can('payslips', 'write');

  const payslipId = pageParams.payslipId as string | undefined;
  const mode = (pageParams.mode as 'create' | 'view') ?? (payslipId ? 'view' : 'create');

  const [form, setForm] = useState<FormState>(empty);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(!!payslipId);
  const [tab, setTab] = useState<TabKey>('salary');
  const [showPdf, setShowPdf] = useState(false);
  const pdfRef = useRef<HTMLDivElement | null>(null);

  // Employees with at least one active contract — used to gate who can
  // appear in the create-payslip employee dropdown.
  const [activeContractEmpIds, setActiveContractEmpIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    void supabase
      .from('contracts')
      .select('employee_id')
      .eq('status', 'active')
      .then(({ data }) => {
        const ids = ((data ?? []) as Array<{ employee_id: string | null }>)
          .map((r) => r.employee_id)
          .filter((v): v is string => !!v);
        setActiveContractEmpIds(new Set(ids));
      });
  }, []);

  const [leaveSummary, setLeaveSummary] = useState({
    openingAnnualLeave: 0,
    annualLeaveTaken: 0,
    balanceAnnualLeave: 0,
    openingSickLeave: 0,
    sickLeaveTaken: 0,
    balanceSickLeave: 0,
  });
  const [loanSummary, setLoanSummary] = useState({
    totalSchoolLoan: 0,
    remainingSchoolLoan: 0,
  });

  useEffect(() => {
    if (mode === 'create') {
      void nextPayslipReference().then((ref) => setForm((f) => ({ ...f, reference: ref })));
      return;
    }
    if (!payslipId) return;
    let active = true;
    setLoading(true);
    void supabase
      .from('payslips')
      .select('*')
      .eq('id', payslipId)
      .maybeSingle()
      .then(({ data }) => {
        if (!active) return;
        if (data) setForm(fromPayslip(data as unknown as Payslip));
        setLoading(false);
      });
    return () => { active = false; };
  }, [payslipId, mode]);

  const computed = useMemo(() => {
    return computePayslip(
      Number(form.basic_salary) || 0,
      form.earnings,
      form.fixedDeductions,
      form.benefits,
      Number(form.severanceTaxable) || 0,
      Number(form.severanceNonTaxable) || 0,
    );
  }, [form]);

  const update = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const updateLine = (
    listKey: 'earnings' | 'fixedDeductions' | 'benefits',
    idx: number,
    patch: Partial<PayLine>,
  ) =>
    setForm((f) => ({
      ...f,
      [listKey]: f[listKey].map((l, i) => (i === idx ? { ...l, ...patch } : l)),
    }));

  const addLine = (listKey: 'earnings' | 'fixedDeductions' | 'benefits') =>
    setForm((f) => ({
      ...f,
      [listKey]: [
        ...f[listKey],
        { description: '', code: `CUSTOM_${Date.now()}`, amount: 0, isTaxable: listKey !== 'fixedDeductions' },
      ],
    }));

  const removeLine = (listKey: 'earnings' | 'fixedDeductions' | 'benefits', idx: number) =>
    setForm((f) => ({ ...f, [listKey]: f[listKey].filter((_, i) => i !== idx) }));

  const handleSave = async () => {
    if (!form.employee_id) { toast('Select an employee', 'error'); return; }
    if (!form.period_from || !form.period_to) { toast('Period required', 'error'); return; }

    setSaving(true);
    const earningsBreakdown: PayslipBreakdownLine[] = computed.allEarnings.map((l) => ({
      description: l.description, code: l.code, amount: l.amount, isTaxable: l.isTaxable,
    }));
    const deductionsBreakdown: PayslipBreakdownLine[] = computed.allDeductions.map((l) => ({
      description: l.description, code: l.code, amount: l.amount,
    }));
    const benefitsBreakdown: PayslipBreakdownLine[] = form.benefits.map((l) => ({
      description: l.description, code: l.code, amount: l.amount, isTaxable: l.isTaxable,
    }));

    const payload = {
      reference: form.reference,
      employee_id: form.employee_id,
      period_from: form.period_from,
      period_to: form.period_to,
      payslip_name: form.payslip_name.trim() || null,
      basic_salary: Number(form.basic_salary) || 0,
      gross_salary: computed.grossSalary,
      total_deductions: computed.totalDeductions,
      paye_tax: computed.payeTax,
      net_salary: computed.netSalary,
      earnings_breakdown: earningsBreakdown,
      deductions_breakdown: deductionsBreakdown,
      benefits_breakdown: benefitsBreakdown,
      status: form.status,
      notes: form.notes.trim() || null,
    };

    const { data, error } = form.id
      ? await supabase.from('payslips').update(payload as never).eq('id', form.id).select('id').single()
      : await supabase.from('payslips').insert(payload as never).select('id').single();
    setSaving(false);
    if (error) { toast(error.message, 'error'); return; }
    toast(form.id ? 'Payslip updated' : 'Payslip created', 'success');
    if (data?.id && !form.id) navigate('hr-payslip-detail', { payslipId: data.id as string });
  };

  useEffect(() => {
    if (mode !== 'create' || !form.employee_id) return;
    let cancelled = false;
    const e = employees.find((x) => x.id === form.employee_id);
    const payslipName = e ? `Payslip - ${e.employee_name}` : '';
    void (async () => {
      type ContractRow = { id: string; wage: number; status: string };
      type LineRow = {
        amount: number;
        sequence: number;
        is_earning: boolean;
        is_active: boolean;
        pay_component_defs: { name: string | null; code: string | null; is_taxable: boolean | null } | null;
      };
      // Prefer an active contract; otherwise pick the most recent so a paused
      // contract still seeds sensible defaults instead of zeroing the form.
      const { data: contracts } = await supabase
        .from('contracts')
        .select('id, wage, status')
        .eq('employee_id', form.employee_id)
        .order('start_date', { ascending: false });
      const list = (contracts ?? []) as ContractRow[];
      const contract = list.find((c) => c.status === 'active') ?? list[0] ?? null;
      const wage = contract?.wage ?? e?.basic_salary ?? 0;

      let earningLines: PayLine[] = [];
      let deductionLines: PayLine[] = [];
      if (contract?.id) {
        const { data: lines } = await supabase
          .from('contract_lines')
          .select('amount, sequence, is_earning, is_active, pay_component_defs(name, code, is_taxable)')
          .eq('contract_id', contract.id)
          .eq('is_active', true)
          .order('sequence');
        const rows = (lines ?? []) as unknown as LineRow[];
        const mapLine = (l: LineRow): PayLine | null => {
          const def = l.pay_component_defs;
          if (!def?.code) return null;
          return {
            description: def.name ?? def.code,
            code: def.code,
            amount: Number(l.amount) || 0,
            isTaxable: Boolean(def.is_taxable),
          };
        };
        earningLines = rows.filter((l) => l.is_earning).map(mapLine).filter((l): l is PayLine => l !== null);
        deductionLines = rows.filter((l) => !l.is_earning).map(mapLine).filter((l): l is PayLine => l !== null);
      }
      if (cancelled) return;
      setForm((f) => ({
        ...f,
        basic_salary: String(wage),
        payslip_name: payslipName || f.payslip_name,
        // Only seed lines on the very first selection — preserve anything the
        // user has already typed.
        earnings: f.earnings.length === 0 ? earningLines : f.earnings,
        fixedDeductions: f.fixedDeductions.length === 0 ? deductionLines : f.fixedDeductions,
      }));
    })();
    return () => { cancelled = true; };
  }, [form.employee_id, employees, mode]);

  const selectedEmployee = useMemo(
    () => employees.find((e) => e.id === form.employee_id) ?? null,
    [employees, form.employee_id],
  );

  // Fetch latest leave allocation + loan balances for the payslip.
  // Strategy:
  //   - Leaves: prefer leave_allocations rows; if a type has no allocation row
  //     for this employee/year (e.g. new hire created after the seed migration
  //     ran), fall back to leave_types.max_days as the entitlement and count
  //     approved leave_requests in that year as "taken". This mirrors the
  //     fallback pattern already used in MyLeavesPage.
  //   - Loans: include all active employee loans (Approved + Completed), not
  //     only ones whose type literally contains "school" — most loans use the
  //     "Salary Advance" type, so the previous filter zeroed out real data.
  useEffect(() => {
    if (!form.employee_id) {
      setLeaveSummary({
        openingAnnualLeave: 0, annualLeaveTaken: 0, balanceAnnualLeave: 0,
        openingSickLeave: 0, sickLeaveTaken: 0, balanceSickLeave: 0,
      });
      setLoanSummary({ totalSchoolLoan: 0, remainingSchoolLoan: 0 });
      return;
    }
    const yearStr = (form.period_to || '').slice(0, 4);
    const year = Number(yearStr) || new Date().getFullYear();
    let active = true;

    void (async () => {
      type AllocRow = {
        leave_type_id: string;
        opening_balance: number | null;
        allocated_days: number | null;
        used_days: number | null;
        pending_days: number | null;
        leave_types: { name: string | null; code: string | null } | null;
      };
      type LeaveTypeRow = {
        id: string;
        name: string | null;
        code: string | null;
        max_days: number | null;
        is_active: boolean | null;
      };
      type LeaveReqRow = {
        leave_type_id: string | null;
        num_days: number | null;
        number_of_days: number | null;
        start_date: string | null;
      };

      const [{ data: allocs }, { data: leaveTypes }, { data: leaveReqs }] = await Promise.all([
        supabase
          .from('leave_allocations')
          .select('leave_type_id, opening_balance, allocated_days, used_days, pending_days, leave_types(name, code)')
          .eq('employee_id', form.employee_id)
          .eq('year', year),
        supabase
          .from('leave_types')
          .select('id, name, code, max_days, is_active')
          .eq('is_active', true),
        supabase
          .from('leave_requests')
          .select('leave_type_id, num_days, number_of_days, start_date')
          .eq('employee_id', form.employee_id)
          .eq('status', 'approved')
          .gte('start_date', `${year}-01-01`)
          .lte('start_date', `${year}-12-31`),
      ]);

      // Build lookup of allocations keyed by leave_type_id
      const allocByTypeId = new Map<string, AllocRow>();
      for (const a of (allocs ?? []) as unknown as AllocRow[]) {
        allocByTypeId.set(a.leave_type_id, a);
      }

      // Tally approved leave-request days per leave_type_id (used as a fallback
      // when no allocation row exists, or to sanity-check "taken").
      const takenByTypeId = new Map<string, number>();
      for (const r of (leaveReqs ?? []) as unknown as LeaveReqRow[]) {
        if (!r.leave_type_id) continue;
        const days = Number(r.num_days ?? r.number_of_days) || 0;
        takenByTypeId.set(r.leave_type_id, (takenByTypeId.get(r.leave_type_id) ?? 0) + days);
      }

      let openingAnnual = 0, annualTaken = 0, balanceAnnual = 0;
      let openingSick = 0, sickTaken = 0, balanceSick = 0;

      for (const lt of (leaveTypes ?? []) as LeaveTypeRow[]) {
        const name = (lt.name ?? '').toLowerCase();
        const code = (lt.code ?? '').toUpperCase();
        const isAnnual = name.includes('annual') || code === 'AL';
        const isSick = name.includes('sick') || code === 'SL';
        if (!isAnnual && !isSick) continue;

        const a = allocByTypeId.get(lt.id);
        let entitlement = 0;
        let taken = 0;
        let balance = 0;
        if (a) {
          const opening = Number(a.opening_balance) || 0;
          const allocated = Number(a.allocated_days) || 0;
          const used = Number(a.used_days) || 0;
          const pending = Number(a.pending_days) || 0;
          entitlement = opening + allocated;
          // Prefer the higher of allocation used_days vs. approved-request total
          // so the figure stays accurate even if the trigger that decrements
          // used_days hasn't run yet.
          taken = Math.max(used, takenByTypeId.get(lt.id) ?? 0);
          balance = entitlement - taken - pending;
        } else {
          // No allocation row — fall back to the leave type's max_days as the
          // entitlement and approved requests as taken.
          entitlement = Number(lt.max_days) || 0;
          taken = takenByTypeId.get(lt.id) ?? 0;
          balance = entitlement - taken;
        }

        if (isAnnual) {
          openingAnnual += entitlement;
          annualTaken += taken;
          balanceAnnual += balance;
        } else if (isSick) {
          openingSick += entitlement;
          sickTaken += taken;
          balanceSick += balance;
        }
      }
      if (active) {
        setLeaveSummary({
          openingAnnualLeave: openingAnnual,
          annualLeaveTaken: annualTaken,
          balanceAnnualLeave: balanceAnnual,
          openingSickLeave: openingSick,
          sickLeaveTaken: sickTaken,
          balanceSickLeave: balanceSick,
        });
      }

      type LoanRow = {
        total_amount: number | null;
        remaining_amount: number | null;
        status: string | null;
      };
      const { data: loans } = await supabase
        .from('advance_salaries')
        .select('total_amount, remaining_amount, status')
        .eq('employee_id', form.employee_id);

      let totalLoan = 0, remainingLoan = 0;
      for (const l of (loans ?? []) as unknown as LoanRow[]) {
        // Only count loans that are live for the employee (money outstanding).
        if (l.status !== 'Approved' && l.status !== 'Completed') continue;
        const total = Number(l.total_amount) || 0;
        const remaining = l.remaining_amount == null ? total : Number(l.remaining_amount) || 0;
        totalLoan += total;
        remainingLoan += remaining;
      }
      if (active) {
        setLoanSummary({ totalSchoolLoan: totalLoan, remainingSchoolLoan: remainingLoan });
      }
    })();

    return () => { active = false; };
  }, [form.employee_id, form.period_to]);

  const openPayslipWindow = (autoPrint: boolean) => {
    setShowPdf(true);
    setTimeout(() => {
      const node = pdfRef.current;
      if (!node) return;
      const win = window.open('', '_blank', 'width=900,height=1100');
      if (!win) {
        toast('Allow pop-ups to print the payslip', 'error');
        setShowPdf(false);
        return;
      }
      const title = form.reference || 'Payslip';
      win.document.write(`<!doctype html><html><head><title>${title}</title>`);
      win.document.write(
        '<style>' +
          'html,body{margin:0;padding:0;background:#fff;font-family:Inter,Arial,system-ui,sans-serif;}' +
          // Force the printed paper size to A4 portrait so the browser does
          // not fall back to whatever default (Letter etc.) the system has.
          '@page{size:A4 portrait;margin:0;}' +
          '#payslip-pdf{width:210mm;min-height:297mm;margin:0 auto;box-sizing:border-box;}' +
          '@media print{' +
            'html,body{width:210mm;}' +
            'body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}' +
            '#payslip-pdf{width:210mm;min-height:297mm;page-break-inside:avoid;break-inside:avoid;}' +
          '}' +
        '</style>',
      );
      win.document.write('</head><body>');
      win.document.write(node.outerHTML);
      win.document.write('</body></html>');
      win.document.close();
      win.focus();
      if (autoPrint) {
        setTimeout(() => { win.print(); setShowPdf(false); }, 350);
      } else {
        setShowPdf(false);
      }
    }, 50);
  };

  const handlePrint = () => openPayslipWindow(true);

  const handleDownloadPdf = () => {
    setShowPdf(true);
    setTimeout(() => {
      const node = pdfRef.current;
      if (!node) {
        setShowPdf(false);
        return;
      }
      const imgs = Array.from(node.querySelectorAll('img'));
      const ready = Promise.all(
        imgs.map(
          (img) =>
            img.complete && img.naturalWidth > 0
              ? Promise.resolve()
              : new Promise<void>((res) => {
                  img.addEventListener('load', () => res(), { once: true });
                  img.addEventListener('error', () => res(), { once: true });
                }),
        ),
      );
      void ready.then(() => {
        const filename = `${form.reference || 'Payslip'}.pdf`;
        const opt = {
          margin: 0,
          filename,
          image: { type: 'jpeg' as const, quality: 0.98 },
          html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' as const },
        };
        html2pdf()
          .set(opt)
          .from(node)
          .save()
          .then(() => setShowPdf(false))
          .catch((err) => {
            setShowPdf(false);
            toast(`PDF generation failed: ${String(err)}`, 'error');
          });
      });
    }, 100);
  };

  if (loading) {
    return <div className="card" style={{ padding: 32, textAlign: 'center', color: 'var(--text2)' }}>Loading…</div>;
  }

  const tabs: { key: TabKey; label: string; icon: string }[] = [
    { key: 'salary', label: 'Salary Computation', icon: 'fa-calculator' },
    { key: 'monthly', label: 'Monthly Variable', icon: 'fa-chart-line' },
    { key: 'workeddays', label: 'Worked Days & Inputs', icon: 'fa-calendar-days' },
    { key: 'details', label: 'Details', icon: 'fa-list-ul' },
    { key: 'accounting', label: 'Accounting', icon: 'fa-book' },
  ];

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">{form.reference || 'New Payslip'}</div>
          <div className="page-sub">HR Management · Payslip</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-outline btn-sm" onClick={() => navigate('hr-payslips')}>
            <i className="fa-solid fa-arrow-left" /> Back
          </button>
          {form.id && (
            <>
              <button className="btn btn-outline btn-sm" onClick={handlePrint}>
                <i className="fa-solid fa-print" /> Print
              </button>
              <button className="btn btn-outline btn-sm" onClick={handleDownloadPdf} title="Download payslip as PDF">
                <i className="fa-solid fa-file-pdf" /> Download PDF
              </button>
            </>
          )}
          {writeOk && (
            <button className="btn btn-primary btn-sm" onClick={() => void handleSave()} disabled={saving}>
              <i className="fa-solid fa-floppy-disk" /> {saving ? 'Saving…' : form.id ? 'Save' : 'Create'}
            </button>
          )}
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(212,146,10,0.13)', color: '#d4920a' }}>
            <i className="fa-solid fa-money-bill" />
          </div>
          <div>
            <div className="stat-val" style={{ fontSize: 16 }}>{fmtMoney(computed.grossSalary)}</div>
            <div className="stat-label">Gross</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(37,99,235,0.13)', color: '#2563eb' }}>
            <i className="fa-solid fa-calculator" />
          </div>
          <div>
            <div className="stat-val" style={{ fontSize: 16 }}>{fmtMoney(computed.taxableIncome)}</div>
            <div className="stat-label">Taxable</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(130,80,223,0.13)', color: '#8250df' }}>
            <i className="fa-solid fa-percent" />
          </div>
          <div>
            <div className="stat-val" style={{ fontSize: 16 }}>{fmtMoney(computed.payeTax)}</div>
            <div className="stat-label">PAYE</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(207,34,46,0.13)', color: '#cf222e' }}>
            <i className="fa-solid fa-arrow-down" />
          </div>
          <div>
            <div className="stat-val" style={{ fontSize: 16 }}>{fmtMoney(computed.totalDeductions)}</div>
            <div className="stat-label">Deductions</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(26,127,55,0.13)', color: '#1a7f37' }}>
            <i className="fa-solid fa-sack-dollar" />
          </div>
          <div>
            <div className="stat-val" style={{ fontSize: 16, color: '#1a7f37' }}>{fmtMoney(computed.netSalary)}</div>
            <div className="stat-label">Net</div>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title"><span>Payslip Details</span></div>
        <div className="form-row cols3">
          <div className="form-group">
            <label>Reference</label>
            <input className="form-input" value={form.reference} disabled onChange={() => undefined} />
          </div>
          <div className="form-group">
            <label>Employee *</label>
            <select className="form-select" disabled={!writeOk || !!form.id} value={form.employee_id} onChange={(e) => update('employee_id', e.target.value)}>
              <option value="">— Select —</option>
              {employees
                .filter((e) => !!form.id /* editing — always show */ || activeContractEmpIds.has(e.id))
                .map((e) => <option key={e.id} value={e.id}>{e.employee_name} ({e.employee_code})</option>)}
            </select>
            {!form.id && activeContractEmpIds.size === 0 && employees.length > 0 && (
              <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>
                No employees have an active contract yet — create or activate a contract first.
              </div>
            )}
          </div>
          <div className="form-group">
            <label>Status</label>
            <select className="form-select" disabled={!writeOk} value={form.status} onChange={(e) => update('status', e.target.value as FormState['status'])}>
              <option value="draft">Draft</option>
              <option value="confirmed">Confirmed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
        </div>
        <div className="form-row cols3">
          <div className="form-group">
            <label>Period From</label>
            <input type="date" className="form-input" disabled={!writeOk} value={form.period_from} onChange={(e) => update('period_from', e.target.value)} />
          </div>
          <div className="form-group">
            <label>Period To</label>
            <input type="date" className="form-input" disabled={!writeOk} value={form.period_to} onChange={(e) => update('period_to', e.target.value)} />
          </div>
          <div className="form-group">
            <label>Basic Salary *</label>
            <input type="number" step="0.01" className="form-input" disabled={!writeOk} value={form.basic_salary} onChange={(e) => update('basic_salary', e.target.value)} />
          </div>
        </div>
        <div className="form-group">
          <label>Payslip Name</label>
          <input className="form-input" disabled={!writeOk} value={form.payslip_name} onChange={(e) => update('payslip_name', e.target.value)} />
        </div>
        <div className="form-row cols2">
          <div className="form-group">
            <label>Severance (Taxable)</label>
            <input type="number" step="0.01" className="form-input" disabled={!writeOk} value={form.severanceTaxable} onChange={(e) => update('severanceTaxable', e.target.value)} />
          </div>
          <div className="form-group">
            <label>Severance (Non-Taxable)</label>
            <input type="number" step="0.01" className="form-input" disabled={!writeOk} value={form.severanceNonTaxable} onChange={(e) => update('severanceNonTaxable', e.target.value)} />
          </div>
        </div>
        {writeOk && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
            <button
              type="button"
              className="btn btn-sm btn-outline"
              onClick={() => {
                const emp = employees.find((e) => e.id === form.employee_id) as
                  | { joining_date?: string | null; exit_date?: string | null }
                  | undefined;
                if (!emp) {
                  toast('Select an employee first.', 'error');
                  return;
                }
                const joinDate = emp.joining_date;
                if (!joinDate) {
                  toast('Set the joining date on the employee record to auto-calculate severance.', 'error');
                  return;
                }
                const exitDate = emp.exit_date || form.period_to;
                if (!exitDate) {
                  toast('Set an exit date on the employee record, or a period-to date on the payslip.', 'error');
                  return;
                }
                const wage = Number(form.basic_salary) || 0;
                if (wage <= 0) {
                  toast('Set the basic salary first.', 'error');
                  return;
                }
                const result = calcSeveranceBenefit({
                  contract_wage: wage,
                  join_date: joinDate,
                  exit_date: exitDate,
                });
                if (result.completed_months <= 0) {
                  toast('No completed months of service — severance is zero.', 'info');
                  setForm((f) => ({ ...f, severanceTaxable: '0', severanceNonTaxable: '0' }));
                  return;
                }
                const halves = splitSeverance(result.amount);
                setForm((f) => ({
                  ...f,
                  severanceTaxable: String(halves.taxable),
                  severanceNonTaxable: String(halves.nonTaxable),
                }));
                toast(
                  `Severance auto-calculated: ${result.completed_months} months × ${fmtCurrency(wage / 24)} = ${fmtCurrency(result.amount)}`,
                  'success',
                );
              }}
            >
              <i className="fa-solid fa-calculator" /> Auto-calc from exit date
            </button>
          </div>
        )}
      </div>

      <div className="tabs">
        {tabs.map((t) => (
          <div key={t.key} className={`tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
            <i className={`fa-solid ${t.icon}`} style={{ marginRight: 6 }} />
            {t.label}
          </div>
        ))}
      </div>

      {tab === 'salary' && (
        <SalaryComputationTab
          basicSalary={Number(form.basic_salary) || 0}
          onBasicChange={(v) => update('basic_salary', String(v))}
          earnings={form.earnings}
          fixedDeductions={form.fixedDeductions}
          computedEarnings={computed.allEarnings}
          computedDeductions={computed.allDeductions}
          grossSalary={computed.grossSalary}
          totalDeductions={computed.totalDeductions}
          netSalary={computed.netSalary}
          onEditEarning={(idx, patch) => updateLine('earnings', idx, patch)}
          onEditDeduction={(idx, patch) => updateLine('fixedDeductions', idx, patch)}
          onAddEarning={() => addLine('earnings')}
          onAddDeduction={() => addLine('fixedDeductions')}
          onRemoveEarning={(idx) => removeLine('earnings', idx)}
          onRemoveDeduction={(idx) => removeLine('fixedDeductions', idx)}
          payComponents={payComponents}
          writeOk={writeOk}
        />
      )}

      {tab === 'monthly' && (
        <MonthlyVariablesTab
          earnings={form.earnings}
          fixedDeductions={form.fixedDeductions}
          benefits={form.benefits}
          onEditEarning={(idx, patch) => updateLine('earnings', idx, patch)}
          onEditDeduction={(idx, patch) => updateLine('fixedDeductions', idx, patch)}
          onEditBenefit={(idx, patch) => updateLine('benefits', idx, patch)}
          payComponents={payComponents}
          writeOk={writeOk}
        />
      )}

      {tab === 'workeddays' && (
        <WorkedDaysTab
          periodFrom={form.period_from}
          periodTo={form.period_to}
          joinDate={selectedEmployee?.joining_date}
          hourLines={form.earnings.filter((e) => (e.hours ?? 0) > 0).map((e) => ({ description: e.description, code: e.code, hours: e.hours }))}
        />
      )}

      {tab === 'details' && (
        <DetailsTab earnings={computed.allEarnings} deductions={computed.allDeductions} />
      )}

      {tab === 'accounting' && (
        <AccountingTab
          reference={form.reference}
          payslipName={form.payslip_name}
          employeeName={selectedEmployee?.employee_name ?? ''}
          employeeCode={selectedEmployee?.employee_code ?? ''}
          department={selectedEmployee?.department}
          jobTitle={selectedEmployee?.job_title}
          contract="Employee"
          structure="Employee"
          periodFrom={form.period_from}
          periodTo={form.period_to}
          grossSalary={computed.grossSalary}
          netSalary={computed.netSalary}
          status={form.status}
        />
      )}

      {/* Bottom-of-page computed breakdown summary (always visible reference) */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-title"><span>Computed Breakdown ({fmtDate(form.period_from)} → {fmtDate(form.period_to)})</span></div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#1a7f37', marginBottom: 8 }}>Earnings</div>
            {computed.allEarnings.map((l, i) => (
              <div className="info-row" key={i}>
                <div className="info-label">{l.description}</div>
                <div className="info-val">{fmtMoney(l.amount)}</div>
              </div>
            ))}
            <div className="info-row" style={{ fontWeight: 700, borderTop: '2px solid var(--border)', borderBottom: 'none', paddingTop: 10 }}>
              <div className="info-label" style={{ color: 'var(--text)', fontSize: 12, fontWeight: 700 }}>GROSS</div>
              <div className="info-val">{fmtCurrency(computed.grossSalary)}</div>
            </div>
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#cf222e', marginBottom: 8 }}>Deductions</div>
            {computed.allDeductions.map((l, i) => (
              <div className="info-row" key={i}>
                <div className="info-label">{l.description}</div>
                <div className="info-val">{fmtMoney(l.amount)}</div>
              </div>
            ))}
            <div className="info-row" style={{ fontWeight: 700, borderTop: '2px solid var(--border)', borderBottom: 'none', paddingTop: 10 }}>
              <div className="info-label" style={{ color: 'var(--text)', fontSize: 12, fontWeight: 700 }}>TOTAL DEDUCTIONS</div>
              <div className="info-val">{fmtCurrency(computed.totalDeductions)}</div>
            </div>
            <div className="info-row" style={{ fontWeight: 700, color: '#1a7f37', borderBottom: 'none', paddingTop: 12, fontSize: 13 }}>
              <div className="info-label" style={{ color: '#1a7f37', fontSize: 13, fontWeight: 700 }}>NET SALARY</div>
              <div className="info-val" style={{ color: '#1a7f37', fontSize: 14 }}>{fmtCurrency(computed.netSalary)}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Hidden PDF for printing */}
      {showPdf && (
        <div style={{ position: 'fixed', left: -10000, top: 0 }} aria-hidden>
          <div ref={pdfRef}>
            <PayslipPDF
              reference={form.reference}
              payslipName={form.payslip_name}
              employeeName={selectedEmployee?.employee_name ?? ''}
              employeeCode={selectedEmployee?.employee_code ?? ''}
              employeeId={selectedEmployee?.employee_code ?? ''}
              department={selectedEmployee?.department}
              jobTitle={selectedEmployee?.job_title}
              contract="Employee"
              structure="Employee"
              periodFrom={form.period_from}
              periodTo={form.period_to}
              payslipDate={selectedEmployee?.payslip_date ?? form.period_to}
              bankName={selectedEmployee?.bank_name}
              bankAccount={selectedEmployee?.account_no}
              joinDate={selectedEmployee?.joining_date}
              grossSalary={computed.grossSalary}
              totalDeductions={computed.totalDeductions}
              netSalary={computed.netSalary}
              earnings={computed.allEarnings}
              deductions={computed.allDeductions}
              hourLines={form.earnings.filter((e) => (e.hours ?? 0) > 0).map((e) => ({ description: e.description, code: e.code, hours: e.hours }))}
              openingAnnualLeave={leaveSummary.openingAnnualLeave}
              annualLeaveTaken={leaveSummary.annualLeaveTaken}
              balanceAnnualLeave={leaveSummary.balanceAnnualLeave}
              openingSickLeave={leaveSummary.openingSickLeave}
              sickLeaveTaken={leaveSummary.sickLeaveTaken}
              balanceSickLeave={leaveSummary.balanceSickLeave}
              totalSchoolLoan={loanSummary.totalSchoolLoan}
              remainingSchoolLoan={loanSummary.remainingSchoolLoan}
            />
          </div>
        </div>
      )}
    </>
  );
}
