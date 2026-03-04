import { useApp } from '@/context/AppContext';
export default function LecturersPage() {
  const { db } = useApp();
  const lecturers = db.users.filter(u => u.role === 'lecturer' || u.role === 'hod' || u.role === 'hoy');
  return (<>
    <div className="page-header"><div className="page-title">Faculty / Lecturers</div></div>
    <div className="card"><div className="table-wrap"><table><thead><tr><th>Name</th><th>Role</th><th>Department</th><th>Username</th><th>Status</th></tr></thead>
      <tbody>{lecturers.map(l => {
        const dept = db.departments.find(d => d.id === l.dept);
        return <tr key={l.id}><td className="td-name"><div style={{display:'flex',alignItems:'center',gap:8}}><div className="avatar" style={{background:'#c8860a',width:28,height:28,fontSize:11}}>{l.name[0]}</div>{l.name}</div></td><td>{l.role.toUpperCase()}</td><td>{dept?.name || l.dept}</td><td style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11}}>{l.username}</td><td><span className="badge badge-active">Active</span></td></tr>;
      })}</tbody></table></div></div>
  </>);
}
