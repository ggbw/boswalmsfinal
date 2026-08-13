import { useApp } from '@/context/AppContext';
import { grade, gradeColor } from '@/data/db';
import { getScopedStudents } from '@/lib/scope';
import { useAssessmentMarks } from '@/hooks/useAssessmentMarks';
import { studentModuleResults, studentAverage } from '@/lib/studentMarks';

const ALLOWED = ['admin', 'super_admin', 'hod', 'hoa', 'principal', 'deputy_principal'];

export default function GradesPage() {
  const { currentUser } = useApp();
  if (!ALLOWED.includes(currentUser?.role || '')) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text2)' }}>
        You do not have permission to view this page.
      </div>
    );
  }
  return <GradesTable />;
}

/**
 * Separate component so the marks hook isn't called behind the permission check.
 *
 * Grades come from `assessment_marks`. This page previously read `db.marks`,
 * filtering by the student number against rows keyed by `students.id`, so every
 * student's average showed "—" no matter how much had been marked.
 */
function GradesTable() {
  const { db, currentUser } = useApp();

  // Respect the same scoping as everywhere else: a HOD sees their department,
  // admins/HOA/principal see the school.
  const students = getScopedStudents(db, currentUser);
  const classIds = [...new Set(students.map(s => s.classId))].filter(Boolean);

  const { scoreOf, loading, error } = useAssessmentMarks({ classIds });

  const rows = loading ? [] : students.map(s => {
    const results = studentModuleResults(db, s, scoreOf);
    return {
      student: s,
      className: db.classes.find(c => c.id === s.classId)?.name || '—',
      modulesMarked: results.filter(r => !r.unmarked).length,
      average: studentAverage(results),
    };
  });

  const withMarks = rows.filter(r => r.average !== null).length;

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Student Grades Overview</div>
          <div className="page-sub">
            {loading ? 'Loading marks…' : `${withMarks} of ${rows.length} student(s) have marks recorded`}
          </div>
        </div>
      </div>

      {error && (
        <div className="card" style={{ padding: 16, color: '#cf222e', fontSize: 13 }}>
          <i className="fa-solid fa-triangle-exclamation" style={{ marginRight: 8 }} />
          Grades could not be loaded: {error}
        </div>
      )}

      <div className="card"><div className="table-wrap">
        <table>
          <thead><tr>
            <th>Student</th><th>Class</th>
            <th style={{ textAlign: 'center' }}>Modules Marked</th>
            <th style={{ textAlign: 'center' }}>Avg Mark</th>
            <th>Overall Grade</th><th>Year</th>
          </tr></thead>
          <tbody>
            {loading
              ? <tr><td colSpan={6} style={{ textAlign: 'center', padding: 28, color: 'var(--text2)' }}>Loading…</td></tr>
              : rows.length === 0
                ? <tr><td colSpan={6} style={{ textAlign: 'center', padding: 28, color: 'var(--text2)' }}>No students in scope.</td></tr>
                : rows.map(({ student, className, modulesMarked, average }) => {
                    const g = average === null ? null : grade(average);
                    return (
                      <tr key={student.id}>
                        <td className="td-name">{student.name}</td>
                        <td>{className}</td>
                        <td style={{ textAlign: 'center', fontFamily: "'JetBrains Mono',monospace", color: modulesMarked ? undefined : 'var(--text3)' }}>
                          {modulesMarked}
                        </td>
                        <td style={{ textAlign: 'center', fontFamily: "'JetBrains Mono',monospace", fontWeight: 700 }}>
                          {average === null ? '—' : `${average}%`}
                        </td>
                        <td>{g ? <span className={`badge ${gradeColor(g)}`}>{g}</span> : '—'}</td>
                        <td>Year {student.year}</td>
                      </tr>
                    );
                  })}
          </tbody>
        </table>
      </div></div>
    </>
  );
}
