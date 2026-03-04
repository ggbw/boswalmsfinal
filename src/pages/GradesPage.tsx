import { useApp } from '@/context/AppContext';
import { calcModuleMark, grade, gradeColor } from '@/data/db';
export default function GradesPage() {
  const { db } = useApp();
  return (<>
    <div className="page-header"><div className="page-title">Student Grades Overview</div></div>
    <div className="card"><div className="table-wrap"><table><thead><tr><th>Student</th><th>Class</th><th>Avg Mark</th><th>Overall Grade</th><th>Year</th></tr></thead>
      <tbody>{db.students.map(s=>{const cls=db.classes.find(c=>c.id===s.classId);const sMarks=db.marks.filter(m=>m.studentId===s.studentId);let avgMark='—',g='—';if(sMarks.length){const avg=Math.round(sMarks.reduce((a,m)=>a+calcModuleMark(m),0)/sMarks.length);avgMark=avg+'%';g=grade(avg);}return<tr key={s.id}><td className="td-name">{s.name}</td><td>{cls?.name}</td><td style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:700}}>{avgMark}</td><td>{g!=='—'?<span className={`badge ${gradeColor(g)}`}>{g}</span>:g}</td><td>Year {s.year}</td></tr>;})}</tbody>
    </table></div></div>
  </>);
}
