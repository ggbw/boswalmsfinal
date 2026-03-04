import { useApp } from '@/context/AppContext';
export default function ConfigPage() {
  const { db, setDb, toast, showModal, closeModal } = useApp();
  const termRows = db.config.terms.map(t => <div key={t.id} className="info-row"><span className="info-label">{t.name} (Sem {t.semesterId})</span><span className="info-val">{t.startDate} → {t.endDate}</span></div>);
  const progRows = db.config.programmes.map(p => <div key={p.id} className="info-row"><span className="info-label">{p.name}</span><span className="info-val">{p.type} · {p.years}yr · {p.semesters}sem/yr</span></div>);
  const resetPwd = (id: string) => { setDb(prev => ({ ...prev, users: prev.users.map(u => u.id === id ? { ...u, password: 'password', changed: false } : u) })); toast('Password reset', 'success'); };
  const showAddUser = () => {
    let name='', username='', role='lecturer', dept=db.departments[0]?.id||'';
    showModal('Add User', <div>
      <div className="form-row cols2"><div className="form-group"><label>Full Name</label><input className="form-input" onChange={e=>name=e.target.value}/></div><div className="form-group"><label>Username</label><input className="form-input" onChange={e=>username=e.target.value}/></div></div>
      <div className="form-row cols2"><div className="form-group"><label>Role</label><select className="form-select" onChange={e=>role=e.target.value}><option>admin</option><option>hod</option><option>hoy</option><option>lecturer</option><option>student</option></select></div><div className="form-group"><label>Department</label><select className="form-select" onChange={e=>dept=e.target.value}>{db.departments.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></div></div>
      <button className="btn btn-primary" onClick={()=>{if(!name||!username){toast('Required','error');return;}setDb(prev=>({...prev,users:[...prev.users,{id:'u'+Date.now(),username,password:'password',role,name,changed:false,dept}]}));closeModal();toast('User created!','success');}}>Create User</button>
    </div>);
  };
  return (<>
    <div className="page-header"><div className="page-title">System Configuration</div></div>
    <div className="two-col" style={{marginBottom:16}}>
      <div className="card"><div className="card-title"><span><i className="fa-solid fa-graduation-cap"/> Programmes</span></div>{progRows}</div>
      <div className="card"><div className="card-title">🏢 Departments</div>{db.departments.map(d=><div key={d.id} className="info-row"><span className="info-label">{d.name}</span><span className="info-val">{d.hod}</span></div>)}</div>
    </div>
    <div className="two-col" style={{marginBottom:16}}>
      <div className="card"><div className="card-title"><span><i className="fa-solid fa-calendar-days"/> Terms & Semesters</span></div>{termRows}</div>
      <div className="card"><div className="card-title"><span><i className="fa-solid fa-gear"/> Academic Year Settings</span></div>
        <div className="info-row"><span className="info-label">Current Year</span><span className="info-val">{db.config.currentYear}</span></div>
        <div className="info-row"><span className="info-label">Active Semester</span><span className="info-val">Semester {db.config.currentSemester}</span></div>
        <div className="info-row"><span className="info-label">Active Term</span><span className="info-val">Term {db.config.currentTerm}</span></div>
      </div>
    </div>
    <div className="card">
      <div className="card-title"><span><i className="fa-solid fa-users-gear"/> User Management</span><button className="btn btn-primary btn-sm" onClick={showAddUser}>＋ Add User</button></div>
      <div className="table-wrap"><table><thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Password</th><th>Action</th></tr></thead>
        <tbody>{db.users.map(u=><tr key={u.id}><td className="td-name">{u.name}</td><td style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11}}>{u.username}</td><td><span className="badge badge-pass">{u.role.toUpperCase()}</span></td><td>{u.changed?<span className="badge badge-active">Changed</span>:<span className="badge badge-pending">Default</span>}</td><td><button className="btn btn-outline btn-sm" onClick={()=>resetPwd(u.id)}>Reset Pwd</button></td></tr>)}</tbody>
      </table></div>
    </div>
  </>);
}
