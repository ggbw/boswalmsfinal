import { useApp } from '@/context/AppContext';
export default function ExamsPage() {
  const { db, currentUser } = useApp();
  const role = currentUser?.role;
  let exams = db.exams;
  if (role === 'lecturer') {
    const lec = db.users.find(u => u.id === currentUser?.id);
    if (lec) { const lc = db.classes.filter(c => c.lecturer === lec.name).map(c => c.id); exams = exams.filter(e => lc.includes(e.classId)); }
  }
  return (<>
    <div className="page-header"><div><div className="page-title"><i className="fa-solid fa-file-pen" style={{color:'var(--accent)',marginRight:8}}/>Examinations</div><div className="page-sub">{exams.length} exam(s)</div></div></div>
    <div className="card"><div className="table-wrap"><table><thead><tr><th>Exam Name</th><th>Module</th><th>Class</th><th>Date</th><th>Status</th></tr></thead>
      <tbody>{exams.map(e=>{const mod=db.modules.find(m=>m.id===e.moduleId);const cls=db.classes.find(c=>c.id===e.classId);return<tr key={e.id}><td className="td-name">{e.name}<div style={{fontSize:10,color:'var(--text3)',marginTop:2}}>{e.type||'Written Exam'}</div></td><td>{mod?.name}</td><td>{cls?.name}</td><td style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11}}>{e.date}</td><td><span className={`badge ${e.status==='done'?'badge-credit':e.status==='confirmed'?'badge-pass':'badge-pending'}`}>{e.status}</span></td></tr>;})}</tbody>
    </table></div></div>
  </>);
}
