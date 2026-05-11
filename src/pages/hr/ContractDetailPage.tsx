import { useCallback, useEffect, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { useUserRole } from '@/hooks/hr/useUserRole';
import { usePayComponents } from '@/hooks/hr/usePayComponents';
import { useContractTemplates } from '@/hooks/hr/useContracts';
import { fmtCurrency } from '@/lib/hr/leaveUtils';
import { supabase } from '@/integrations/supabase/client';

interface ContractRow {
  id: string;
  employee_id: string | null;
  contract_name: string | null;
  wage: number;
  start_date: string | null;
  end_date: string | null;
  salary_structure_type: string | null;
  department: string | null;
  job_position: string | null;
  status: 'active' | 'inactive' | 'suspended';
  template_id: string | null;
}

interface LineRow {
  id: string;
  contract_id: string;
  component_def_id: string | null;
  amount: number;
  sequence: number;
  is_earning: boolean;
  is_active: boolean;
}

export default function ContractDetailPage() {
  const { navigate, pageParams, toast } = useApp();
  const { can } = useUserRole();
  const contractId = pageParams.contractId as string | undefined;
  const writeOk = can('contracts', 'write');
  const { components } = usePayComponents();
  const { templates } = useContractTemplates();

  const [contract, setContract] = useState<ContractRow | null>(null);
  const [employee, setEmployee] = useState<{ id: string; employee_name: string; employee_code: string } | null>(null);
  const [lines, setLines] = useState<LineRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const refetch = useCallback(async () => {
    if (!contractId) return;
    setLoading(true);
    const [{ data: c }, { data: ls }] = await Promise.all([
      supabase.from('contracts').select('*').eq('id', contractId).maybeSingle(),
      supabase.from('contract_lines').select('*').eq('contract_id', contractId).order('sequence'),
    ]);
    setContract((c ?? null) as ContractRow | null);
    setLines(((ls ?? []) as LineRow[]).slice());
    if (c?.employee_id) {
      const { data: e } = await supabase
        .from('employees')
        .select('id, employee_name, employee_code')
        .eq('id', c.employee_id as string)
        .maybeSingle();
      setEmployee(
        (e ?? null) as { id: string; employee_name: string; employee_code: string } | null,
      );
    } else {
      setEmployee(null);
    }
    setLoading(false);
  }, [contractId]);

  useEffect(() => { void refetch(); }, [refetch]);

  const updateContract = (patch: Partial<ContractRow>) =>
    setContract((c) => (c ? { ...c, ...patch } : c));

  const saveContract = async () => {
    if (!contract) return;
    setSaving(true);
    const { error } = await supabase
      .from('contracts')
      .update({
        contract_name: contract.contract_name,
        wage: contract.wage,
        start_date: contract.start_date,
        end_date: contract.end_date,
        salary_structure_type: contract.salary_structure_type,
        department: contract.department,
        job_position: contract.job_position,
        status: contract.status,
        template_id: contract.template_id,
      })
      .eq('id', contract.id);
    setSaving(false);
    if (error) { toast(error.message, 'error'); return; }
    toast('Contract saved', 'success');
  };

  const addLine = async (isEarning: boolean) => {
    if (!contract) return;
    const { data, error } = await supabase
      .from('contract_lines')
      .insert({
        contract_id: contract.id,
        amount: 0,
        sequence: (lines.length + 1) * 10,
        is_earning: isEarning,
        is_active: true,
      })
      .select('*')
      .single();
    if (error) { toast(error.message, 'error'); return; }
    if (data) setLines((l) => [...l, data as LineRow]);
  };

  const updateLine = async (lineId: string, patch: Partial<LineRow>) => {
    const newLines = lines.map((l) => (l.id === lineId ? { ...l, ...patch } : l));
    setLines(newLines);
    await supabase.from('contract_lines').update(patch).eq('id', lineId);
  };

  const deleteLine = async (lineId: string) => {
    if (!window.confirm('Delete this line?')) return;
    const { error } = await supabase.from('contract_lines').delete().eq('id', lineId);
    if (error) { toast(error.message, 'error'); return; }
    setLines((l) => l.filter((x) => x.id !== lineId));
  };

  if (!contractId) {
    return (
      <div className="card" style={{ padding: 32, textAlign: 'center' }}>
        <div style={{ marginBottom: 16 }}>No contract selected.</div>
        <button className="btn btn-primary btn-sm" onClick={() => navigate('hr-contracts')}>
          Back to Contracts
        </button>
      </div>
    );
  }

  if (loading) {
    return <div className="card" style={{ padding: 32, textAlign: 'center', color: 'var(--text2)' }}>Loading…</div>;
  }

  if (!contract) {
    return <div className="card" style={{ padding: 32, textAlign: 'center' }}>Contract not found.</div>;
  }

  const earnings = lines.filter((l) => l.is_earning);
  const deductions = lines.filter((l) => !l.is_earning);
  const totalEarnings = earnings.reduce((s, l) => s + Number(l.amount), 0);
  const totalDeductions = deductions.reduce((s, l) => s + Number(l.amount), 0);

  const renderLineTable = (rows: LineRow[], title: string, isEarning: boolean) => (
    <div className="card" style={{ padding: 0 }}>
      <div className="card-title" style={{ padding: '16px 20px 10px', borderBottom: '1px solid var(--border)', marginBottom: 0 }}>
        <span>{title} · {fmtCurrency(rows.reduce((s, l) => s + Number(l.amount), 0))}</span>
        {writeOk && (
          <button className="btn btn-outline btn-sm" onClick={() => void addLine(isEarning)}>
            <i className="fa-solid fa-plus" /> Add line
          </button>
        )}
      </div>
      {rows.length === 0 ? (
        <div style={{ padding: 16, color: 'var(--text2)', fontSize: 12, textAlign: 'center' }}>None</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Component</th>
                <th style={{ width: 140 }}>Amount</th>
                <th style={{ width: 70 }}>Seq</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id}>
                  <td>
                    <select
                      className="form-select"
                      disabled={!writeOk}
                      value={l.component_def_id ?? ''}
                      onChange={(e) => void updateLine(l.id, { component_def_id: e.target.value || null })}
                    >
                      <option value="">— Select —</option>
                      {components
                        .filter((c) => (isEarning ? c.category !== 'deduction' : c.category === 'deduction'))
                        .map((c) => (
                          <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
                        ))}
                    </select>
                  </td>
                  <td>
                    <input
                      type="number"
                      step="0.01"
                      disabled={!writeOk}
                      className="form-input"
                      value={l.amount}
                      onChange={(e) => void updateLine(l.id, { amount: Number(e.target.value) })}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      disabled={!writeOk}
                      className="form-input"
                      value={l.sequence}
                      onChange={(e) => void updateLine(l.id, { sequence: Number(e.target.value) })}
                    />
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {writeOk && (
                      <button className="btn btn-danger btn-sm" onClick={() => void deleteLine(l.id)}>
                        <i className="fa-solid fa-trash" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">
            {contract.contract_name ?? 'Contract'} {employee ? `· ${employee.employee_name}` : ''}
          </div>
          <div className="page-sub">HR Management · Contract</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-outline btn-sm" onClick={() => navigate('hr-contracts')}>
            <i className="fa-solid fa-arrow-left" /> Back
          </button>
          {writeOk && (
            <button className="btn btn-primary btn-sm" onClick={() => void saveContract()} disabled={saving}>
              <i className="fa-solid fa-floppy-disk" /> {saving ? 'Saving…' : 'Save'}
            </button>
          )}
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(37,99,235,0.13)', color: '#2563eb' }}>
            <i className="fa-solid fa-money-bill" />
          </div>
          <div>
            <div className="stat-val" style={{ fontSize: 16 }}>{fmtCurrency(contract.wage)}</div>
            <div className="stat-label">Wage</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(26,127,55,0.13)', color: '#1a7f37' }}>
            <i className="fa-solid fa-arrow-up" />
          </div>
          <div>
            <div className="stat-val" style={{ fontSize: 16 }}>{fmtCurrency(totalEarnings)}</div>
            <div className="stat-label">Total Earnings</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(207,34,46,0.13)', color: '#cf222e' }}>
            <i className="fa-solid fa-arrow-down" />
          </div>
          <div>
            <div className="stat-val" style={{ fontSize: 16 }}>{fmtCurrency(totalDeductions)}</div>
            <div className="stat-label">Total Deductions</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(212,146,10,0.13)', color: '#d4920a' }}>
            <i className="fa-solid fa-flag" />
          </div>
          <div>
            <div className="stat-val" style={{ fontSize: 16, textTransform: 'capitalize' }}>{contract.status}</div>
            <div className="stat-label">Status</div>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title"><span>Contract Details</span></div>
        <div className="form-row cols3">
          <div className="form-group">
            <label>Contract Name</label>
            <input className="form-input" disabled={!writeOk} value={contract.contract_name ?? ''} onChange={(e) => updateContract({ contract_name: e.target.value })} />
          </div>
          <div className="form-group">
            <label>Wage</label>
            <input type="number" step="0.01" className="form-input" disabled={!writeOk} value={contract.wage} onChange={(e) => updateContract({ wage: Number(e.target.value) })} />
          </div>
          <div className="form-group">
            <label>Job Position</label>
            <input className="form-input" disabled={!writeOk} value={contract.job_position ?? ''} onChange={(e) => updateContract({ job_position: e.target.value })} />
          </div>
        </div>
        <div className="form-row cols3">
          <div className="form-group">
            <label>Department</label>
            <input className="form-input" disabled={!writeOk} value={contract.department ?? ''} onChange={(e) => updateContract({ department: e.target.value })} />
          </div>
          <div className="form-group">
            <label>Salary Structure</label>
            <input className="form-input" disabled={!writeOk} value={contract.salary_structure_type ?? ''} onChange={(e) => updateContract({ salary_structure_type: e.target.value })} />
          </div>
          <div className="form-group">
            <label>Template</label>
            <select className="form-select" disabled={!writeOk} value={contract.template_id ?? ''} onChange={(e) => updateContract({ template_id: e.target.value || null })}>
              <option value="">— None —</option>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        </div>
        <div className="form-row cols3">
          <div className="form-group">
            <label>Start Date</label>
            <input type="date" className="form-input" disabled={!writeOk} value={contract.start_date ?? ''} onChange={(e) => updateContract({ start_date: e.target.value || null })} />
          </div>
          <div className="form-group">
            <label>End Date</label>
            <input type="date" className="form-input" disabled={!writeOk} value={contract.end_date ?? ''} onChange={(e) => updateContract({ end_date: e.target.value || null })} />
          </div>
          <div className="form-group">
            <label>Status</label>
            <select className="form-select" disabled={!writeOk} value={contract.status} onChange={(e) => updateContract({ status: e.target.value as ContractRow['status'] })}>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
        </div>
      </div>

      <div className="two-col">
        {renderLineTable(earnings, 'Earnings', true)}
        {renderLineTable(deductions, 'Deductions', false)}
      </div>
    </>
  );
}
