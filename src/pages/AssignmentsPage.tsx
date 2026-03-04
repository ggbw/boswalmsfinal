import { useApp } from '@/context/AppContext';
export default function AssignmentsPage() {
  const { db, currentUser } = useApp();
  let assignments = db.assignments;
  const role = currentUser?.role;
  if (role === 'lecturer') {
    const lec = db.users.find(u => u.id === currentUser?.id);
    if (lec) { const lc = db.classes.filter(c => c.lecturer === lec.name).map(c => c.id); assignments = assignments.filter(a => lc.includes(a.classId)); }
  }
  return (<>
    <div className="page-header"><div><div className="page-title"><i className="fa-solid fa-list-check" style={{color:'var(--accent)',marginRight:8}}/>Assignments</div><div className="page-sub">{assignments.length} assignment(s)</div></div></div>
    <div className="card"><div className="table-wrap"><table><thead><tr><th>Title</th><th>Module</th><th>Class</th><th>Due Date</th><th style={{textAlign:'center'}}>Marks</th><th>Status</th></tr></thead>
      <tbody>{assignments.map(a=>{const mod=db.modules.find(m=>m.id===a.moduleId);const cls=db.classes.find(c=>c.id===a.classId);return<tr key={a.id}><td className="td-name">{a.title}</td><td>{mod?.name}</td><td>{cls?.name}</td><td style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11}}>{a.dueDate}</td><td style={{fontFamily:"'JetBrains Mono',monospace",textAlign:'center'}}>{a.marks}</td><td><span className={`badge ${a.status==='graded'?'badge-credit':a.status==='active'?'badge-pass':'badge-inactive'}`}>{a.status}</span></td></tr>;})}</tbody>
    </table></div></div>
  </>);
}
