import { useApp } from '@/context/AppContext';
import { calcModuleMark, grade, gradeColor } from '@/data/db';
export default function ResultsPage() {
  const { db, currentUser } = useApp();
  const role = currentUser?.role;
  if (role === 'student') {
    const stu = db.students.find(s => s.studentId === currentUser?.studentId || s.name.split(' ')[0].toLowerCase() === (currentUser?.name||'').split(' ')[0].toLowerCase());
    if (!stu) return <div className="card" style={{textAlign:'center',padding:40}}>Student record not found.</div>;
    const myMarks = db.marks.filter(m => m.studentId === stu.studentId);
    return (<>
      <div className="page-header"><div className="page-title">My Results</div></div>
      <div className="card"><div className="table-wrap"><table><thead><tr><th>Module</th><th style={{textAlign:'center'}}>CW 40%</th><th style={{textAlign:'center'}}>Prac 20%</th><th style={{textAlign:'center'}}>Exam 40%</th><th style={{textAlign:'center'}}>Total</th><th>Grade</th></tr></thead>
        <tbody>{myMarks.map(m=>{const mod=db.modules.find(mo=>mo.id===m.moduleId);const cw=Math.round(((m.test1+m.test2+m.practTest+m.indAss+m.grpAss)/5)*0.4);const pe=Math.round(m.practical*0.2);const fe=Math.round(m.finalExam*0.4);const mm=cw+pe+fe;const g=grade(mm);return<tr key={m.moduleId}><td className="td-name">{mod?.name}</td><td style={{fontFamily:"'JetBrains Mono',monospace",textAlign:'center'}}>{cw}%</td><td style={{fontFamily:"'JetBrains Mono',monospace",textAlign:'center'}}>{pe}%</td><td style={{fontFamily:"'JetBrains Mono',monospace",textAlign:'center'}}>{fe}%</td><td style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:700,textAlign:'center'}}>{mm}%</td><td><span className={`badge ${gradeColor(g)}`}>{g}</span></td></tr>;})}</tbody>
      </table></div></div>
    </>);
  }
  const marks = db.marks;
  return (<>
    <div className="page-header"><div className="page-title">Exam Results</div></div>
    <div className="card"><div className="table-wrap"><table><thead><tr><th>Student</th><th>ID</th><th>Module</th><th>Mark</th><th>Grade</th></tr></thead>
      <tbody>{marks.map((m,i)=>{const stu=db.students.find(s=>s.studentId===m.studentId);const mod=db.modules.find(mo=>mo.id===m.moduleId);const mm=calcModuleMark(m);const g=grade(mm);return<tr key={i}><td className="td-name">{stu?.name||m.studentId}</td><td style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11}}>{m.studentId}</td><td>{mod?.name}</td><td style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:700}}>{mm}%</td><td><span className={`badge ${gradeColor(g)}`}>{g}</span></td></tr>;})}</tbody>
    </table></div></div>
  </>);
}
