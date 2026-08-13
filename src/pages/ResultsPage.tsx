import { useApp } from '@/context/AppContext';
import { grade, gradeColor, type DB, type Student } from '@/data/db';
import { getScopedStudents } from '@/lib/scope';
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

  if (!STAFF_ROLES.includes(role || '')) {
    return <div className="card" style={{textAlign:'center',padding:40,color:'var(--text2)'}}>Access restricted. Please contact your administrator if you believe this is an error.</div>;
  }

  return <StaffResults />;
}

const STAFF_ROLES = ['admin','super_admin','hod','hoa','lecturer','principal','deputy_principal'];

/**
 * Every student's module marks, scoped to what the viewer may see.
 *
 * Previously listed `db.marks` — one row per student per module from the
 * abandoned table — which returned nothing, so this page was permanently empty.
 * Now derived from assessment_marks, one row per student per module, with a
 * class-scoped fetch so a lecturer's page doesn't pull the whole school.
 */
function StaffResults() {
  const { db, currentUser } = useApp();
  const students = getScopedStudents(db, currentUser);
  const classIds = [...new Set(students.map(s => s.classId))].filter(Boolean);
  const { scoreOf, loading, error } = useAssessmentMarks({ classIds });

  const rows = loading ? [] : students.flatMap(s =>
    studentModuleResults(db, s, scoreOf)
      .filter(r => !r.unmarked)
      .map(r => ({ student: s, module: r.module, mark: r.mark.moduleMark })),
  );

  return (<>
    <div className="page-header">
      <div>
        <div className="page-title">Exam Results</div>
        <div className="page-sub">
          {loading ? 'Loading marks…' : `${rows.length} module result(s) across ${students.length} student(s)`}
        </div>
      </div>
    </div>
    {error && (
      <div className="card" style={{ padding: 16, color: '#cf222e', fontSize: 13 }}>
        <i className="fa-solid fa-triangle-exclamation" style={{ marginRight: 8 }} />
        Results could not be loaded: {error}
      </div>
    )}
    <div className="card"><div className="table-wrap">
      <table>
        <thead><tr><th>Student</th><th>ID</th><th>Module</th><th style={{textAlign:'center'}}>Mark</th><th>Grade</th></tr></thead>
        <tbody>
          {loading
            ? <tr><td colSpan={5} style={{textAlign:'center',padding:28,color:'var(--text2)'}}>Loading…</td></tr>
            : rows.length === 0
              ? <tr><td colSpan={5} style={{textAlign:'center',padding:28,color:'var(--text2)'}}>No marks recorded yet.</td></tr>
              : rows.map((r, i) => {
                  const g = grade(r.mark);
                  return (
                    <tr key={`${r.student.id}-${r.module.id}-${i}`}>
                      <td className="td-name">{r.student.name}</td>
                      <td style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11}}>{r.student.studentId}</td>
                      <td>{r.module.name}</td>
                      <td style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:700,textAlign:'center'}}>{r.mark}%</td>
                      <td><span className={`badge ${gradeColor(g)}`}>{g}</span></td>
                    </tr>
                  );
                })}
        </tbody>
      </table>
    </div></div>
  </>);
}
