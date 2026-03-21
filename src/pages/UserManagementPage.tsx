import { useState, useEffect, useCallback } from 'react';
import { useApp } from '@/context/AppContext';
import { supabase } from '@/integrations/supabase/client';


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
  const [search, setSearch] = useState('');

  const loadUsers = useCallback(async () => {
    setLoading(true);
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
    const matchFilter = filter === 'all' || (filter === 'staff' && u.source === 'auth' && u.role !== 'student') || (filter === 'student' && u.role === 'student');
    const matchSearch = !search || u.name.toLowerCase().includes(search.toLowerCase()) || u.email.toLowerCase().includes(search.toLowerCase()) || (u.student_id || '').toLowerCase().includes(search.toLowerCase());
    return matchFilter && matchSearch;
  });

  const handleDelete = async (u: UserRow) => {
    if (!confirm(`Delete user "${u.name}" (${u.email})? This cannot be undone.`)) return;
    if (u.source === 'student') {
      const { error } = await supabase.from('students').delete().eq('id', u.user_id);
      if (error) { toast(error.message, 'error'); } else { toast('Student deleted', 'success'); loadUsers(); reloadDb(); }
      return;
    }
    const { data, error } = await supabase.functions.invoke('delete-user', { body: { user_id: u.user_id } });
    if (error || data?.error) { toast(data?.error || error?.message || 'Delete failed', 'error'); }
    else { toast('User deleted', 'success'); loadUsers(); }
  };

  const handleResetPassword = async (u: UserRow) => {
    // For students from the students table, find their auth account via profile linkage
    let targetUserId = u.user_id;
    if (u.source === 'student') {
      const { data: profile } = await supabase.from('profiles').select('user_id').eq('student_ref', u.user_id).single();
      if (!profile) { toast('This student does not have a login account yet. Provision their account first.', 'error'); return; }
      targetUserId = profile.user_id;
    }
    let newPwd = u.source === 'student' ? 'BoswaStudent2026!' : 'BoswaStaff2026!';
    showModal('Reset Password: ' + u.name, (
      <div>
        <div className="form-group">
          <label>New Password</label>
          <input className="form-input" type="text" defaultValue={newPwd} onChange={e => newPwd = e.target.value} />
        </div>
        <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={async () => {
          const { data, error } = await supabase.functions.invoke('reset-password', {
            body: { user_id: targetUserId, new_password: newPwd },
          });
          if (error || data?.error) { toast(data?.error || error?.message || 'Reset failed', 'error'); }
          else { toast('Password reset successfully', 'success'); closeModal(); }
        }}>Reset Password</button>
      </div>
    ));
  };

  const handleEditUser = async (u: UserRow) => {
    let name = u.name, email = u.email, dept = u.dept, role = u.role;
    if (u.source === 'student') {
      // Load full student record for all fields
      const { data: stu } = await supabase.from('students').select('*').eq('id', u.user_id).single();
      if (!stu) { toast('Student not found', 'error'); return; }
      let studentId = stu.student_id || '', gender = stu.gender || '', dob = stu.dob || '';
      let mobile = stu.mobile || '', email = stu.email || '', guardian = stu.guardian || '', programme = stu.programme || '';
      let classId = stu.class_id || '', nationalId = stu.national_id || '', nationality = stu.nationality || '', status = stu.status || 'active';
      let guardianMobile = stu.guardian_mobile || '', guardianEmail = stu.guardian_email || '';
      const programmes = db?.config?.programmes || [];
      const classes = db?.classes || [];
      showModal('Edit Student: ' + u.name, (
        <div>
          <div className="form-row cols2">
            <div className="form-group"><label>Full Name</label><input className="form-input" defaultValue={name} onChange={e => name = e.target.value} /></div>
            <div className="form-group"><label>Student ID</label><input className="form-input" defaultValue={studentId} onChange={e => studentId = e.target.value} /></div>
          </div>
          <div className="form-row cols2">
            <div className="form-group"><label>Email</label><input className="form-input" type="email" defaultValue={email} onChange={e => email = e.target.value} /></div>
            <div className="form-group"><label>National ID</label><input className="form-input" defaultValue={nationalId} onChange={e => nationalId = e.target.value} /></div>
          </div>
          <div className="form-row cols2">
            <div className="form-group"><label>Nationality</label><input className="form-input" defaultValue={nationality} onChange={e => nationality = e.target.value} /></div>
          </div>
          <div className="form-group"><label>Guardian Mobile</label><input className="form-input" defaultValue={guardianMobile} onChange={e => guardianMobile = e.target.value} /></div>
          <div className="form-group"><label>Guardian Email</label><input className="form-input" type="email" defaultValue={guardianEmail} onChange={e => guardianEmail = e.target.value} /></div>
          <div className="form-row cols2">
            <div className="form-group"><label>Gender</label>
              <select className="form-select" defaultValue={gender} onChange={e => gender = e.target.value}>
                <option value="">— Select —</option>
                <option value="Male">Male</option>
                <option value="Female">Female</option>
              </select>
            </div>
            <div className="form-group"><label>Date of Birth</label><input className="form-input" type="date" defaultValue={dob} onChange={e => dob = e.target.value} /></div>
          </div>
          <div className="form-row cols2">
            <div className="form-group"><label>Mobile</label><input className="form-input" defaultValue={mobile} onChange={e => mobile = e.target.value} /></div>
            <div className="form-group"><label>Guardian</label><input className="form-input" defaultValue={guardian} onChange={e => guardian = e.target.value} /></div>
          </div>
          <div className="form-row cols2">
            <div className="form-group"><label>Programme</label>
              <select className="form-select" defaultValue={programme} onChange={e => programme = e.target.value}>
                <option value="">— Select —</option>
                {programmes.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div className="form-group"><label>Class</label>
              <select className="form-select" defaultValue={classId} onChange={e => classId = e.target.value}>
                <option value="">— Select —</option>
                {classes.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          </div>
          <div className="form-row cols2">
            <div className="form-group"><label>Status</label>
              <select className="form-select" defaultValue={status} onChange={e => status = e.target.value}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="graduated">Graduated</option>
                <option value="suspended">Suspended</option>
              </select>
            </div>
          </div>
          <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={async () => {
            const { error } = await supabase.from('students').update({
              name, email, student_id: studentId, national_id: nationalId, nationality,
              gender, dob: dob || null, mobile, guardian,
              guardian_mobile: guardianMobile, guardian_email: guardianEmail,
              programme: programme || null, class_id: classId || null, status,
            }).eq('id', u.user_id);
            if (error) { toast(error.message, 'error'); } else {
              toast('Student updated!', 'success'); closeModal(); loadUsers(); reloadDb();
            }
          }}>Save Changes</button>
        </div>
      ));
    } else {
      // Load profile code
      const { data: profile } = await supabase.from('profiles').select('code').eq('user_id', u.user_id).single();
      let code = profile?.code || '';
      showModal('Edit User: ' + u.name, (
        <div>
          <div className="form-row cols2">
            <div className="form-group"><label>Full Name</label><input className="form-input" defaultValue={name} onChange={e => name = e.target.value} /></div>
            <div className="form-group"><label>Email</label><input className="form-input" type="email" defaultValue={email} onChange={e => email = e.target.value} /></div>
          </div>
          <div className="form-row cols2">
            <div className="form-group"><label>Role</label>
              <select className="form-select" defaultValue={role} onChange={e => role = e.target.value}>
                <option value="admin">Admin</option>
                <option value="hod">HOD</option>
                <option value="hoy">HOY</option>
                <option value="lecturer">Lecturer</option>
                <option value="student">Student</option>
              </select>
            </div>
            <div className="form-group"><label>Department</label>
              <select className="form-select" defaultValue={dept} onChange={e => dept = e.target.value}>
                <option value="">— Select —</option>
                {db.departments.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
              </select>
            </div>
          </div>
          <div className="form-row cols2">
            <div className="form-group"><label>Staff Code</label><input className="form-input" defaultValue={code} onChange={e => code = e.target.value} /></div>
          </div>
          <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={async () => {
            // Update profile
            const { error: profErr } = await supabase.from('profiles').update({ name, email, dept, code }).eq('user_id', u.user_id);
            if (profErr) { toast(profErr.message, 'error'); return; }
            // Update role if changed
            if (role !== u.role) {
              const { error: roleErr } = await supabase.from('user_roles').update({ role: role as any }).eq('user_id', u.user_id);
              if (roleErr) { toast(roleErr.message, 'error'); return; }
            }
            toast('User updated!', 'success'); closeModal(); loadUsers(); reloadDb();
          }}>Save Changes</button>
        </div>
      ));
    }
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
              {db.departments.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
            </select>
          </div>
        </div>
        <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={async () => {
          if (!name || !email) { toast('Name and email required', 'error'); return; }
          const { data, error } = await supabase.functions.invoke('create-user', {
            body: { email, password, name, role, dept },
          });
          if (error || data?.error) { toast(data?.error || error?.message || 'Create failed', 'error'); }
          else { toast('User created!', 'success'); closeModal(); loadUsers(); reloadDb(); }
        }}>Create User</button>
      </div>
    ));
  };

  const handleSeedFaculty = async () => {
    if (!confirm('This will create 7 faculty accounts with default password BoswaStaff2026!. Continue?')) return;
    const { data, error } = await supabase.functions.invoke('seed-faculty');
    if (error) { toast('Seed failed: ' + error.message, 'error'); }
    else {
      const results = data?.results || [];
      const created = results.filter((r: any) => r.status === 'created').length;
      const existing = results.filter((r: any) => r.status === 'already_exists').length;
      toast(`${created} created, ${existing} already existed`, 'success');
      loadUsers(); reloadDb();
    }
  };

  const handleProvisionStudents = async () => {
    if (!confirm('This will create login accounts for all students who have an email address. Default password: BoswaStudent2026!. Continue?')) return;
    const { data, error } = await supabase.functions.invoke('provision-student-accounts', {
      body: { default_password: 'BoswaStudent2026!' },
    });
    if (error) { toast('Provisioning failed: ' + error.message, 'error'); return; }
    const s = data?.summary || {};
    toast(`${s.created || 0} accounts created, ${s.existing || 0} already existed, ${s.skipped || 0} skipped (no email), ${s.errors || 0} errors`, s.errors > 0 ? 'error' : 'success');
    loadUsers(); reloadDb();
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
          <input className="search-input" placeholder="Search by name, email or ID…" value={search} onChange={e => setSearch(e.target.value)} style={{ width: 220 }} />
          <select className="form-select" value={filter} onChange={e => setFilter(e.target.value as any)} style={{ width: 'auto', fontSize: 11 }}>
            <option value="all">All Users ({users.length})</option>
            <option value="staff">Staff Only ({users.filter(u => u.source === 'auth' && u.role !== 'student').length})</option>
            <option value="student">Students Only ({users.filter(u => u.role === 'student').length})</option>
          </select>
          <button className="btn btn-outline btn-sm" onClick={handleSeedFaculty}><i className="fa-solid fa-database" /> Seed Faculty</button>
          <button className="btn btn-outline btn-sm" onClick={handleProvisionStudents}><i className="fa-solid fa-user-graduate" /> Provision Student Accounts</button>
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
                        <button className="btn btn-outline btn-sm" onClick={() => handleEditUser(u)}>Edit</button>
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
