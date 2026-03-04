import { useApp } from '@/context/AppContext';
export default function MyStudentsPage() {
  const { db, currentUser } = useApp();
  const role = currentUser?.role;
  if (role === 'student') {
    const stu = db.students.find(s => s.name.split(' ')[0].toLowerCase() === (currentUser?.name||'').split(' ')[0].toLowerCase());
    if (!stu) return <div className="card" style={{textAlign:'center',padding:40,color:'var(--text2)'}}>No timetable found</div>;
    const slots = db.timetable.filter(t => t.classId === stu.classId);
    const days = ['Monday','Tuesday','Wednesday','Thursday','Friday'];
    return (<>
      <div className="page-header"><div className="page-title">My Timetable</div></div>
      <div className="card"><div className="table-wrap"><table><thead><tr><th>Day</th><th>Time</th><th>Module</th><th>Room</th></tr></thead>
        <tbody>{days.map(day=>{const s=slots.filter(t=>t.day===day);return s.map((t,i)=>{const mod=db.modules.find(m=>m.id===t.moduleId);return<tr key={t.id}><td>{i===0?day:''}</td><td style={{fontFamily:"'JetBrains Mono',monospace"}}>{t.time}</td><td>{mod?.name}</td><td>{t.room}</td></tr>;});})}</tbody>
      </table></div></div>
    </>);
  }
  const lec = db.users.find(u => u.id === currentUser?.id);
  const lecClasses = lec ? db.classes.filter(c => c.lecturer === lec.name) : [];
  const students = db.students.filter(s => lecClasses.map(c => c.id).includes(s.classId));
  return (<>
    <div className="page-header"><div className="page-title">My Students</div></div>
    <div className="card"><div className="table-wrap"><table><thead><tr><th>Name</th><th>Student ID</th><th>Class</th></tr></thead>
      <tbody>{students.map(s=>{const cls=db.classes.find(c=>c.id===s.classId);return<tr key={s.id}><td className="td-name">{s.name}</td><td style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11}}>{s.studentId}</td><td>{cls?.name}</td></tr>;})}</tbody>
    </table></div></div>
  </>);
}
