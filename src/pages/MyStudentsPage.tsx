import { useApp } from '@/context/AppContext';
import { getScopedClasses, getScopedStudents } from '@/lib/scope';
import TimetablePage from '@/pages/TimetablePage';

export default function MyStudentsPage() {
  const { db, currentUser } = useApp();
  const role = currentUser?.role;

  if (role === 'student') {
    // The timetable is now a single uploaded document for the whole school
    // rather than per-class slots, so a student's view is the same page
    // everyone else sees — read-only, with a download. TimetablePage already
    // hides the upload and delete controls from non-admins.
    return <TimetablePage />;
  }

  // Lecturer / HOD / HOA. Previously every one of these roles was scoped through
  // lecturer_modules, so a HOD or HOA with no teaching assignments of their own
  // saw nothing at all here.
  const lecClasses = getScopedClasses(db, currentUser);
  const students = getScopedStudents(db, currentUser);

  return (<>
    <div className="page-header"><div className="page-title">My Students</div><div className="page-sub">{students.length} student(s) across {lecClasses.length} class(es)</div></div>
    <div className="card"><div className="table-wrap"><table><thead><tr><th>Name</th><th>Student ID</th><th>Class</th><th>Programme</th></tr></thead>
      <tbody>{students.map(s=>{const cls=db.classes.find(c=>c.id===s.classId);const prog=db.config.programmes.find(p=>p.id===s.programme);return<tr key={s.id}><td className="td-name">{s.name}</td><td style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11}}>{s.studentId}</td><td>{cls?.name}</td><td>{prog?.type} Yr{s.year}</td></tr>;})}</tbody>
    </table></div></div>
  </>);
}
