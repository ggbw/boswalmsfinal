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
  // Active students only. getScopedStudents applies the visibility rule but not
  // a status filter, so withdrawn, deferred and graduated students were being
  // listed alongside the current cohort with nothing to distinguish them — and
  // the count in the subtitle disagreed with every other page in the system.
  const students = getScopedStudents(db, currentUser).filter(s => s.status === 'active');

  return (<>
    <div className="page-header"><div className="page-title">My Students</div><div className="page-sub">{students.length} student(s) across {lecClasses.length} class(es)</div></div>
    <div className="card">
      {/* An empty table with no message reads as a broken page. It is usually
          not: a lecturer with no modules assigned correctly has no students,
          and so does a class whose curriculum has never been linked. Say which,
          because the two need completely different things done about them. */}
      {students.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text2)', fontSize: 13, lineHeight: 1.7 }}>
          <i className="fa-solid fa-users-slash" style={{ fontSize: 28, color: 'var(--text3)', display: 'block', marginBottom: 12 }} />
          {lecClasses.length === 0 ? (<>
            <strong>No classes are assigned to you yet.</strong><br />
            An administrator assigns modules under <strong>Classes → Lecturers</strong>.
            Until then there are no students to show.
          </>) : (<>
            <strong>Your {lecClasses.length} class(es) have no active students.</strong><br />
            Either nobody is enrolled in them yet, or the class has no modules linked —
            an administrator can check under <strong>Classes → Sync Modules</strong>.
          </>)}
        </div>
      ) : (
        <div className="table-wrap"><table><thead><tr><th>Name</th><th>Student ID</th><th>Class</th><th>Programme</th></tr></thead>
          <tbody>{students.map(s=>{
            const cls=db.classes.find(c=>c.id===s.classId);
            const prog=db.config.programmes.find(p=>p.id===s.programme);
            return <tr key={s.id}>
              <td className="td-name">{s.name}</td>
              <td style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11}}>{s.studentId}</td>
              <td>{cls?.name || <span style={{color:'var(--text3)'}}>— no class</span>}</td>
              {/* prog?.type alone rendered "undefined Yr1" whenever a student's
                  programme was missing or misspelled. */}
              <td>{prog?.type ? `${prog.type} Yr${s.year}` : `Year ${s.year}`}</td>
            </tr>;})}</tbody>
        </table></div>
      )}
    </div>
  </>);
}
