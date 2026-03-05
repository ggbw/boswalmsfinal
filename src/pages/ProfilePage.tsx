import { useState } from 'react';
import { useApp } from '@/context/AppContext';
import { supabase } from '@/integrations/supabase/client';

export default function ProfilePage() {
  const { currentUser, db, toast, showModal, closeModal, reloadDb } = useApp();
  const [changingPwd, setChangingPwd] = useState(false);
  const [currentPwd, setCurrentPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');

  if (!currentUser) return null;
  const u = currentUser;

  const handleChangePassword = async () => {
    if (!newPwd || newPwd.length < 6) { toast('Password must be at least 6 characters', 'error'); return; }
    if (newPwd !== confirmPwd) { toast('Passwords do not match', 'error'); return; }
    const { error } = await supabase.auth.updateUser({ password: newPwd });
    if (error) { toast(error.message, 'error'); } else {
      toast('Password changed successfully!', 'success');
      setChangingPwd(false); setCurrentPwd(''); setNewPwd(''); setConfirmPwd('');
    }
  };

  const handleEditProfile = () => {
    let name = u.name, email = u.email || '', dept = u.dept || '';
    showModal('Edit Profile', (
      <div>
        <div className="form-group"><label>Full Name</label><input className="form-input" defaultValue={name} onChange={e => name = e.target.value} /></div>
        <div className="form-group"><label>Email</label><input className="form-input" type="email" defaultValue={email} onChange={e => email = e.target.value} /></div>
        {u.role !== 'student' && <div className="form-group"><label>Department</label><input className="form-input" defaultValue={dept} onChange={e => dept = e.target.value} /></div>}
        <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={async () => {
          const { error } = await supabase.from('profiles').update({ name, email, dept }).eq('user_id', u.id);
          if (error) { toast(error.message, 'error'); } else {
            toast('Profile updated!', 'success'); closeModal(); reloadDb();
          }
        }}>Save Changes</button>
      </div>
    ));
  };

  if (u.role === 'student') {
    const stu = db.students.find(s => s.studentId === u.studentId || s.name.split(' ')[0].toLowerCase() === (u.name||'').split(' ')[0].toLowerCase());
    if (!stu) return <div className="card" style={{textAlign:'center',padding:40,color:'var(--text2)'}}>Student record not found.</div>;
    const cls = db.classes.find(c => c.id === stu.classId);
    const prog = db.config.programmes.find(p => p.id === stu.programme);

    const handleEditStudentProfile = () => {
      let mobile = stu.mobile, guardian = stu.guardian, email = stu.email || '', nationalId = stu.nationalId || '';
      showModal('Edit My Profile', (
        <div>
          <div className="form-row cols2">
            <div className="form-group"><label>Mobile</label><input className="form-input" defaultValue={mobile} onChange={e => mobile = e.target.value} /></div>
            <div className="form-group"><label>Email</label><input className="form-input" type="email" defaultValue={email} onChange={e => email = e.target.value} /></div>
          </div>
          <div className="form-row cols2">
            <div className="form-group"><label>Guardian</label><input className="form-input" defaultValue={guardian} onChange={e => guardian = e.target.value} /></div>
            <div className="form-group"><label>National ID</label><input className="form-input" defaultValue={nationalId} onChange={e => nationalId = e.target.value} /></div>
          </div>
          <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={async () => {
            const { error } = await supabase.from('students').update({ mobile, guardian, email, national_id: nationalId }).eq('id', stu.id);
            if (error) { toast(error.message, 'error'); } else {
              toast('Profile updated!', 'success'); closeModal(); reloadDb();
            }
          }}>Save Changes</button>
        </div>
      ));
    };

    return (<>
      <div className="page-header">
        <div className="page-title">My Profile</div>
        <div style={{display:'flex',gap:8}}>
          <button className="btn btn-outline btn-sm" onClick={handleEditStudentProfile}><i className="fa-solid fa-pen" /> Edit Profile</button>
          <button className="btn btn-outline btn-sm" onClick={() => setChangingPwd(!changingPwd)}><i className="fa-solid fa-key" /> Change Password</button>
        </div>
      </div>
      {changingPwd && (
        <div className="card" style={{marginBottom:16}}>
          <div className="card-title">Change Password</div>
          <div className="form-row cols2">
            <div className="form-group"><label>New Password</label><input className="form-input" type="password" value={newPwd} onChange={e => setNewPwd(e.target.value)} /></div>
            <div className="form-group"><label>Confirm Password</label><input className="form-input" type="password" value={confirmPwd} onChange={e => setConfirmPwd(e.target.value)} /></div>
          </div>
          <button className="btn btn-primary btn-sm" onClick={handleChangePassword}>Update Password</button>
        </div>
      )}
      <div className="two-col">
        <div className="card">
          <div style={{textAlign:'center',marginBottom:20}}><div style={{width:72,height:72,borderRadius:16,background:'linear-gradient(135deg,#d4920a,#f0b429)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:28,fontWeight:700,color:'#fff',margin:'0 auto 12px'}}>{stu.name[0]}</div><div style={{fontSize:18,fontWeight:700}}>{stu.name}</div><span className="badge badge-pass">STUDENT</span></div>
          <div className="info-row"><span className="info-label">Student ID</span><span className="info-val">{stu.studentId}</span></div>
          <div className="info-row"><span className="info-label">Gender</span><span className="info-val">{stu.gender}</span></div>
          <div className="info-row"><span className="info-label">DOB</span><span className="info-val">{stu.dob}</span></div>
          <div className="info-row"><span className="info-label">Mobile</span><span className="info-val">{stu.mobile||'—'}</span></div>
          <div className="info-row"><span className="info-label">Email</span><span className="info-val">{stu.email||'—'}</span></div>
          <div className="info-row"><span className="info-label">Guardian</span><span className="info-val">{stu.guardian||'—'}</span></div>
          <div className="info-row"><span className="info-label">National ID</span><span className="info-val">{stu.nationalId||'—'}</span></div>
        </div>
        <div className="card"><div className="card-title">Academic Info</div>
          <div className="info-row"><span className="info-label">Programme</span><span className="info-val">{prog?.name}</span></div>
          <div className="info-row"><span className="info-label">Class</span><span className="info-val">{cls?.name}</span></div>
          <div className="info-row"><span className="info-label">Year</span><span className="info-val">Year {stu.year}</span></div>
          <div className="info-row"><span className="info-label">Semester</span><span className="info-val">Semester {stu.semester}</span></div>
          <div className="info-row"><span className="info-label">Status</span><span className="info-val"><span className="badge badge-active">Active</span></span></div>
        </div>
      </div>
    </>);
  }

  return (<>
    <div className="page-header">
      <div className="page-title">My Profile</div>
      <div style={{display:'flex',gap:8}}>
        <button className="btn btn-outline btn-sm" onClick={handleEditProfile}><i className="fa-solid fa-pen" /> Edit Profile</button>
        <button className="btn btn-outline btn-sm" onClick={() => setChangingPwd(!changingPwd)}><i className="fa-solid fa-key" /> Change Password</button>
      </div>
    </div>
    {changingPwd && (
      <div className="card" style={{marginBottom:16}}>
        <div className="card-title">Change Password</div>
        <div className="form-row cols2">
          <div className="form-group"><label>New Password</label><input className="form-input" type="password" value={newPwd} onChange={e => setNewPwd(e.target.value)} /></div>
          <div className="form-group"><label>Confirm Password</label><input className="form-input" type="password" value={confirmPwd} onChange={e => setConfirmPwd(e.target.value)} /></div>
        </div>
        <button className="btn btn-primary btn-sm" onClick={handleChangePassword}>Update Password</button>
      </div>
    )}
    <div className="two-col">
      <div className="card">
        <div style={{textAlign:'center',marginBottom:20}}><div style={{width:72,height:72,borderRadius:16,background:'linear-gradient(135deg,#d4920a,#f0b429)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:28,fontWeight:700,color:'#fff',margin:'0 auto 12px'}}>{u.name[0]}</div><div style={{fontSize:18,fontWeight:700}}>{u.name}</div><span className="badge badge-pass">{u.role.toUpperCase()}</span></div>
        <div className="info-row"><span className="info-label">Username</span><span className="info-val">{u.username}</span></div>
        <div className="info-row"><span className="info-label">Email</span><span className="info-val">{u.email||'—'}</span></div>
        <div className="info-row"><span className="info-label">Role</span><span className="info-val">{u.role.toUpperCase()}</span></div>
        <div className="info-row"><span className="info-label">Department</span><span className="info-val">{u.dept||'—'}</span></div>
      </div>
      <div className="card"><div className="card-title">Account Settings</div>
        <div className="info-row"><span className="info-label">Password Status</span>{u.changed?<span className="badge badge-active">Changed</span>:<span className="badge badge-pending">Default</span>}</div>
        <div className="info-row"><span className="info-label">Last Login</span><span className="info-val">Today</span></div>
      </div>
    </div>
  </>);
}
