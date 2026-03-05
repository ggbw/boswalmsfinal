import { useState, useEffect, useCallback } from 'react';
import { useApp } from '@/context/AppContext';
import { supabase } from '@/integrations/supabase/client';

interface UserRow {
  user_id: string;
  name: string;
  email: string;
  role: string;
  dept: string;
}

export default function UserManagementPage() {
  const { toast, showModal, closeModal, reloadDb } = useApp();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    const { data: profiles } = await supabase.from('profiles').select('*');
    const { data: roles } = await supabase.from('user_roles').select('*');
    const roleMap: Record<string, string> = {};
    (roles || []).forEach((r: any) => { roleMap[r.user_id] = r.role; });
    const mapped = (profiles || []).map((p: any) => ({
      user_id: p.user_id,
      name: p.name,
      email: p.email || '',
      role: roleMap[p.user_id] || 'unknown',
      dept: p.dept || '',
    }));
    setUsers(mapped);
    setLoading(false);
  }, []);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  const handleDelete = async (u: UserRow) => {
    if (!confirm(`Delete user "${u.name}" (${u.email})? This cannot be undone.`)) return;
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
          <div className="form-group"><label>Department</label><input className="form-input" onChange={e => dept = e.target.value} /></div>
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

  return (
    <>
      <div className="page-header">
        <div><div className="page-title">User Management</div><div className="page-sub">{users.length} users</div></div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-outline btn-sm" onClick={handleSeedFaculty}><i className="fa-solid fa-database" /> Seed Faculty</button>
          <button className="btn btn-primary btn-sm" onClick={handleCreate}><i className="fa-solid fa-user-plus" /> Add User</button>
        </div>
      </div>
      <div className="card">
        {loading ? <div style={{ padding: 20, textAlign: 'center', color: 'var(--text2)' }}>Loading users...</div> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Department</th><th>Actions</th></tr></thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.user_id}>
                    <td className="td-name">{u.name}</td>
                    <td style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11 }}>{u.email}</td>
                    <td><span className="badge badge-pass">{u.role.toUpperCase()}</span></td>
                    <td>{u.dept || '—'}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button className="btn btn-outline btn-sm" onClick={() => handleResetPassword(u)}>Reset Pwd</button>
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
