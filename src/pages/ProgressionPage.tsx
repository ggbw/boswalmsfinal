import { useState } from 'react';
import { useApp } from '@/context/AppContext';
import { supabase } from '@/integrations/supabase/client';

export default function ProgressionPage() {
  const { db, toast, reloadDb } = useApp();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<Record<string, Set<string>>>({});
  const [processing, setProcessing] = useState(false);

  const toggle = (classId: string) => {
    setExpanded(prev => ({ ...prev, [classId]: !prev[classId] }));
  };

  const toggleStudent = (classId: string, studentId: string) => {
    setSelected(prev => {
      const s = new Set(prev[classId] || []);
      if (s.has(studentId)) s.delete(studentId); else s.add(studentId);
      return { ...prev, [classId]: s };
    });
  };

  const selectAll = (classId: string, studentIds: string[]) => {
    setSelected(prev => {
      const current = prev[classId] || new Set();
      const allSelected = studentIds.every(id => current.has(id));
      return { ...prev, [classId]: allSelected ? new Set() : new Set(studentIds) };
    });
  };

  const progressStudent = async (studentId: string, classId: string, action: 'approved' | 'rejected') => {
    const student = db.students.find(s => s.id === studentId);
    if (!student) return;

    if (action === 'approved') {
      const cls = db.classes.find(c => c.id === classId);
      const prog = db.config.programmes.find(p => p.id === cls?.programme);
      const maxSem = prog?.semesters || 2;

      let newSem = student.semester;
      let newYear = student.year;
      if (student.semester < maxSem) {
        newSem = student.semester + 1;
      } else {
        newYear = student.year + 1;
        newSem = 1;
      }

      const { error } = await supabase.from('students').update({
        year: newYear, semester: newSem, progression_status: 'approved'
      }).eq('id', studentId);
      if (error) { toast('Error: ' + error.message, 'error'); return false; }
    } else {
      const { error } = await supabase.from('students').update({
        progression_status: 'rejected'
      }).eq('id', studentId);
      if (error) { toast('Error: ' + error.message, 'error'); return false; }
    }
    return true;
  };

  const handleBulkAction = async (classId: string, action: 'approved' | 'rejected') => {
    const sel = selected[classId];
    if (!sel || sel.size === 0) { toast('No students selected', 'error'); return; }
    setProcessing(true);
    let count = 0;
    for (const sid of sel) {
      const ok = await progressStudent(sid, classId, action);
      if (ok) count++;
    }
    toast(`${count} student(s) ${action}`, 'success');
    setSelected(prev => ({ ...prev, [classId]: new Set() }));
    setProcessing(false);
    reloadDb();
  };

  const handleIndividual = async (studentId: string, classId: string, action: 'approved' | 'rejected') => {
    setProcessing(true);
    const ok = await progressStudent(studentId, classId, action);
    if (ok) toast(`Student ${action}`, 'success');
    setProcessing(false);
    reloadDb();
  };

  return (
    <>
      <div className="page-header">
        <div><div className="page-title">Student Progression / Promotion</div><div className="page-sub">Approve or reject student progression individually or in bulk</div></div>
      </div>
      <div className="notif-banner"><span style={{ fontSize: 16 }}>ℹ️</span><div>HOD and HOY must approve student progression from Semester 1 → Semester 2 and from one academic year to the next.</div></div>

      {db.classes.map(cls => {
        const students = db.students.filter(s => s.classId === cls.id);
        const prog = db.config.programmes.find(p => p.id === cls.programme);
        const nextSem = cls.semester < (prog?.semesters || 2) ? `Semester ${cls.semester + 1}` : `Year ${cls.year + 1} Semester 1`;
        const isExpanded = expanded[cls.id];
        const sel = selected[cls.id] || new Set();
        const pendingStudents = students.filter(s => (s as any).progressionStatus !== 'approved');

        return (
          <div key={cls.id} className="card" style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }} onClick={() => toggle(cls.id)}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>
                  <i className="fa-solid fa-school" /> {cls.name}
                  <span style={{ fontSize: 11, color: 'var(--text2)', fontWeight: 400, marginLeft: 8 }}>
                    {prog?.type} · Year {cls.year} Sem {cls.semester} → {nextSem}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 3 }}>{students.length} students</div>
              </div>
              <i className={`fa-solid fa-chevron-${isExpanded ? 'up' : 'down'}`} style={{ color: 'var(--text2)' }} />
            </div>

            {isExpanded && (
              <div style={{ marginTop: 12 }}>
                <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                  <button className="btn btn-green btn-sm" disabled={processing || sel.size === 0} onClick={() => handleBulkAction(cls.id, 'approved')}>
                    ✓ Approve Selected ({sel.size})
                  </button>
                  <button className="btn btn-outline btn-sm" disabled={processing || sel.size === 0} onClick={() => handleBulkAction(cls.id, 'rejected')} style={{ color: '#f85149' }}>
                    ✕ Reject Selected
                  </button>
                  <button className="btn btn-outline btn-sm" onClick={() => selectAll(cls.id, students.map(s => s.id))}>
                    {students.every(s => sel.has(s.id)) ? 'Deselect All' : 'Select All'}
                  </button>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead><tr><th style={{ width: 30 }}></th><th>Name</th><th>Student ID</th><th>Year</th><th>Sem</th><th>Status</th><th>Action</th></tr></thead>
                    <tbody>
                      {students.map(s => {
                        const pStatus = (s as any).progressionStatus || 'pending';
                        return (
                          <tr key={s.id}>
                            <td>
                              <input type="checkbox" checked={sel.has(s.id)} onChange={() => toggleStudent(cls.id, s.id)} />
                            </td>
                            <td className="td-name">{s.name}</td>
                            <td style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11 }}>{s.studentId}</td>
                            <td>{s.year}</td>
                            <td>{s.semester}</td>
                            <td>
                              <span className={`badge ${pStatus === 'approved' ? 'badge-active' : pStatus === 'rejected' ? 'badge-fail' : 'badge-pending'}`}>
                                {pStatus.charAt(0).toUpperCase() + pStatus.slice(1)}
                              </span>
                            </td>
                            <td>
                              <div style={{ display: 'flex', gap: 4 }}>
                                <button className="btn btn-green btn-sm" disabled={processing || pStatus === 'approved'} onClick={() => handleIndividual(s.id, cls.id, 'approved')} title="Approve">✓</button>
                                <button className="btn btn-outline btn-sm" disabled={processing} onClick={() => handleIndividual(s.id, cls.id, 'rejected')} title="Reject" style={{ color: '#f85149' }}>✕</button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
