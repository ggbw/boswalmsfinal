import { useApp } from '@/context/AppContext';
export default function ProfilePage() {
  const { currentUser, db } = useApp();
  if (!currentUser) return null;
  const u = currentUser;
  if (u.role === 'student') {
    const stu = db.students.find(s => s.studentId === u.studentId || s.name.split(' ')[0].toLowerCase() === (u.name||'').split(' ')[0].toLowerCase());
    if (!stu) return <div className="card" style={{textAlign:'center',padding:40,color:'var(--text2)'}}>Student record not found.</div>;
    const cls = db.classes.find(c => c.id === stu.classId);
    const prog = db.config.programmes.find(p => p.id === stu.programme);
    return (<>
      <div className="page-header"><div className="page-title">My Profile</div></div>
      <div className="two-col">
        <div className="card">
          <div style={{textAlign:'center',marginBottom:20}}><div style={{width:72,height:72,borderRadius:16,background:'linear-gradient(135deg,#d4920a,#f0b429)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:28,fontWeight:700,color:'#fff',margin:'0 auto 12px'}}>{stu.name[0]}</div><div style={{fontSize:18,fontWeight:700}}>{stu.name}</div><span className="badge badge-pass">STUDENT</span></div>
          <div className="info-row"><span className="info-label">Student ID</span><span className="info-val">{stu.studentId}</span></div>
          <div className="info-row"><span className="info-label">Gender</span><span className="info-val">{stu.gender}</span></div>
          <div className="info-row"><span className="info-label">DOB</span><span className="info-val">{stu.dob}</span></div>
          <div className="info-row"><span className="info-label">Mobile</span><span className="info-val">{stu.mobile||'—'}</span></div>
          <div className="info-row"><span className="info-label">Guardian</span><span className="info-val">{stu.guardian||'—'}</span></div>
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
    <div className="page-header"><div className="page-title">My Profile</div></div>
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
