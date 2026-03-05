import { useApp } from '@/context/AppContext';

export default function MyStudentsPage() {
  const { db, currentUser } = useApp();
  const role = currentUser?.role;

  if (role === 'student') {
    const stu = db.students.find(s => s.studentId === currentUser?.studentId || s.name.split(' ')[0].toLowerCase() === (currentUser?.name||'').split(' ')[0].toLowerCase());
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

  // Lecturer: only show students enrolled in modules assigned to their classes
  const lecClasses = db.classes.filter(c => c.lecturer === currentUser?.name);
  const lecClassIds = lecClasses.map(c => c.id);
  const lecModuleIds = db.modules.filter(m => m.classes.some(cid => lecClassIds.includes(cid))).map(m => m.id);

  // Students in lecturer's classes
  const students = db.students.filter(s => lecClassIds.includes(s.classId));

  return (<>
    <div className="page-header"><div className="page-title">My Students</div><div className="page-sub">{students.length} student(s) across {lecClasses.length} class(es)</div></div>
    <div className="card"><div className="table-wrap"><table><thead><tr><th>Name</th><th>Student ID</th><th>Class</th><th>Programme</th></tr></thead>
      <tbody>{students.map(s=>{const cls=db.classes.find(c=>c.id===s.classId);const prog=db.config.programmes.find(p=>p.id===s.programme);return<tr key={s.id}><td className="td-name">{s.name}</td><td style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11}}>{s.studentId}</td><td>{cls?.name}</td><td>{prog?.type} Yr{s.year}</td></tr>;})}</tbody>
    </table></div></div>
  </>);
}
