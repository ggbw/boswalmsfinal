import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import { useApp } from '@/context/AppContext';
import { useUserRole } from '@/hooks/hr/useUserRole';
import { supabase } from '@/integrations/supabase/client';

interface HRUserRow {
  user_id: string;
  name: string;
  email: string;
  role: string;
  dept: string;
  code: string;
  // When true, this row represents an employee record with no linked auth user.
  // Actions that require an auth user (reset password, delete) are hidden.
  unlinked?: boolean;
}

const HR_ROLES = ['super_admin', 'admin', 'hr', 'manager', 'employee'] as const;

const roleBadge = (role: string): string => {
  if (role === 'super_admin' || role === 'admin') return 'badge badge-distinction';
  if (role === 'hr') return 'badge badge-merit';
  if (role === 'manager') return 'badge badge-pass';
  if (role === 'employee') return 'badge badge-active';
  return 'badge badge-inactive';
};

const roleLabel = (role: string): string => {
  if (role === 'super_admin') return 'Super Admin';
  if (role === 'admin') return 'Admin';
  if (role === 'hr') return 'HR';
  if (role === 'manager') return 'Manager';
  if (role === 'employee') return 'Employee';
  return role;
};

export default function HRUserManagementPage() {
  const { toast, showModal, closeModal } = useApp();
  const { isAdmin } = useUserRole();
  const [users, setUsers] = useState<HRUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');

  const loadUsers = useCallback(async () => {
    setLoading(true);
    const [{ data: profiles }, { data: roles }, { data: employees }] = await Promise.all([
      supabase.from('profiles').select('*'),
      supabase.from('user_roles').select('*'),
      supabase
        .from('employees')
        .select('id, employee_name, employee_code, department, email, auth_user_id'),
    ]);
    const roleMap: Record<string, string> = {};
    (roles || []).forEach((r: { user_id: string; role: string }) => {
      roleMap[r.user_id] = r.role;
    });

    type EmpRow = {
      id: string;
      employee_name: string | null;
      employee_code: string | null;
      department: string | null;
      email: string | null;
      auth_user_id: string | null;
    };
    const empByAuthId: Record<string, EmpRow> = {};
    (employees || []).forEach((e: EmpRow) => {
      if (e.auth_user_id) empByAuthId[e.auth_user_id] = e;
    });
    const profileUserIds = new Set((profiles || []).map((p: { user_id: string }) => p.user_id));

    // 1) Existing profile-backed users, enriched with employee data when available.
    const fromProfiles: HRUserRow[] = (profiles || [])
      .map((p: { user_id: string; name: string | null; email: string | null; dept: string | null; code: string | null }) => {
        const emp = empByAuthId[p.user_id];
        return {
          user_id: p.user_id,
          name: p.name ?? emp?.employee_name ?? '',
          email: p.email ?? emp?.email ?? '',
          role: roleMap[p.user_id] || (emp ? 'employee' : 'unknown'),
          dept: p.dept ?? emp?.department ?? '',
          code: p.code ?? emp?.employee_code ?? '',
        };
      })
      .filter((u) => (HR_ROLES as readonly string[]).includes(u.role));

    // 2) Employees whose auth user has no profile row yet — surface them too.
    const fromEmployeesWithAuth: HRUserRow[] = (employees || [])
      .filter((e: EmpRow) => e.auth_user_id && !profileUserIds.has(e.auth_user_id))
      .map((e: EmpRow) => ({
        user_id: e.auth_user_id as string,
        name: e.employee_name ?? '',
        email: e.email ?? '',
        role: roleMap[e.auth_user_id as string] || 'employee',
        dept: e.department ?? '',
        code: e.employee_code ?? '',
      }));

    // 3) Employees with no linked auth user — show as read-only "unlinked" rows.
    const fromEmployeesNoAuth: HRUserRow[] = (employees || [])
      .filter((e: EmpRow) => !e.auth_user_id)
      .map((e: EmpRow) => ({
        user_id: `emp:${e.id}`,
        name: e.employee_name ?? '',
        email: e.email ?? '',
        role: 'employee',
        dept: e.department ?? '',
        code: e.employee_code ?? '',
        unlinked: true,
      }));

    setUsers([...fromProfiles, ...fromEmployeesWithAuth, ...fromEmployeesNoAuth]);
    setLoading(false);
  }, []);

  useEffect(() => { void loadUsers(); }, [loadUsers]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      if (roleFilter !== 'all' && u.role !== roleFilter) return false;
      if (!q) return true;
      return (
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.dept.toLowerCase().includes(q) ||
        u.code.toLowerCase().includes(q)
      );
    });
  }, [users, search, roleFilter]);

  const counts = useMemo(() => ({
    total: users.length,
    hr: users.filter((u) => u.role === 'hr').length,
    manager: users.filter((u) => u.role === 'manager').length,
    employee: users.filter((u) => u.role === 'employee').length,
  }), [users]);

  const handleCreate = () => {
    let name = '';
    let email = '';
    let password = 'BoswaHR2026!';
    let role: string = 'employee';
    let dept = '';
    let code = '';

    showModal(
      'Add HR User',
      <div>
        <div className="form-row cols2">
          <div className="form-group">
            <label>Full Name *</label>
            <input className="form-input" placeholder="e.g. Jane Smith" onChange={(e) => (name = e.target.value)} />
          </div>
          <div className="form-group">
            <label>Email *</label>
            <input className="form-input" type="email" placeholder="user@boswa.ac.bw" onChange={(e) => (email = e.target.value)} />
          </div>
        </div>
        <div className="form-row cols2">
          <div className="form-group">
            <label>Initial Password *</label>
            <input className="form-input" type="text" defaultValue={password} onChange={(e) => (password = e.target.value)} />
          </div>
          <div className="form-group">
            <label>Role *</label>
            <select className="form-select" defaultValue={role} onChange={(e) => (role = e.target.value)}>
              <option value="employee">Employee</option>
              <option value="manager">Manager</option>
              <option value="hr">HR</option>
              {isAdmin && <option value="admin">Admin</option>}
              {isAdmin && <option value="super_admin">Super Admin</option>}
            </select>
          </div>
        </div>
        <div className="form-row cols2">
          <div className="form-group">
            <label>Department</label>
            <input className="form-input" placeholder="e.g. HR" onChange={(e) => (dept = e.target.value)} />
          </div>
          <div className="form-group">
            <label>Code</label>
            <input className="form-input" placeholder="optional" onChange={(e) => (code = e.target.value)} />
          </div>
        </div>
        <div
          style={{
            marginTop: 8,
            fontSize: 11,
            color: 'var(--text2)',
            background: 'var(--surface2)',
            padding: 10,
            borderRadius: 6,
          }}
        >
          <i className="fa-solid fa-circle-info" style={{ marginRight: 6 }} />
          Share the email and initial password with the user. They can change it after first login.
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button className="btn btn-outline btn-sm" onClick={closeModal}>Cancel</button>
          <button
            className="btn btn-primary btn-sm"
            onClick={async () => {
              if (!name.trim()) { toast('Full name is required', 'error'); return; }
              if (!email.trim() || !email.includes('@')) { toast('Valid email required', 'error'); return; }
              if (!password || password.length < 6) { toast('Password must be at least 6 characters', 'error'); return; }

              // Use an isolated Supabase client so signUp doesn't replace
              // the current admin's session in localStorage.
              const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
              const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
              const isolated = createClient(SUPABASE_URL, SUPABASE_KEY, {
                auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
              });

              const { data: signUpData, error: signUpError } = await isolated.auth.signUp({
                email: email.trim(),
                password,
                options: { data: { full_name: name.trim(), name: name.trim() } },
              });
              if (signUpError) { toast(signUpError.message, 'error'); return; }
              const userId = signUpData.user?.id;
              if (!userId) { toast('Sign-up did not return a user id', 'error'); return; }

              // The handle_new_user trigger created a minimal profile row.
              // Patch it with the extra fields (dept, code, name).
              const { error: profErr } = await supabase
                .from('profiles')
                .update({ name: name.trim(), dept: dept.trim() || null, code: code.trim() || null })
                .eq('user_id', userId);
              if (profErr) { toast(`Profile update failed: ${profErr.message}`, 'error'); }

              // Assign the chosen role.
              const { error: roleErr } = await supabase
                .from('user_roles')
                .insert({ user_id: userId, role });
              if (roleErr) {
                toast(`Role assignment failed: ${roleErr.message}`, 'error');
                return;
              }

              toast(`User "${name}" created with role ${roleLabel(role)}`, 'success');
              closeModal();
              void loadUsers();
            }}
          >
            <i className="fa-solid fa-user-plus" /> Create User
          </button>
        </div>
      </div>,
    );
  };

  const handleEdit = (u: HRUserRow) => {
    let { name, email, role, dept, code } = u;
    showModal(
      `Edit User: ${u.name}`,
      <div>
        <div className="form-row cols2">
          <div className="form-group">
            <label>Full Name</label>
            <input className="form-input" defaultValue={name} onChange={(e) => (name = e.target.value)} />
          </div>
          <div className="form-group">
            <label>Email</label>
            <input className="form-input" type="email" defaultValue={email} onChange={(e) => (email = e.target.value)} />
          </div>
        </div>
        <div className="form-row cols2">
          <div className="form-group">
            <label>Role</label>
            <select className="form-select" defaultValue={role} onChange={(e) => (role = e.target.value)}>
              <option value="hr">HR</option>
              <option value="manager">Manager</option>
              <option value="employee">Employee</option>
              {isAdmin && <option value="admin">Admin</option>}
              {isAdmin && <option value="super_admin">Super Admin</option>}
            </select>
          </div>
          <div className="form-group">
            <label>Department</label>
            <input className="form-input" defaultValue={dept} onChange={(e) => (dept = e.target.value)} />
          </div>
        </div>
        <div className="form-group">
          <label>Code</label>
          <input className="form-input" defaultValue={code} onChange={(e) => (code = e.target.value)} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button className="btn btn-outline btn-sm" onClick={closeModal}>Cancel</button>
          <button
            className="btn btn-primary btn-sm"
            onClick={async () => {
              const { error: profErr } = await supabase
                .from('profiles')
                .update({ name, email, dept, code })
                .eq('user_id', u.user_id);
              if (profErr) { toast(profErr.message, 'error'); return; }
              if (role !== u.role) {
                const { error: roleErr } = await supabase
                  .from('user_roles')
                  .update({ role })
                  .eq('user_id', u.user_id);
                if (roleErr) { toast(roleErr.message, 'error'); return; }
              }
              toast('User updated', 'success');
              closeModal();
              void loadUsers();
            }}
          >
            Save Changes
          </button>
        </div>
      </div>,
    );
  };

  const handleResetPassword = (u: HRUserRow) => {
    let newPwd = 'BoswaHR2026!';
    showModal(
      `Reset Password: ${u.name}`,
      <div>
        <div className="form-group">
          <label>New Password</label>
          <input
            className="form-input"
            type="text"
            defaultValue={newPwd}
            onChange={(e) => (newPwd = e.target.value)}
          />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button className="btn btn-outline btn-sm" onClick={closeModal}>Cancel</button>
          <button
            className="btn btn-primary btn-sm"
            onClick={async () => {
              const { data, error } = await supabase.functions.invoke('reset-password', {
                body: { user_id: u.user_id, new_password: newPwd },
              });
              const errMsg = (data as { error?: string } | null)?.error;
              if (error || errMsg) {
                toast(errMsg || error?.message || 'Reset failed', 'error');
              } else {
                toast('Password reset successfully', 'success');
                closeModal();
              }
            }}
          >
            Reset Password
          </button>
        </div>
      </div>,
    );
  };

  const handleDelete = (u: HRUserRow) => {
    if (!isAdmin) {
      toast('Only Admin or Super Admin can delete users', 'error');
      return;
    }
    showModal(
      'Delete User',
      <div>
        <p style={{ marginBottom: 16 }}>
          Delete <strong>{u.name}</strong> ({u.email})? This will remove their profile and role,
          but the auth account itself will still exist until removed by a server admin.
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn btn-outline btn-sm" onClick={closeModal}>Cancel</button>
          <button
            className="btn btn-danger btn-sm"
            onClick={async () => {
              const { error: roleErr } = await supabase.from('user_roles').delete().eq('user_id', u.user_id);
              const { error: profErr } = await supabase.from('profiles').delete().eq('user_id', u.user_id);
              closeModal();
              if (roleErr || profErr) {
                toast(roleErr?.message || profErr?.message || 'Delete failed', 'error');
              } else {
                toast('User deleted', 'info');
                void loadUsers();
              }
            }}
          >
            Delete
          </button>
        </div>
      </div>,
    );
  };

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">HR User Management</div>
          <div className="page-sub">HR Management · {filtered.length} of {users.length}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-outline btn-sm" onClick={() => void loadUsers()} disabled={loading}>
            <i className="fa-solid fa-rotate" /> Refresh
          </button>
          {isAdmin && (
            <button className="btn btn-primary btn-sm" onClick={handleCreate}>
              <i className="fa-solid fa-user-plus" /> Add User
            </button>
          )}
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(37,99,235,0.13)', color: '#2563eb' }}>
            <i className="fa-solid fa-users-gear" />
          </div>
          <div>
            <div className="stat-val">{counts.total}</div>
            <div className="stat-label">HR-related Users</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(212,146,10,0.13)', color: '#d4920a' }}>
            <i className="fa-solid fa-user-tie" />
          </div>
          <div>
            <div className="stat-val">{counts.hr}</div>
            <div className="stat-label">HR</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(130,80,223,0.13)', color: '#8250df' }}>
            <i className="fa-solid fa-user-shield" />
          </div>
          <div>
            <div className="stat-val">{counts.manager}</div>
            <div className="stat-label">Managers</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(26,127,55,0.13)', color: '#1a7f37' }}>
            <i className="fa-solid fa-user" />
          </div>
          <div>
            <div className="stat-val">{counts.employee}</div>
            <div className="stat-label">Employees</div>
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>HR Users</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              className="search-input"
              placeholder="Search name / email / department…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: 240 }}
            />
            <select className="filter-select" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
              <option value="all">All roles</option>
              {HR_ROLES.map((r) => (
                <option key={r} value={r}>{roleLabel(r)}</option>
              ))}
            </select>
          </div>
        </div>
        {loading ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text2)' }}>Loading users…</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text2)' }}>
            {users.length === 0 ? 'No HR-related users found.' : 'No matches.'}
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Department</th>
                  <th>Code</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((u) => (
                  <tr key={u.user_id}>
                    <td className="td-name">{u.name || '—'}</td>
                    <td>{u.email || '—'}</td>
                    <td>
                      <span className={roleBadge(u.role)}>{roleLabel(u.role)}</span>
                      {u.unlinked && (
                        <span
                          className="badge badge-inactive"
                          style={{ marginLeft: 6 }}
                          title="Employee record with no linked auth user"
                        >
                          No login
                        </span>
                      )}
                    </td>
                    <td>{u.dept || '—'}</td>
                    <td style={{ fontFamily: 'JetBrains Mono, monospace' }}>{u.code || '—'}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {u.unlinked ? (
                        <span style={{ color: 'var(--text2)', fontSize: 11 }}>—</span>
                      ) : (
                        <>
                          <button className="btn btn-outline btn-sm" title="Edit" onClick={() => handleEdit(u)} style={{ marginRight: 4 }}>
                            <i className="fa-solid fa-pen" />
                          </button>
                          <button className="btn btn-blue btn-sm" title="Reset Password" onClick={() => handleResetPassword(u)} style={{ marginRight: 4 }}>
                            <i className="fa-solid fa-key" />
                          </button>
                          {isAdmin && (
                            <button className="btn btn-danger btn-sm" title="Delete" onClick={() => handleDelete(u)}>
                              <i className="fa-solid fa-trash" />
                            </button>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: 16, background: 'var(--surface2)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <i className="fa-solid fa-circle-info" style={{ color: 'var(--accent2)', fontSize: 16, marginTop: 2 }} />
          <div style={{ fontSize: 12, color: 'var(--text2)' }}>
            <strong style={{ color: 'var(--text)' }}>Note:</strong> This page manages users with HR-related roles
            (HR, Manager, Employee, Admin, Super Admin). New users are created in Supabase Auth and assigned a role
            in one step — share the initial password with the user and ask them to change it after first login.
            Use <strong>Edit</strong> to change a role or department, the key icon to reset a password, and the trash
            icon to remove a user.
          </div>
        </div>
      </div>
    </>
  );
}
