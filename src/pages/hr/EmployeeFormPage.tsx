import { useEffect, useMemo, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { useEmployees, nextEmployeeCode, type Employee } from '@/hooks/hr/useEmployees';
import { useUserRole } from '@/hooks/hr/useUserRole';
import { supabase } from '@/integrations/supabase/client';

interface FormState {
  employee_name: string;
  job_title: string;
  employee_code: string;
  department: string;
  hr_department_id: string;
  branch_name: string;
  bank_name: string;
  bank_branch_code: string;
  bank_branch_name: string;
  account_no: string;
  email: string;
  mobile_number: string;
  basic_salary: string;
  gender: string;
  status: string;
  joining_date: string;
  manager_id: string;
}

const empty: FormState = {
  employee_name: '',
  job_title: '',
  employee_code: '',
  department: '',
  hr_department_id: '',
  branch_name: '',
  bank_name: '',
  bank_branch_code: '',
  bank_branch_name: '',
  account_no: '',
  email: '',
  mobile_number: '',
  basic_salary: '',
  gender: '',
  status: 'active',
  joining_date: '',
  manager_id: '',
};

function fromEmployee(e: Employee): FormState {
  return {
    employee_name: e.employee_name ?? '',
    job_title: e.job_title ?? '',
    employee_code: e.employee_code ?? '',
    department: e.department ?? '',
    hr_department_id: e.hr_department_id ?? '',
    branch_name: e.branch_name ?? '',
    bank_name: e.bank_name ?? '',
    bank_branch_code: e.bank_branch_code ?? '',
    bank_branch_name: e.bank_branch_name ?? '',
    account_no: e.account_no ?? '',
    email: e.email ?? '',
    mobile_number: e.mobile_number ?? '',
    basic_salary: e.basic_salary != null ? String(e.basic_salary) : '',
    gender: e.gender ?? '',
    status: e.status ?? 'active',
    joining_date: e.joining_date ?? '',
    manager_id: e.manager_id ?? '',
  };
}

export default function EmployeeFormPage() {
  const { navigate, pageParams, toast } = useApp();
  const { can } = useUserRole();
  const { employees, refetch } = useEmployees();

  const mode = (pageParams.mode as 'create' | 'edit') ?? 'create';
  const employeeId = pageParams.employeeId as string | undefined;

  const existing = useMemo(
    () => (employeeId ? employees.find((e) => e.id === employeeId) ?? null : null),
    [employeeId, employees],
  );

  const [form, setForm] = useState<FormState>(empty);
  const [saving, setSaving] = useState(false);
  const [departments, setDepartments] = useState<Array<{ id: string; name: string }>>([]);

  useEffect(() => {
    if (existing) {
      setForm(fromEmployee(existing));
      return;
    }
    // Create mode — pre-fill employee_code with the next available code
    setForm(empty);
    let active = true;
    void nextEmployeeCode().then((code) => {
      if (active) setForm((f) => (f.employee_code ? f : { ...f, employee_code: code }));
    });
    return () => { active = false; };
  }, [existing]);

  useEffect(() => {
    void supabase
      .from('hr_departments')
      .select('id, name')
      .eq('is_active', true)
      .order('name')
      .then(({ data }) => setDepartments((data ?? []) as Array<{ id: string; name: string }>));
  }, []);

  const update = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  if (!can('employees', 'write')) {
    return (
      <div className="card" style={{ padding: 32, textAlign: 'center' }}>
        You do not have permission to {mode} employees.
      </div>
    );
  }

  const handleSave = async () => {
    if (!form.employee_name.trim()) { toast('Employee name is required', 'error'); return; }
    if (!form.employee_code.trim()) { toast('Employee code is required', 'error'); return; }

    setSaving(true);
    const payload = {
      employee_name: form.employee_name.trim(),
      job_title: form.job_title.trim() || null,
      employee_code: form.employee_code.trim().toUpperCase(),
      department: form.department.trim() || null,
      hr_department_id: form.hr_department_id || null,
      branch_name: form.branch_name.trim() || null,
      bank_name: form.bank_name.trim() || null,
      bank_branch_code: form.bank_branch_code.trim() || null,
      bank_branch_name: form.bank_branch_name.trim() || null,
      account_no: form.account_no.trim() || null,
      email: form.email.trim() || null,
      mobile_number: form.mobile_number.trim() || null,
      basic_salary: form.basic_salary ? Number(form.basic_salary) : null,
      gender: form.gender || null,
      status: form.status,
      joining_date: form.joining_date || null,
      manager_id: form.manager_id || null,
    };

    const surfaceError = (
      err: { message: string; code?: string; hint?: string | null; details?: string | null },
      action: string,
    ) => {
      console.error(`[EmployeeFormPage] ${action} failed`, err);
      const parts: string[] = [err.message];
      if (err.code) parts.push(`code: ${err.code}`);
      if (err.hint) parts.push(`hint: ${err.hint}`);
      if (err.details) parts.push(`details: ${err.details}`);
      let userMessage = parts.join(' · ');
      // Add a friendly explanation for the most common RLS rejection
      if (err.code === '42501' || /row-level security/i.test(err.message)) {
        userMessage += ' — Your account does not have permission. Verify your role is admin / super_admin / hr in user_roles.';
      } else if (err.code === '23505') {
        userMessage += ' — Employee code must be unique.';
      } else if (/relation .* does not exist/i.test(err.message)) {
        userMessage += ' — HR migrations may not be applied yet.';
      }
      toast(userMessage, 'error');
    };

    if (mode === 'create') {
      const { error } = await supabase.from('employees').insert(payload);
      setSaving(false);
      if (error) { surfaceError(error, 'create'); return; }
      toast('Employee created', 'success');
    } else {
      if (!employeeId) { setSaving(false); toast('Missing employee id', 'error'); return; }
      const { error } = await supabase.from('employees').update(payload).eq('id', employeeId);
      setSaving(false);
      if (error) { surfaceError(error, 'update'); return; }
      toast('Employee updated', 'success');
    }

    void refetch();
    navigate('hr-employees');
  };

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">{mode === 'create' ? 'New Employee' : 'Edit Employee'}</div>
          <div className="page-sub">HR Management · Employees</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-outline btn-sm" onClick={() => navigate('hr-employees')}>
            <i className="fa-solid fa-arrow-left" /> Back
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => void handleSave()} disabled={saving}>
            <i className="fa-solid fa-floppy-disk" /> {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title"><span>Personal & Job</span></div>
        <div className="form-row cols3">
          <div className="form-group">
            <label>Full Name *</label>
            <input className="form-input" value={form.employee_name} onChange={(e) => update('employee_name', e.target.value)} />
          </div>
          <div className="form-group">
            <label>Employee Code *</label>
            <input className="form-input" value={form.employee_code} onChange={(e) => update('employee_code', e.target.value)} />
            {mode === 'create' && (
              <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 4 }}>
                Auto-generated · must be unique · you can change it before saving
              </div>
            )}
          </div>
          <div className="form-group">
            <label>Job Title</label>
            <input className="form-input" value={form.job_title} onChange={(e) => update('job_title', e.target.value)} />
          </div>
        </div>
        <div className="form-row cols3">
          <div className="form-group">
            <label>Department</label>
            <select
              className="form-select"
              value={form.hr_department_id}
              onChange={(e) => {
                const dept = departments.find((d) => d.id === e.target.value);
                update('hr_department_id', e.target.value);
                update('department', dept?.name ?? '');
              }}
            >
              <option value="">— Select —</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>Gender</label>
            <select className="form-select" value={form.gender} onChange={(e) => update('gender', e.target.value)}>
              <option value="">—</option>
              <option value="Male">Male</option>
              <option value="Female">Female</option>
              <option value="Other">Other</option>
            </select>
          </div>
          <div className="form-group">
            <label>Status</label>
            <select className="form-select" value={form.status} onChange={(e) => update('status', e.target.value)}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="terminated">Terminated</option>
            </select>
          </div>
        </div>
        <div className="form-row cols3">
          <div className="form-group">
            <label>Joining Date</label>
            <input type="date" className="form-input" value={form.joining_date} onChange={(e) => update('joining_date', e.target.value)} />
          </div>
          <div className="form-group">
            <label>Manager</label>
            <select className="form-select" value={form.manager_id} onChange={(e) => update('manager_id', e.target.value)}>
              <option value="">— None —</option>
              {employees
                .filter((e) => e.id !== employeeId)
                .map((e) => (
                  <option key={e.id} value={e.id}>{e.employee_name} ({e.employee_code})</option>
                ))}
            </select>
          </div>
          <div className="form-group">
            <label>Branch</label>
            <input className="form-input" value={form.branch_name} onChange={(e) => update('branch_name', e.target.value)} />
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title"><span>Contact</span></div>
        <div className="form-row cols2">
          <div className="form-group">
            <label>Email</label>
            <input type="email" className="form-input" value={form.email} onChange={(e) => update('email', e.target.value)} />
          </div>
          <div className="form-group">
            <label>Mobile</label>
            <input className="form-input" value={form.mobile_number} onChange={(e) => update('mobile_number', e.target.value)} />
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-title"><span>Banking & Salary</span></div>
        <div className="form-row cols3">
          <div className="form-group">
            <label>Basic Salary</label>
            <input type="number" step="0.01" className="form-input" value={form.basic_salary} onChange={(e) => update('basic_salary', e.target.value)} />
          </div>
          <div className="form-group">
            <label>Bank Name</label>
            <input className="form-input" value={form.bank_name} onChange={(e) => update('bank_name', e.target.value)} />
          </div>
          <div className="form-group">
            <label>Bank Branch Name</label>
            <input className="form-input" value={form.bank_branch_name} onChange={(e) => update('bank_branch_name', e.target.value)} />
          </div>
        </div>
        <div className="form-row cols2">
          <div className="form-group">
            <label>Bank Branch Code</label>
            <input className="form-input" value={form.bank_branch_code} onChange={(e) => update('bank_branch_code', e.target.value)} />
          </div>
          <div className="form-group">
            <label>Account Number</label>
            <input className="form-input" value={form.account_no} onChange={(e) => update('account_no', e.target.value)} />
          </div>
        </div>
      </div>
    </>
  );
}
