import { useState, useEffect, useCallback } from 'react';
import { useApp } from '@/context/AppContext';
import { supabase } from '@/integrations/supabase/client';

const DEPARTMENTS = [
  'Academics', 'Admin & Operations', 'Administration', 'Compliance',
  'Compliance & Monitoring', 'Culinary & Hospitality',
  'Culinary & Hospitality Practicals', 'Culinary Practicals',
  'Marketing', 'Operations',
];

interface UserRow {
  user_id: string;
  name: string;
  email: string;
  role: string;
  dept: string;
  source: 'auth' | 'student';
  student_id?: string;
}

export default function UserManagementPage() {
  const { toast, showModal, closeModal, reloadDb, db } = useApp();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'staff' | 'student'>('all');

  const loadUsers = useCallback(async () => {
    setLoading(true);
    // Load auth users (staff)
    const { data: profiles } = await supabase.from('profiles').select('*');
    const { data: roles } = await supabase.from('user_roles').select('*');
    const roleMap: Record<string, string> = {};
    (roles || []).forEach((r: any) => { roleMap[r.user_id] = r.role; });
    const authUsers: UserRow[] = (profiles || []).map((p: any) => ({
      user_id: p.user_id,
      name: p.name,
      email: p.email || '',
      role: roleMap[p.user_id] || 'unknown',
      dept: p.dept || '',
      source: 'auth' as const,
    }));

    // Load students from students table
    const { data: students } = await supabase.from('students').select('*');
    const studentUsers: UserRow[] = (students || []).map((s: any) => ({
      user_id: s.id,
      name: s.name,
      email: s.email || '',
      role: 'student',
      dept: '',
      source: 'student' as const,
      student_id: s.student_id,
    }));

    setUsers([...authUsers, ...studentUsers]);
    setLoading(false);
  }, []);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  const filtered = users.filter(u => {
    if (filter === 'staff') return u.source === 'auth' && u.role !== 'student';
    if (filter === 'student') return u.role === 'student';
    return true;
  });

  const handleDelete = async (u: UserRow) => {
    if (!confirm(`Delete user "${u.name}" (${u.email})? This cannot be undone.`)) return;
    if (u.source === 'student') {
      const { error } = await supabase.from('students').delete().eq('id', u.user_id);
      if (error) { toast(error.message, 'error'); } else { toast('Student deleted', 'success'); loadUsers(); reloadDb(); }
      return;
    }
    const { data, error } = await supabase.functions.invoke('delete-user', {
      body: { user_id: u.user_id },
    });
    if (error || data?.error) {
      toast(data?.error || error?.message || 'Delete failed', 'error');
    } else {
      toast('User deleted', 'success');
      loadUsers();
    }
  };

  const handleResetPassword = (u: UserRow) => {
    if (u.source === 'student') { toast('Students don\'t have auth accounts to reset', 'error'); return; }
    let newPwd = 'BoswaStaff2026!';
    showModal('Reset Password: ' + u.name, (
      <div>
        <div className="form-group">
          <label>New Password</label>
          <input className="form-input" type="text" defaultValue={newPwd} onChange={e => newPwd = e.target.value} />
        </div>
        <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={async () => {
          const { data, error } = await supabase.functions.invoke('reset-password', {
            body: { user_id: u.user_id, new_password: newPwd },
          });
          if (error || data?.error) {
            toast(data?.error || error?.message || 'Reset failed', 'error');
          } else {
            toast('Password reset successfully', 'success');
            closeModal();
          }
        }}>Reset Password</button>
      </div>
    ));
  };

  const handleCreate = () => {
    let name = '', email = '', password = 'BoswaStaff2026!', role = 'lecturer', dept = '';
    showModal('Create New User', (
      <div>
        <div className="form-row cols2">
          <div className="form-group"><label>Full Name *</label><input className="form-input" onChange={e => name = e.target.value} /></div>
          <div className="form-group"><label>Email *</label><input className="form-input" type="email" onChange={e => email = e.target.value} /></div>
        </div>
        <div className="form-row cols2">
          <div className="form-group"><label>Password</label><input className="form-input" type="text" defaultValue={password} onChange={e => password = e.target.value} /></div>
          <div className="form-group"><label>Role</label>
            <select className="form-select" defaultValue={role} onChange={e => role = e.target.value}>
              <option value="admin">Admin</option>
              <option value="hod">HOD</option>
              <option value="hoy">HOY</option>
              <option value="lecturer">Lecturer</option>
              <option value="student">Student</option>
            </select>
          </div>
        </div>
        <div className="form-row cols2">
          <div className="form-group"><label>Department</label>
            <select className="form-select" defaultValue="" onChange={e => dept = e.target.value}>
              <option value="">— Select —</option>
              {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
        </div>
        <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={async () => {
          if (!name || !email) { toast('Name and email required', 'error'); return; }
          const { data, error } = await supabase.functions.invoke('create-user', {
            body: { email, password, name, role, dept },
          });
          if (error || data?.error) {
            toast(data?.error || error?.message || 'Create failed', 'error');
          } else {
            toast('User created!', 'success');
            closeModal();
            loadUsers();
            reloadDb();
          }
        }}>Create User</button>
      </div>
    ));
  };

  const handleResetAll = async () => {
    const authStaff = users.filter(u => u.source === 'auth');
    if (!confirm(`Reset passwords for all ${authStaff.length} auth users to BoswaStaff2026!?`)) return;
    let success = 0, fail = 0;
    for (const u of authStaff) {
      const { data, error } = await supabase.functions.invoke('reset-password', {
        body: { user_id: u.user_id, new_password: 'BoswaStaff2026!' },
      });
      if (error || data?.error) fail++; else success++;
    }
    toast(`${success} reset, ${fail} failed`, success > 0 ? 'success' : 'error');
  };

  const handleSeedFaculty = async () => {
    if (!confirm('This will create 7 faculty accounts with default password BoswaStaff2026!. Continue?')) return;
    const { data, error } = await supabase.functions.invoke('seed-faculty');
    if (error) {
      toast('Seed failed: ' + error.message, 'error');
    } else {
      const results = data?.results || [];
      const created = results.filter((r: any) => r.status === 'created').length;
      const existing = results.filter((r: any) => r.status === 'already_exists').length;
      toast(`${created} created, ${existing} already existed`, 'success');
      loadUsers();
      reloadDb();
    }
  };

  const roleBadgeClass = (role: string) => {
    if (role === 'admin') return 'badge-fail';
    if (role === 'hod' || role === 'hoy') return 'badge-pass';
    if (role === 'student') return 'badge-active';
    return 'badge-pass';
  };

  return (
    <>
      <div className="page-header">
        <div><div className="page-title">User Management</div><div className="page-sub">{filtered.length} of {users.length} users</div></div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select className="form-select" value={filter} onChange={e => setFilter(e.target.value as any)} style={{ width: 'auto', fontSize: 11 }}>
            <option value="all">All Users ({users.length})</option>
            <option value="staff">Staff Only ({users.filter(u => u.source === 'auth' && u.role !== 'student').length})</option>
            <option value="student">Students Only ({users.filter(u => u.role === 'student').length})</option>
          </select>
          <button className="btn btn-outline btn-sm" onClick={handleResetAll}><i className="fa-solid fa-key" /> Reset All Passwords</button>
          <button className="btn btn-outline btn-sm" onClick={handleSeedFaculty}><i className="fa-solid fa-database" /> Seed Faculty</button>
          <button className="btn btn-primary btn-sm" onClick={handleCreate}><i className="fa-solid fa-user-plus" /> Add User</button>
        </div>
      </div>
      <div className="card">
        {loading ? <div style={{ padding: 20, textAlign: 'center', color: 'var(--text2)' }}>Loading users...</div> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Name</th><th>Email / ID</th><th>Role</th><th>Department</th><th>Actions</th></tr></thead>
              <tbody>
                {filtered.map(u => (
                  <tr key={u.user_id + u.source}>
                    <td className="td-name">{u.name}</td>
                    <td style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11 }}>
                      {u.source === 'student' ? u.student_id || u.email || '—' : u.email}
                    </td>
                    <td><span className={`badge ${roleBadgeClass(u.role)}`}>{u.role.toUpperCase()}</span></td>
                    <td>{u.dept || '—'}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {u.source === 'auth' && <button className="btn btn-outline btn-sm" onClick={() => handleResetPassword(u)}>Reset Pwd</button>}
                        <button className="btn btn-outline btn-sm" onClick={() => handleDelete(u)} style={{ color: '#f85149' }}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
