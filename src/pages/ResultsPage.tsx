import { useApp } from '@/context/AppContext';
import { calcModuleMark, grade, gradeColor, type DB, type Student } from '@/data/db';
import { getLecturerClassIds } from '@/lib/lecturerHelpers';
import { useAssessmentMarks } from '@/hooks/useAssessmentMarks';
import { studentModuleResults } from '@/lib/studentMarks';

/**
 * A student's own results, read from `assessment_marks`.
 *
 * This used to read `db.marks`, filtering by the student number against rows
 * keyed by `students.id` — so it matched nothing and every student saw "No
 * results available yet" regardless of what they had been awarded. Split into
 * its own component so the data hook isn't called behind a conditional.
 */
function StudentResults({ stu, db }: { stu: Student; db: DB }) {
  const { scoreOf, loading, error } = useAssessmentMarks({ studentNumbers: [stu.studentId] });
  const results = loading ? [] : studentModuleResults(db, stu, scoreOf);
  const marked = results.filter(r => !r.unmarked);

  return (<>
    <div className="page-header"><div className="page-title">My Results</div></div>
    {error && (
      <div className="card" style={{ padding: 16, color: '#cf222e', fontSize: 13 }}>
        <i className="fa-solid fa-triangle-exclamation" style={{ marginRight: 8 }} />
        Your results could not be loaded: {error}
      </div>
    )}
    {loading
      ? <div className="card" style={{textAlign:'center',padding:40,color:'var(--text2)'}}>Loading your results…</div>
      : marked.length === 0
        ? <div className="card" style={{textAlign:'center',padding:40,color:'var(--text2)'}}>No results available yet. Results will appear here once your lecturer has entered marks.</div>
        : <div className="card"><div className="table-wrap"><table>
            <thead><tr><th>Module</th><th style={{textAlign:'center'}}>Coursework</th><th style={{textAlign:'center'}}>Practical</th><th style={{textAlign:'center'}}>Final Exam</th><th style={{textAlign:'center'}}>Total</th><th>Grade</th></tr></thead>
            <tbody>{marked.map(({ module, mark }) => {
              const g = grade(mark.moduleMark);
              const pct = (v: number | null) => v === null ? '—' : `${Math.round(v)}%`;
              return (
                <tr key={module.id}>
                  <td className="td-name">{module.name}</td>
                  <td style={{fontFamily:"'JetBrains Mono',monospace",textAlign:'center'}}>{pct(mark.theory40)}</td>
                  <td style={{fontFamily:"'JetBrains Mono',monospace",textAlign:'center'}}>{pct(mark.prac20)}</td>
                  <td style={{fontFamily:"'JetBrains Mono',monospace",textAlign:'center'}}>{pct(mark.final40)}</td>
                  <td style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:700,textAlign:'center'}}>{mark.moduleMark}%</td>
                  <td><span className={`badge ${gradeColor(g)}`}>{g}</span></td>
                </tr>
              );
            })}</tbody>
          </table></div></div>}
  </>);
}

export default function ResultsPage() {
  const { db, currentUser } = useApp();
  const role = currentUser?.role;

  if (role === 'student') {
    const stu = db.students.find(s => s.studentId === currentUser?.studentId);
    if (!stu) return <div className="card" style={{textAlign:'center',padding:40}}>Student record not found. Please contact admin.</div>;
    return <StudentResults stu={stu} db={db} />;
  }

  if (!['admin','hod','hoa','lecturer'].includes(role || '')) {
    return <div className="card" style={{textAlign:'center',padding:40,color:'var(--text2)'}}>Access restricted. Please contact your administrator if you believe this is an error.</div>;
  }

  // Lecturer: only see marks for modules in their classes
  let marks = db.marks;
  if (role === 'lecturer') {
    const lecClasses = getLecturerClassIds(db.lecturerModules, currentUser?.id || '');
    const lecModuleIds = db.lecturerModules
      .filter(lm => lm.lecturerId === (currentUser?.id || ''))
      .map(lm => lm.moduleId);
    marks = marks.filter(m => lecModuleIds.includes(m.moduleId) && lecClasses.includes(m.classId));
  }

  return (<>
    <div className="page-header"><div className="page-title">Exam Results</div></div>
    <div className="card"><div className="table-wrap"><table><thead><tr><th>Student</th><th>ID</th><th>Module</th><th>Mark</th><th>Grade</th></tr></thead>
      <tbody>{marks.map((m,i)=>{const stu=db.students.find(s=>s.studentId===m.studentId);const mod=db.modules.find(mo=>mo.id===m.moduleId);const mm=calcModuleMark(m,mod?.hasPractical!==false);const g=grade(mm);return<tr key={i}><td className="td-name">{stu?.name||m.studentId}</td><td style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11}}>{m.studentId}</td><td>{mod?.name}</td><td style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:700}}>{mm}%</td><td><span className={`badge ${gradeColor(g)}`}>{g}</span></td></tr>;})}</tbody>
    </table></div></div>
  </>);
}
