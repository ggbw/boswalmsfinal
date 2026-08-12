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

// Unique single-use temporary password, matching the generator in the
// create-user / provision-student-accounts edge functions. Ambiguous characters
// (0/O, 1/l/I) are excluded so it can be read off a printout and typed.
const PWD_ALPHABET =
  'ABCDEFGHJKLMNPQRSTUVWXYZ' + 'abcdefghijkmnpqrstuvwxyz' + '23456789'; // 56 chars
function generatePassword(groups = 3, size = 4): string {
  const limit = 256 - (256 % PWD_ALPHABET.length); // reject above this to avoid modulo bias
  const chars: string[] = [];
  const buf = new Uint8Array(1);
  while (chars.length < groups * size) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) chars.push(PWD_ALPHABET[buf[0] % PWD_ALPHABET.length]);
  }
  return Array.from({ length: groups }, (_, g) =>
    chars.slice(g * size, (g + 1) * size).join(''),
  ).join('-');
}

// Temporary passwords only exist in this response — they are hashed on the way
// into the database and can never be read back. If the admin loses them the
// only remedy is another reset, so make saving them easy.
function downloadCsv(filename: string, rows: string[][]) {
  const esc = (v: string) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = rows.map(r => r.map(esc).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
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
    const { error: roleErr } = await supabase.from('user_roles').delete().eq('user_id', u.user_id);
    const { error: profErr } = await supabase.from('profiles').delete().eq('user_id', u.user_id);
    if (roleErr || profErr) { toast(roleErr?.message || profErr?.message || 'Delete failed', 'error'); }
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
    let newPwd = generatePassword();
    showModal('Reset Password: ' + u.name, (
      <div>
        <div className="form-group">
          <label>New Password</label>
          <input className="form-input" type="text" defaultValue={newPwd} onChange={e => newPwd = e.target.value} />
          <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 4 }}>
            Freshly generated and unique to this reset. Copy it before you close this box — it cannot be read back afterwards.
          </div>
        </div>
        <div style={{ background: 'var(--bg2)', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: 'var(--text2)' }}>
          <i className="fa-solid fa-shield-halved" style={{ marginRight: 6 }} />
          {u.name} will be required to choose their own password the next time they sign in.
        </div>
        <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={async () => {
          const { data, error } = await supabase.functions.invoke('reset-password', {
            body: { user_id: targetUserId, new_password: newPwd, must_change_password: true },
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
                <option value="hoy">HOA - Head of Academics</option>
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
            // Update role if a row exists, otherwise insert (user_roles has no single-column unique on user_id)
            const { data: existingRole } = await supabase.from('user_roles').select('id').eq('user_id', u.user_id).single();
            const { error: roleErr } = existingRole
              ? await supabase.from('user_roles').update({ role: role as any }).eq('user_id', u.user_id)
              : await supabase.from('user_roles').insert({ user_id: u.user_id, role: role as any });
            if (roleErr) { toast(roleErr.message, 'error'); return; }
            toast('User updated!', 'success'); closeModal(); loadUsers(); reloadDb();
          }}>Save Changes</button>
        </div>
      ));
    }
  };

  const handleCreate = () => {
    let name = '', email = '', password = generatePassword(), role = 'lecturer', dept = '';
    showModal('Create New User', (
      <div>
        <div className="form-row cols2">
          <div className="form-group"><label>Full Name *</label><input className="form-input" onChange={e => name = e.target.value} /></div>
          <div className="form-group"><label>Email *</label><input className="form-input" type="email" onChange={e => email = e.target.value} /></div>
        </div>
        <div className="form-row cols2">
          <div className="form-group">
            <label>Temporary Password</label>
            <input className="form-input" type="text" defaultValue={password} onChange={e => password = e.target.value} />
            <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 4 }}>
              Unique to this account. Copy it now — it cannot be read back later.
            </div>
          </div>
          <div className="form-group"><label>Role</label>
            <select className="form-select" defaultValue={role} onChange={e => role = e.target.value}>
              <option value="admin">Admin</option>
              <option value="hod">HOD</option>
              <option value="hoy">HOA - Head of Academics</option>
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
          // When the function returns non-2xx, supabase-js gives a generic
          // "non-2xx status code" message and puts the real JSON body on
          // error.context (a Response). Surface that so the actual reason shows.
          let errMsg = '';
          if (error) {
            errMsg = error.message || 'Create failed';
            try { const b = await (error as any).context?.json?.(); if (b?.error) errMsg = b.error; } catch { /* keep generic */ }
          } else if (data?.error) {
            errMsg = data.error;
          }
          if (errMsg) { toast(errMsg, 'error'); return; }
          loadUsers(); reloadDb();
          // Show the credential rather than just a toast: this is the only
          // moment the temporary password is readable.
          if (data?.password_applied === false) {
            toast('That email already had an account — profile and role updated, password left unchanged.', 'info');
            closeModal();
            return;
          }
          showModal('Account created — hand these over', (
            <div>
              <div style={{ background: 'var(--bg2)', borderRadius: 8, padding: '12px 14px', marginBottom: 12 }}>
                <div className="info-row"><span className="info-label">Name</span><span className="info-val">{name}</span></div>
                <div className="info-row"><span className="info-label">Sign in with</span><span className="info-val">{email}</span></div>
                <div className="info-row">
                  <span className="info-label">Temporary password</span>
                  <span className="info-val" style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 15, letterSpacing: 0.5 }}>
                    {data?.temp_password || password}
                  </span>
                </div>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.6 }}>
                Copy this now — the password is hashed on save and cannot be read back.
                {name} will be asked to choose their own password the first time they sign in.
              </div>
              <button className="btn btn-primary" style={{ marginTop: 14, width: '100%' }} onClick={closeModal}>Done</button>
            </div>
          ));
        }}>Create User</button>
      </div>
    ));
  };

  const handleSeedFaculty = async () => {
    if (!confirm('Create the 7 built-in faculty accounts?\n\nEach gets its own unique temporary password, which you\'ll be shown afterwards. Existing accounts are left alone.')) return;
    const { data, error } = await supabase.functions.invoke('seed-faculty');
    if (error || data?.error) { toast('Seed failed: ' + (data?.error || error?.message), 'error'); return; }
    loadUsers(); reloadDb();

    const results: Array<{ email: string; name?: string; status: string; temp_password?: string; message?: string }> = data?.results || [];
    const created = results.filter(r => r.status === 'created');
    const existing = results.filter(r => r.status === 'already_exists').length;

    if (created.length === 0) { toast(`No new accounts — ${existing} already existed.`, 'info'); return; }

    showModal(`${created.length} faculty account(s) created — save the passwords now`, (
      <div>
        <div style={{ background: 'var(--bg2)', borderLeft: '3px solid var(--accent)', borderRadius: 6, padding: '10px 14px', marginBottom: 12, fontSize: 12, color: 'var(--text2)', lineHeight: 1.6 }}>
          These temporary passwords cannot be retrieved again. Each person will be required to set their own at first sign-in.
        </div>
        <button
          className="btn btn-primary"
          style={{ width: '100%', marginBottom: 12 }}
          onClick={() => downloadCsv(
            `boswa-faculty-logins-${new Date().toISOString().split('T')[0]}.csv`,
            [['Name', 'Sign in with', 'Temporary password'],
             ...created.map(r => [r.name || '', r.email, r.temp_password || ''])],
          )}
        >
          <i className="fa-solid fa-download" style={{ marginRight: 6 }} /> Download as CSV
        </button>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Sign in with</th><th>Temporary password</th></tr></thead>
            <tbody>
              {created.map(r => (
                <tr key={r.email}>
                  <td className="td-name">{r.name}</td>
                  <td style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11 }}>{r.email}</td>
                  <td style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12 }}>{r.temp_password}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text2)' }}>{existing} already existed and were skipped.</div>
      </div>
    ), 'large');
  };

  const handleProvisionStudents = async () => {
    if (!confirm('Create login accounts for students who don\'t have one yet?\n\nEach account gets its own unique temporary password, and you\'ll be shown the full list to download afterwards. Existing accounts are left alone.')) return;
    const { data, error } = await supabase.functions.invoke('provision-student-accounts', { body: {} });
    if (error) { toast('Provisioning failed: ' + error.message, 'error'); return; }
    loadUsers(); reloadDb();

    const results: Array<{ student_id: string; name: string; email: string; status: string; temp_password?: string; error?: string }> =
      data?.results || [];
    const created = results.filter(r => r.status === 'created');
    const errored = results.filter(r => r.status === 'error');
    const s = data?.summary || {};

    if (created.length === 0) {
      toast(`No new accounts. ${s.existing || 0} already existed, ${s.errors || 0} errors.`, errored.length ? 'error' : 'info');
      return;
    }

    // The passwords in this list exist nowhere else — they're hashed on save.
    // Offer the download before anything can navigate away from the modal.
    showModal(`${created.length} account(s) created — save the passwords now`, (
      <div>
        <div style={{ background: 'var(--bg2)', borderLeft: '3px solid var(--accent)', borderRadius: 6, padding: '10px 14px', marginBottom: 12, fontSize: 12, color: 'var(--text2)', lineHeight: 1.6 }}>
          These temporary passwords cannot be retrieved again. Download the list, distribute it, then delete the file.
          Every student will be required to set their own password the first time they sign in.
        </div>
        <button
          className="btn btn-primary"
          style={{ width: '100%', marginBottom: 12 }}
          onClick={() => downloadCsv(
            `boswa-student-logins-${new Date().toISOString().split('T')[0]}.csv`,
            [['Student ID', 'Name', 'Sign in with', 'Temporary password'],
             ...created.map(r => [r.student_id, r.name, r.email, r.temp_password || ''])],
          )}
        >
          <i className="fa-solid fa-download" style={{ marginRight: 6 }} /> Download {created.length} login(s) as CSV
        </button>
        <div className="table-wrap" style={{ maxHeight: 300, overflowY: 'auto' }}>
          <table>
            <thead><tr><th>Student</th><th>Sign in with</th><th>Temporary password</th></tr></thead>
            <tbody>
              {created.map(r => (
                <tr key={r.student_id}>
                  <td className="td-name">{r.name}</td>
                  <td style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11 }}>{r.email}</td>
                  <td style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12 }}>{r.temp_password}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {errored.length > 0 && (
          <div style={{ marginTop: 12, fontSize: 12, color: 'var(--danger)' }}>
            {errored.length} account(s) failed:
            <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
              {errored.map(r => <li key={r.student_id}>{r.name} — {r.error}</li>)}
            </ul>
          </div>
        )}
        <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text2)' }}>
          {s.existing || 0} already had an account and were skipped.
        </div>
      </div>
    ), 'large');
  };

  // Requires a group of users to choose a new password at their next sign-in.
  // Admins and super_admins are always excluded by the edge function, so this
  // cannot lock every administrator out at once.
  const handleForcePasswordChange = () => {
    let scope = 'all_except_admins';
    const SCOPE_LABELS: Record<string, string> = {
      all_except_admins: 'Everyone except admins and super admins',
      students: 'Students only',
      staff: 'Staff only (lecturers, HODs, HOA, HR)',
    };
    showModal('Require a password change', (
      <div>
        <div style={{ background: 'var(--bg2)', borderLeft: '3px solid var(--accent)', borderRadius: 6, padding: '10px 14px', marginBottom: 14, fontSize: 12, color: 'var(--text2)', lineHeight: 1.6 }}>
          Everyone in the chosen group will be shown a blocking screen at their next sign-in and must set a new password before they can continue.
          Their current password keeps working until they do. Admin and super admin accounts are never included.
          <br /><br />
          <strong>Tell people before you run this</strong> — it will look like a lockout to anyone not expecting it.
        </div>
        <div className="form-group">
          <label>Who</label>
          <select className="form-select" defaultValue={scope} onChange={e => scope = e.target.value}>
            {Object.entries(SCOPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-outline" style={{ flex: 1 }} onClick={async () => {
            const { data, error } = await supabase.functions.invoke('force-password-change', {
              body: { scope, dry_run: true },
            });
            if (error || data?.error) { toast(data?.error || error?.message || 'Check failed', 'error'); return; }
            toast(`${data.would_update} account(s) would be asked to change their password.`, 'info');
          }}>Preview count</button>
          <button className="btn btn-primary" style={{ flex: 1 }} onClick={async () => {
            if (!confirm(`Require a password change for: ${SCOPE_LABELS[scope]}?\n\nThey will be prompted at their next sign-in.`)) return;
            const { data, error } = await supabase.functions.invoke('force-password-change', {
              body: { scope },
            });
            if (error || data?.error) { toast(data?.error || error?.message || 'Failed', 'error'); return; }
            toast(`${data.updated} account(s) will be asked to set a new password at next sign-in.`, 'success');
            closeModal();
          }}>Apply</button>
        </div>
      </div>
    ));
  };

  const roleLabel = (role: string) => ({ hoy: 'HOA' } as Record<string, string>)[role] || role.toUpperCase();
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
          <button className="btn btn-outline btn-sm" onClick={handleForcePasswordChange}><i className="fa-solid fa-key" /> Require Password Change</button>
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
                    <td><span className={`badge ${roleBadgeClass(u.role)}`}>{roleLabel(u.role)}</span></td>
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
