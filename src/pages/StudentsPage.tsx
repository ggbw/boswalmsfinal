import { useState } from 'react';
import { useApp } from '@/context/AppContext';
import { calcModuleMark, grade, gradeColor } from '@/data/db';

export default function StudentsPage() {
  const { db, currentUser, toast, showModal, closeModal, setDb } = useApp();
  const [search, setSearch] = useState('');
  const [classFilter, setClassFilter] = useState('');
  const role = currentUser?.role;

  if (role === 'student') return <StudentProfileFallback />;

  let students = db.students;
  if (role === 'lecturer') {
    const lec = db.users.find(u => u.id === currentUser?.id);
    if (lec) {
      const lecClasses = db.classes.filter(c => c.lecturer === lec.name).map(c => c.id);
      students = students.filter(s => lecClasses.includes(s.classId));
    }
  }

  const filtered = students.filter(s => {
    const matchSearch = !search || s.name.toLowerCase().includes(search.toLowerCase()) || s.studentId.toLowerCase().includes(search.toLowerCase());
    const matchClass = !classFilter || db.classes.find(c => c.id === s.classId)?.name === classFilter;
    return matchSearch && matchClass;
  });

  const showDetail = (id: string) => {
    const s = db.students.find(x => x.id === id);
    if (!s) return;
    const cls = db.classes.find(c => c.id === s.classId);
    const prog = db.config.programmes.find(p => p.id === s.programme);
    const marks = db.marks.filter(m => m.studentId === s.studentId);
    showModal('Student: ' + s.name, (
      <div>
        <div className="info-row"><span className="info-label">Student ID</span><span className="info-val">{s.studentId}</span></div>
        <div className="info-row"><span className="info-label">Full Name</span><span className="info-val">{s.name}</span></div>
        <div className="info-row"><span className="info-label">Gender</span><span className="info-val">{s.gender}</span></div>
        <div className="info-row"><span className="info-label">Date of Birth</span><span className="info-val">{s.dob}</span></div>
        <div className="info-row"><span className="info-label">Mobile</span><span className="info-val">{s.mobile || '—'}</span></div>
        <div className="info-row"><span className="info-label">Class</span><span className="info-val">{cls?.name || '—'}</span></div>
        <div className="info-row"><span className="info-label">Programme</span><span className="info-val">{prog?.name || '—'}</span></div>
        <div className="info-row"><span className="info-label">Year / Semester</span><span className="info-val">Year {s.year} · Sem {s.semester}</span></div>
        <div className="info-row"><span className="info-label">Guardian</span><span className="info-val">{s.guardian || '—'}</span></div>
        {marks.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Marks</div>
            <table><thead><tr><th>Module</th><th>Total %</th><th>Grade</th></tr></thead><tbody>
              {marks.map(m => { const mod = db.modules.find(mo => mo.id === m.moduleId); const mm = calcModuleMark(m); const g = grade(mm); return <tr key={m.moduleId}><td>{mod?.name}</td><td style={{ fontFamily: "'JetBrains Mono', monospace" }}>{mm}%</td><td><span className={`badge ${gradeColor(g)}`}>{g}</span></td></tr>; })}
            </tbody></table>
          </div>
        )}
      </div>
    ));
  };

  const showAddStudent = () => {
    let name = '', sid = '', dob = '', gender = 'Female', mobile = '', classId = db.classes[0]?.id || '', guard = '';
    showModal('Add New Student', (
      <div>
        <div className="form-row cols2">
          <div className="form-group"><label>Full Name *</label><input className="form-input" placeholder="Full name" onChange={e => name = e.target.value} /></div>
          <div className="form-group"><label>Student ID</label><input className="form-input" placeholder="BCI2026D-XX" onChange={e => sid = e.target.value} /></div>
        </div>
        <div className="form-row cols2">
          <div className="form-group"><label>Date of Birth</label><input className="form-input" type="date" onChange={e => dob = e.target.value} /></div>
          <div className="form-group"><label>Gender</label><select className="form-select" onChange={e => gender = e.target.value}><option>Female</option><option>Male</option></select></div>
        </div>
        <div className="form-row cols2">
          <div className="form-group"><label>Mobile</label><input className="form-input" onChange={e => mobile = e.target.value} /></div>
          <div className="form-group"><label>Class</label><select className="form-select" onChange={e => classId = e.target.value}>{db.classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        </div>
        <div className="form-row cols2">
          <div className="form-group"><label>Guardian Name</label><input className="form-input" onChange={e => guard = e.target.value} /></div>
        </div>
        <button className="btn btn-primary" onClick={() => {
          if (!name) { toast('Name is required', 'error'); return; }
          setDb(prev => ({ ...prev, students: [...prev.students, { id: 's' + Date.now(), studentId: sid || 'BCI2026-NEW', name, gender, dob, mobile, classId, guardian: guard, programme: 'DIPL2025', year: 1, semester: 1, status: 'active' }] }));
          closeModal(); toast('Student added!', 'success');
        }}>Save Student</button>
      </div>
    ));
  };

  return (
    <>
      <div className="page-header">
        <div><div className="page-title">Students</div><div className="page-sub">{filtered.length} total students</div></div>
        {role === 'admin' && <div style={{ display: 'flex', gap: 8 }}><button className="btn btn-primary btn-sm" onClick={showAddStudent}><i className="fa-solid fa-user-plus" /> Add Student</button></div>}
      </div>
      <div className="card">
        <div className="search-bar">
          <input className="search-input" placeholder="Search students…" value={search} onChange={e => setSearch(e.target.value)} />
          <select className="filter-select" value={classFilter} onChange={e => setClassFilter(e.target.value)}>
            <option value="">All Classes</option>
            {db.classes.map(c => <option key={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="table-wrap">
          <table><thead><tr><th>Name</th><th>Student ID</th><th>Class</th><th>Programme</th><th>Status</th><th>Action</th></tr></thead>
            <tbody>{filtered.map(s => {
              const cls = db.classes.find(c => c.id === s.classId);
              const prog = db.config.programmes.find(p => p.id === s.programme);
              return <tr key={s.id}>
                <td className="td-name"><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><div className="avatar" style={{ background: s.gender === 'Female' ? '#8250df' : '#1f6feb', width: 28, height: 28, fontSize: 11 }}>{s.name[0]}</div>{s.name}</div></td>
                <td style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11 }}>{s.studentId}</td>
                <td>{cls?.name || '-'}</td>
                <td>{prog?.type} Yr{s.year}</td>
                <td><span className="badge badge-active">Active</span></td>
                <td><button className="btn btn-outline btn-sm" onClick={() => showDetail(s.id)}>View</button></td>
              </tr>;
            })}</tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function StudentProfileFallback() {
  const { currentUser } = useApp();
  return <div className="card"><div className="page-title">My Profile</div><p style={{ marginTop: 10 }}>{currentUser?.name}</p></div>;
}
