import { useState, useEffect, useCallback } from 'react';
import { useApp } from '@/context/AppContext';
import { supabase } from '@/integrations/supabase/client';
// Temporary passwords exist only in the response that creates them — they are
// hashed on save and can never be read back, so saving them has to be easy.
import { downloadCsv } from '@/lib/csv';


/**
 * One row per PERSON, not per record.
 *
 * This list used to concatenate two queries — every profile, then every student
 * record — so a student with a login appeared TWICE: once showing their email
 * and once showing their student ID. It looked like duplicate accounts, and it
 * hid the thing that actually mattered: the two rows' Delete buttons removed
 * completely different things. The one on the ID row deleted the student RECORD,
 * taking their marks, attendance and submissions with it.
 *
 * A person may have a login, a student record, or both. Each is tracked
 * separately so an action can say exactly what it affects.
 */
interface UserRow {
  key: string;
  name: string;
  /** Sign-in address. Empty when they have no login. */
  email: string;
  role: string;
  dept: string;
  studentId?: string;
  /** auth.users.id — present only if they can sign in. */
  authUserId?: string;
  /** students.id — present only if they have a student record. */
  studentRecordId?: string;
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


/**
 * Student IDs are hand-typed in this form, and two in the live data ended up
 * with stray spaces ("BCI2024D 43", "BCI2025C- 15"). That is not cosmetic:
 * assessment_marks is keyed on this string, so a mismatched space silently
 * detaches a student from their own marks. Normalise on save.
 */
function cleanStudentId(v: string): string {
  return (v || "").trim().replace(/\s+/g, "");
}

export default function UserManagementPage() {
  const { toast, showModal, closeModal, reloadDb, db } = useApp();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'staff' | 'student'>('all');
  const [search, setSearch] = useState('');

  const loadUsers = useCallback(async () => {
    setLoading(true);
    const [{ data: profiles }, { data: roles }, { data: students }] = await Promise.all([
      supabase.from('profiles').select('*'),
      supabase.from('user_roles').select('*'),
      supabase.from('students').select('*'),
    ]);

    const roleMap: Record<string, string> = {};
    (roles || []).forEach((r: any) => { roleMap[r.user_id] = r.role; });

    // Match each student record to its login. profiles carries both links —
    // student_ref (students.id) and student_id (the number) — and older rows may
    // have only one, so try both.
    const rows: UserRow[] = [];
    const claimedProfiles = new Set<string>();

    (students || []).forEach((st: any) => {
      const profile = (profiles || []).find(
        (p: any) => (p.student_ref && p.student_ref === st.id)
                 || (p.student_id && p.student_id === st.student_id),
      );
      if (profile) claimedProfiles.add(profile.user_id);
      rows.push({
        key: 'stu:' + st.id,
        name: st.name,
        email: profile?.email || st.email || '',
        role: profile ? (roleMap[profile.user_id] || 'student') : 'student',
        dept: '',
        studentId: st.student_id,
        authUserId: profile?.user_id,
        studentRecordId: st.id,
      });
    });

    // Everyone else is a login with no student record — staff, and any account
    // whose student link is broken.
    (profiles || []).forEach((p: any) => {
      if (claimedProfiles.has(p.user_id)) return;
      rows.push({
        key: 'auth:' + p.user_id,
        name: p.name,
        email: p.email || '',
        role: roleMap[p.user_id] || 'unknown',
        dept: p.dept || '',
        studentId: p.student_id || undefined,
        authUserId: p.user_id,
      });
    });

    rows.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    setUsers(rows);
    setLoading(false);
  }, []);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  const filtered = users.filter(u => {
    const matchFilter = filter === 'all' || (filter === 'staff' && !u.studentRecordId) || (filter === 'student' && !!u.studentRecordId);
    const q = search.toLowerCase();
    const matchSearch = !search || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || (u.studentId || '').toLowerCase().includes(q);
    return matchFilter && matchSearch;
  });

  /**
   * Removing the LOGIN. The student record, and every mark, register and
   * submission attached to it, is untouched — the person simply can no longer
   * sign in.
   */
  const handleRemoveLogin = async (u: UserRow) => {
    if (!u.authUserId) return;
    if (!confirm(
      `Remove the login for "${u.name}" (${u.email})?\n\n` +
      `They will no longer be able to sign in.\n` +
      (u.studentRecordId
        ? `Their student record, marks, attendance and submissions are KEPT.`
        : `This cannot be undone.`)
    )) return;

    const { data, error } = await supabase.functions.invoke('delete-user', {
      body: { user_id: u.authUserId },
    });
    if (error || data?.error) { toast(data?.error || error?.message || 'Delete failed', 'error'); return; }
    toast('Login removed', 'success');
    loadUsers(); reloadDb();
  };

  /**
   * Removing the STUDENT RECORD. Far more destructive than removing a login:
   * marks, attendance and submissions all reference it. Kept as a separate,
   * separately-labelled action because these two used to share one "Delete"
   * button and one dialog, distinguishable only by which duplicate row you
   * happened to click.
   */
  const handleDeleteStudentRecord = async (u: UserRow) => {
    if (!u.studentRecordId) return;
    if (!confirm(
      `DELETE the student record for "${u.name}" (${u.studentId})?\n\n` +
      `This also removes their marks, attendance and submissions.\n` +
      (u.authUserId ? `Their login is removed too.\n` : '') +
      `\nThis cannot be undone. To stop someone signing in without losing their ` +
      `academic history, use "Remove login" instead.`
    )) return;

    if (u.authUserId) {
      const { data, error } = await supabase.functions.invoke('delete-user', {
        body: { user_id: u.authUserId },
      });
      if (error || data?.error) { toast(data?.error || error?.message || 'Could not remove the login', 'error'); return; }
    }
    const { error } = await supabase.from('students').delete().eq('id', u.studentRecordId);
    if (error) { toast(error.message, 'error'); return; }
    toast('Student record deleted', 'success');
    loadUsers(); reloadDb();
  };

  const handleResetPassword = async (u: UserRow) => {
    // For students from the students table, find their auth account via profile linkage
    if (!u.authUserId) {
      toast('This person has no login yet. Use Provision Student Accounts, or Add User for staff.', 'error');
      return;
    }
    const targetUserId = u.authUserId;
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
    if (u.studentRecordId) {
      // Load full student record for all fields
      const { data: stu } = await supabase.from('students').select('*').eq('id', u.studentRecordId).single();
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
              name, email, student_id: cleanStudentId(studentId), national_id: nationalId, nationality,
              gender, dob: dob || null, mobile, guardian,
              guardian_mobile: guardianMobile, guardian_email: guardianEmail,
              programme: programme || null, class_id: classId || null, status,
            }).eq('id', u.studentRecordId);
            if (error) { toast(error.message, 'error'); } else {
              toast('Student updated!', 'success'); closeModal(); loadUsers(); reloadDb();
            }
          }}>Save Changes</button>
        </div>
      ));
    } else {
      // Load profile code
      const { data: profile } = await supabase.from('profiles').select('code').eq('user_id', u.authUserId).single();
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
                <option value="principal">Principal</option>
                <option value="deputy_principal">Deputy Principal</option>
                <option value="hod">HOD</option>
                <option value="hoa">HOA - Head of Academics</option>
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
            const { error: profErr } = await supabase.from('profiles').update({ name, email, dept, code }).eq('user_id', u.authUserId);
            if (profErr) { toast(profErr.message, 'error'); return; }
            // Update role if a row exists, otherwise insert (user_roles has no single-column unique on user_id)
            const { data: existingRole } = await supabase.from('user_roles').select('id').eq('user_id', u.authUserId).single();
            const { error: roleErr } = existingRole
              ? await supabase.from('user_roles').update({ role: role as any }).eq('user_id', u.authUserId)
              : await supabase.from('user_roles').insert({ user_id: u.authUserId, role: role as any });
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
              <option value="principal">Principal</option>
              <option value="deputy_principal">Deputy Principal</option>
              <option value="hod">HOD</option>
              <option value="hoa">HOA - Head of Academics</option>
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

  const roleLabel = (role: string) =>
    ({ hoa: 'HOA', principal: 'PRINCIPAL', deputy_principal: 'DEPUTY PRINCIPAL' } as Record<string, string>)[role]
    || role.toUpperCase();
  const roleBadgeClass = (role: string) => {
    if (role === 'admin') return 'badge-fail';
    if (role === 'principal' || role === 'deputy_principal') return 'badge-fail';
    if (role === 'hod' || role === 'hoa') return 'badge-pass';
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
            <option value="staff">Staff Only ({users.filter(u => !u.studentRecordId).length})</option>
            <option value="student">Students Only ({users.filter(u => !!u.studentRecordId).length})</option>
          </select>
          <button className="btn btn-outline btn-sm" onClick={handleForcePasswordChange}><i className="fa-solid fa-key" /> Require Password Change</button>
          <button className="btn btn-outline btn-sm" onClick={handleProvisionStudents}><i className="fa-solid fa-user-graduate" /> Provision Student Accounts</button>
          <button className="btn btn-primary btn-sm" onClick={handleCreate}><i className="fa-solid fa-user-plus" /> Add User</button>
        </div>
      </div>
      <div className="card">
        {loading ? <div style={{ padding: 20, textAlign: 'center', color: 'var(--text2)' }}>Loading users...</div> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Name</th><th>Student ID</th><th>Signs in with</th><th>Role</th><th>Department</th><th>Actions</th></tr></thead>
              <tbody>
                {filtered.map(u => (
                  <tr key={u.key}>
                    <td className="td-name">{u.name}</td>
                    <td style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11 }}>
                      {u.studentId || <span style={{ color: 'var(--text3)' }}>—</span>}
                    </td>
                    <td style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11 }}>
                      {u.authUserId
                        ? u.email || <span style={{ color: 'var(--text3)' }}>(no email on file)</span>
                        /* Previously indistinguishable from any other row. Now the
                           six students who cannot sign in are visible at a glance. */
                        : <span style={{ color: '#9a6700' }}>
                            <i className="fa-solid fa-triangle-exclamation" style={{ marginRight: 5 }} />
                            No login
                          </span>}
                    </td>
                    <td><span className={`badge ${roleBadgeClass(u.role)}`}>{roleLabel(u.role)}</span></td>
                    <td>{u.dept || '—'}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        <button className="btn btn-outline btn-sm" onClick={() => handleEditUser(u)}>Edit</button>
                        <button
                          className="btn btn-outline btn-sm"
                          onClick={() => handleResetPassword(u)}
                          disabled={!u.authUserId}
                          title={u.authUserId ? 'Set a new temporary password' : 'This person has no login yet'}
                        >
                          Reset Pwd
                        </button>
                        {u.authUserId && (
                          <button
                            className="btn btn-outline btn-sm"
                            onClick={() => handleRemoveLogin(u)}
                            style={{ color: '#bf8700' }}
                            title="Stops them signing in. Keeps their student record, marks and attendance."
                          >
                            Remove login
                          </button>
                        )}
                        {u.studentRecordId && (
                          <button
                            className="btn btn-outline btn-sm"
                            onClick={() => handleDeleteStudentRecord(u)}
                            style={{ color: '#f85149' }}
                            title="Deletes the student and their marks, attendance and submissions."
                          >
                            Delete student
                          </button>
                        )}
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
