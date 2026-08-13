import { useApp } from '@/context/AppContext';
import { grade, gradeColor, type DB, type Student } from '@/data/db';
import { useAssessmentMarks } from '@/hooks/useAssessmentMarks';
import { studentModuleResults } from '@/lib/studentMarks';
import { PrincipalDashboard, HodDashboard, LecturerDashboard } from '@/pages/RoleDashboards';
import StudentRegistrationPanel from '@/components/StudentRegistrationPanel';

/**
 * Student dashboard. Marks come from assessment_marks; this previously read
 * db.marks and matched nothing, so "Modules" always showed 0 and the marks
 * panel always said "No marks recorded yet". Split out so the hook is not
 * called behind the role check.
 */
function StudentDashboard({ stu, db }: { stu: Student; db: DB }) {
  const { scoreOf, loading } = useAssessmentMarks({ studentNumbers: [stu.studentId] });
  const results = loading ? [] : studentModuleResults(db, stu, scoreOf);
  const marked = results.filter(r => !r.unmarked);

  const cls = db.classes.find(c => c.id === stu.classId);
  const prog = db.config.programmes.find(p => p.id === stu.programme);
  // attendance.student_id holds students.id (the record key), not the number.
  const stuAtt = db.attendance.filter(a => a.studentId === stu.id);
  const attPct2 = stuAtt.length ? Math.round(stuAtt.filter(a => a.status === 'present').length / stuAtt.length * 100) : 0;
  const stuAssign = db.assignments.filter(a => a.classId === stu.classId);

  return (
    <>
      <div className="page-header"><div><div className="page-title">Welcome, {stu.name.split(' ')[0]}</div><div className="page-sub">{cls?.name} · {prog?.name} · Year {stu.year} Semester {stu.semester}</div></div></div>
      <div className="stat-grid">
        <div className="stat-card"><div className="stat-icon" style={{ background: '#fff3cc' }}><i className="fa-solid fa-book-open-reader" style={{ color: '#d4920a' }} /></div><div><div className="stat-val">{results.length}</div><div className="stat-label">Modules</div></div></div>
        <div className="stat-card"><div className="stat-icon" style={{ background: '#dafbe1' }}><i className="fa-solid fa-circle-check" style={{ color: '#1a7f37' }} /></div><div><div className="stat-val">{attPct2}%</div><div className="stat-label">My Attendance</div></div></div>
        <div className="stat-card"><div className="stat-icon" style={{ background: '#ddf4ff' }}><i className="fa-solid fa-list-check" style={{ color: '#0550ae' }} /></div><div><div className="stat-val">{stuAssign.length}</div><div className="stat-label">Assignments</div></div></div>
        <div className="stat-card"><div className="stat-icon" style={{ background: '#f0e6ff' }}><i className="fa-solid fa-school" style={{ color: '#6639ba' }} /></div><div><div className="stat-val">{cls?.name || '—'}</div><div className="stat-label">My Class</div></div></div>
      </div>
      <div className="two-col">
        <StudentRegistrationPanel student={stu} />
        <div className="card"><div className="card-title"><span><i className="fa-solid fa-book-open" /> My Modules &amp; Marks</span></div>
          {loading
            ? <div style={{ color: 'var(--text2)', fontSize: 12, padding: '10px 0' }}>Loading marks…</div>
            : marked.length
              ? marked.map(({ module, mark }) => {
                  const g = grade(mark.moduleMark);
                  return <div key={module.id} className="info-row"><span className="info-label">{module.name}</span><div style={{ display: 'flex', gap: 6, alignItems: 'center' }}><span style={{ fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>{mark.moduleMark}%</span><span className={`badge ${gradeColor(g)}`}>{g}</span></div></div>;
                })
              : <div style={{ color: 'var(--text2)', fontSize: 12, padding: '10px 0' }}>No marks recorded yet</div>}
        </div>
        <div className="card"><div className="card-title"><span><i className="fa-solid fa-calendar-check" /> Upcoming Assignments</span></div>
          {stuAssign.length ? stuAssign.map(a => <div key={a.id} className="info-row"><span className="info-label">{a.title}</span><span className="info-val">{a.dueDate}</span></div>) : <div style={{ color: 'var(--text2)', fontSize: 12, padding: '10px 0' }}>No assignments yet</div>}
        </div>
      </div>
    </>
  );
}

export default function DashboardPage() {
  const { db, currentUser, navigate } = useApp();
  const role = currentUser?.role;
  const totalStudents = db.students.length;
  const totalLecturers = db.users.filter(u => u.role === 'lecturer').length;
  const totalClasses = db.classes.length;
  const totalModules = db.modules.length;
  const totalAtt = db.attendance.length;
  const presentAtt = db.attendance.filter(a => a.status === 'present').length;
  const attPct = totalAtt ? Math.round(presentAtt / totalAtt * 100) : 92;

  // Each role gets the dashboard built for the question it opens the system to
  // ask, rather than one page showing everyone the same admin counters.
  if (role === 'principal')        return <PrincipalDashboard academicOnly={false} />;
  if (role === 'deputy_principal') return <PrincipalDashboard academicOnly />;
  if (role === 'hod')              return <HodDashboard />;
  if (role === 'lecturer')         return <LecturerDashboard />;

  if (role === 'student') {
    const stu = db.students.find(s => s.studentId === currentUser?.studentId);
    if (!stu) return <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text2)' }}>Student record not found.</div>;
    return <StudentDashboard stu={stu} db={db} />;
  }

  const isStaff = role === 'admin' || role === 'hod' || role === 'hoa';
  return (
    <>
      {db.notifications.map(n => (
        <div key={n.id} className="notif-banner">
          <span style={{ fontSize: 16, flexShrink: 0 }}>{n.priority === 'high' ? <i className="fa-solid fa-circle-exclamation" style={{ color: '#cf222e' }} /> : n.priority === 'normal' ? <i className="fa-solid fa-triangle-exclamation" style={{ color: '#d4920a' }} /> : <i className="fa-solid fa-circle-check" style={{ color: '#1a7f37' }} />}</span>
          <div><div style={{ fontSize: 12, fontWeight: 700 }}>{n.title}</div><div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 2 }}>{n.body.substring(0, 100)}…</div></div>
        </div>
      ))}
      <div className="page-header">
        <div>
          <div className="page-title">Welcome back, {currentUser?.name?.split(' ')[0] || 'Admin'}</div>
          <div className="page-sub">
            Academic Year {db.config.currentYear} · Semester {db.config.currentSemester}
            {db.config.semesterStartDate && db.config.semesterEndDate && (
              <> · {db.config.semesterStartDate} — {db.config.semesterEndDate}</>
            )}
            {' '}· Boswa Culinary Institute of Botswana
          </div>
        </div>
      </div>
      {isStaff && (
        <div className="stat-grid">
          <div className="stat-card"><div className="stat-icon" style={{ background: '#fff0cc' }}><i className="fa-solid fa-user-graduate" style={{ color: '#d4920a' }} /></div><div><div className="stat-val">{totalStudents}</div><div className="stat-label">Total Students</div></div></div>
          <div className="stat-card"><div className="stat-icon" style={{ background: '#e8f4fd' }}><i className="fa-solid fa-chalkboard-user" style={{ color: '#2563eb' }} /></div><div><div className="stat-val">{totalLecturers}</div><div className="stat-label">Lecturers</div></div></div>
          <div className="stat-card"><div className="stat-icon" style={{ background: '#f0ffe8' }}><i className="fa-solid fa-school" style={{ color: '#1a7f37' }} /></div><div><div className="stat-val">{totalClasses}</div><div className="stat-label">Classes</div></div></div>
          <div className="stat-card"><div className="stat-icon" style={{ background: '#fdf0ff' }}><i className="fa-solid fa-book-open" style={{ color: '#8250df' }} /></div><div><div className="stat-val">{totalModules}</div><div className="stat-label">Modules</div></div></div>
          <div className="stat-card"><div className="stat-icon" style={{ background: '#f0fff4' }}><i className="fa-solid fa-circle-check" style={{ color: '#1a7f37' }} /></div><div><div className="stat-val">{attPct}%</div><div className="stat-label">Avg Attendance</div></div></div>
        </div>
      )}
      <div style={{ marginBottom: 20 }}>
        <div className="card-title" style={{ fontSize: 15, fontWeight: 700, marginBottom: 14 }}>
          Active Classes — {db.config.currentYear} · Semester {db.config.currentSemester}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 12 }}>
          {(() => {
            const activeClasses = db.classes.filter(cls => cls.calYear === db.config.currentYear && cls.semester === db.config.currentSemester);
            if (activeClasses.length === 0) {
              return (
                <div style={{ color: 'var(--text2)', fontSize: 13, padding: '20px 0' }}>
                  No classes found for Year {db.config.currentYear} · Semester {db.config.currentSemester}. Update the Academic Year Settings in Configuration.
                </div>
              );
            }
            return activeClasses.map(cls => {
              const studCount = db.students.filter(s => s.classId === cls.id).length;
              const prog = db.config.programmes.find(p => p.id === cls.programme);
              return (
                <div key={cls.id} className="card" style={{ cursor: 'pointer' }} onClick={() => navigate('students')}>
                  <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}><i className="fa-solid fa-school" /> {cls.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 3 }}>{prog?.type} · Year {cls.year} · Semester {cls.semester}</div>
                  <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 10 }}><i className="fa-solid fa-user-tie" /> {[...new Set(db.lecturerModules.filter(lm => lm.classId === cls.id).map(lm => db.users.find(u => u.id === lm.lecturerId)?.name).filter(Boolean))].join(', ') || '—'}</div>
                  <div className="prog-bar"><div className="prog-fill" style={{ width: `${Math.round(studCount / 20 * 100)}%` }} /></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
                    <span style={{ fontSize: 11, color: 'var(--text2)' }}>{studCount} students</span>
                    <span className="badge badge-active">Active</span>
                  </div>
                </div>
              );
            });
          })()}
        </div>
      </div>
    </>
  );
}
