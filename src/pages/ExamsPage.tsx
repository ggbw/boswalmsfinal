import { useState } from 'react';
import { useApp } from '@/context/AppContext';
import { supabase } from '@/integrations/supabase/client';
import { getLecturerClassIds, getLecturerModulesList } from '@/lib/lecturerHelpers';

export default function ExamsPage() {
  const { db, currentUser, showModal, closeModal, toast, reloadDb } = useApp();
  const role = currentUser?.role;

  const isAdmin = role === 'admin';
  const isTeacher = role === 'lecturer' || role === 'hod' || role === 'hoy';

  // Non-admin teaching staff: only see exams they created
  let exams = db.exams;
  if (isTeacher) {
    exams = exams.filter(e => e.createdBy === currentUser?.id);
  }

  const getLecturerModules = () =>
    getLecturerModulesList(db.lecturerModules, db.modules, currentUser?.id || '');

  const handleCreateExam = () => {
    const availableModules = isAdmin ? db.modules : getLecturerModules();
    let name = '', moduleId = availableModules[0]?.id || '', classId = '', date = '', type = 'Written Exam', startTime = '', endTime = '', room = '';

    const getClassesForModule = (mid: string) => {
      const lecClassIds = getLecturerClassIds(db.lecturerModules, currentUser?.id || '');
      const availableClasses = isAdmin ? db.classes : db.classes.filter(c => lecClassIds.includes(c.id));
      const mod = db.modules.find(m => m.id === mid);
      const linked = mod ? availableClasses.filter(c => mod.classes.includes(c.id)) : [];
      return linked.length > 0 ? linked : availableClasses;
    };

    const initialClasses = getClassesForModule(moduleId);
    classId = initialClasses[0]?.id || '';

    showModal('Create Exam', (
      <div>
        <div className="form-group"><label>Exam Name *</label><input className="form-input" placeholder="e.g. Semester 1 Final Exam" onChange={e => name = e.target.value} /></div>
        <div className="form-row cols2">
          <div className="form-group"><label>Module *</label>
            <select className="form-select" defaultValue={moduleId} onChange={e => { moduleId = e.target.value; }}>
              {availableModules.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          <div className="form-group"><label>Class *</label>
            <select className="form-select" defaultValue={classId} onChange={e => classId = e.target.value}>
              <option value="">— Select class —</option>
              {getClassesForModule(moduleId).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>
        <div className="form-row cols2">
          <div className="form-group"><label>Date</label><input className="form-input" type="date" onChange={e => date = e.target.value} /></div>
        </div>
        <div className="form-row cols2">
          <div className="form-group"><label>Start Time</label><input className="form-input" type="time" onChange={e => startTime = e.target.value} /></div>
          <div className="form-group"><label>End Time</label><input className="form-input" type="time" onChange={e => endTime = e.target.value} /></div>
        </div>
        <div className="form-row cols2">
          <div className="form-group"><label>Room / Venue</label>
            <select className="form-select" defaultValue={room} onChange={e => room = e.target.value}>
              <option value="">— Select room —</option>
              {db.rooms.map((r: any) => <option key={r.id} value={r.name}>{r.name} ({r.type})</option>)}
            </select>
          </div>
          <div className="form-group"><label>Type</label>
            <select className="form-select" defaultValue={type} onChange={e => type = e.target.value}>
              <option>Written Exam</option>
              <option>Practical Exam</option>
              <option>Final Practical Exam</option>
              <option>Final Theory Exam</option>
              <option>Final Practical Theory Exam</option>
              <option>Recipe</option>
              <option>Oral Exam</option>
            </select>
          </div>
        </div>
        <button className="btn btn-primary" style={{ marginTop: 12, width: '100%' }} onClick={async () => {
          if (!name || !moduleId) { toast('Name and module are required', 'error'); return; }
          const { error } = await supabase.from('exams').insert({
            id: 'exam_' + Date.now(), name, module_id: moduleId,
            class_id: classId || null, date: date || null,
            start_time: startTime || null, end_time: endTime || null,
            room: room || null, type, status: 'scheduled', created_by: currentUser?.id || null,
          });
          if (error) { toast(error.message, 'error'); } else {
            toast('Exam created!', 'success'); closeModal(); reloadDb();
          }
        }}>Create Exam</button>
      </div>
    ));
  };

  const handleEditExam = (exam: typeof exams[0]) => {
    const availableModules = isAdmin ? db.modules : getLecturerModules();
    let name = exam.name, moduleId = exam.moduleId, classId = exam.classId || '', date = exam.date || '', type = exam.type || 'Written Exam', startTime = exam.startTime || '', endTime = exam.endTime || '', room = exam.room || '';

    const getClassesForModule = (mid: string) => {
      const lecClassIds = getLecturerClassIds(db.lecturerModules, currentUser?.id || '');
      const availableClasses = isAdmin ? db.classes : db.classes.filter(c => lecClassIds.includes(c.id));
      const mod = db.modules.find(m => m.id === mid);
      const linked = mod ? availableClasses.filter(c => mod.classes.includes(c.id)) : [];
      return linked.length > 0 ? linked : availableClasses;
    };

    showModal('Edit Exam', (
      <div>
        <div className="form-group"><label>Exam Name *</label><input className="form-input" defaultValue={name} onChange={e => name = e.target.value} /></div>
        <div className="form-row cols2">
          <div className="form-group"><label>Module *</label>
            <select className="form-select" defaultValue={moduleId} onChange={e => { moduleId = e.target.value; }}>
              {availableModules.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          <div className="form-group"><label>Class *</label>
            <select className="form-select" defaultValue={classId} onChange={e => classId = e.target.value}>
              <option value="">— Select class —</option>
              {getClassesForModule(moduleId).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>
        <div className="form-row cols2">
          <div className="form-group"><label>Date</label><input className="form-input" type="date" defaultValue={date} onChange={e => date = e.target.value} /></div>
        </div>
        <div className="form-row cols2">
          <div className="form-group"><label>Start Time</label><input className="form-input" type="time" defaultValue={startTime} onChange={e => startTime = e.target.value} /></div>
          <div className="form-group"><label>End Time</label><input className="form-input" type="time" defaultValue={endTime} onChange={e => endTime = e.target.value} /></div>
        </div>
        <div className="form-row cols2">
          <div className="form-group"><label>Room / Venue</label>
            <select className="form-select" defaultValue={room} onChange={e => room = e.target.value}>
              <option value="">— Select room —</option>
              {db.rooms.map((r: any) => <option key={r.id} value={r.name}>{r.name} ({r.type})</option>)}
            </select>
          </div>
          <div className="form-group"><label>Type</label>
            <select className="form-select" defaultValue={type} onChange={e => type = e.target.value}>
              <option>Written Exam</option>
              <option>Practical Exam</option>
              <option>Final Practical Exam</option>
              <option>Final Theory Exam</option>
              <option>Final Practical Theory Exam</option>
              <option>Recipe</option>
              <option>Oral Exam</option>
            </select>
          </div>
        </div>
        <button className="btn btn-primary" style={{ marginTop: 12, width: '100%' }} onClick={async () => {
          if (!name || !moduleId) { toast('Name and module are required', 'error'); return; }
          const { error } = await supabase.from('exams').update({
            name, module_id: moduleId, class_id: classId || null,
            date: date || null, start_time: startTime || null, end_time: endTime || null,
            room: room || null, type,
          }).eq('id', exam.id);
          if (error) { toast(error.message, 'error'); } else {
            toast('Exam updated!', 'success'); closeModal(); reloadDb();
          }
        }}>Save Changes</button>
      </div>
    ));
  };

  const handleDeleteExam = (exam: typeof exams[0]) => {
    showModal('Delete Exam', (
      <div>
        <p style={{ marginBottom: 16 }}>Are you sure you want to delete <strong>{exam.name}</strong>? This cannot be undone.</p>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-danger" style={{ flex: 1 }} onClick={async () => {
            const { error } = await supabase.from('exams').delete().eq('id', exam.id);
            if (error) { toast(error.message, 'error'); } else {
              toast('Exam deleted', 'success'); closeModal(); reloadDb();
            }
          }}>Delete</button>
          <button className="btn btn-outline" style={{ flex: 1 }} onClick={closeModal}>Cancel</button>
        </div>
      </div>
    ));
  };

  const handleEnterMarks = async (exam: typeof exams[0]) => {
    const cls = db.classes.find(c => c.id === exam.classId);
    const students = db.students.filter(s => s.classId === exam.classId);
    if (students.length === 0) { toast('No students found for this class', 'error'); return; }

    // Load existing assessment_marks for this exam
    const { data: existing } = await supabase
      .from('assessment_marks')
      .select('*')
      .eq('assessment_id', exam.id)
      .eq('assessment_type', 'exam');

    const marksMap: Record<string, number> = {};
    students.forEach(s => {
      const ex = (existing || []).find((x: any) => x.student_id === s.studentId);
      marksMap[s.studentId] = ex ? Number(ex.score) : 0;
    });

    showModal(`Enter Marks — ${exam.name}`, (
      <div>
        <div style={{ background: 'var(--bg2)', borderRadius: 8, padding: '8px 14px', marginBottom: 12, fontSize: 12, color: 'var(--text2)' }}>
          <strong>{exam.type || 'Exam'}</strong> · Class: <strong>{cls?.name}</strong> · {students.length} student(s)
        </div>
        <div className="table-wrap" style={{ maxHeight: 400, overflowY: 'auto' }}>
          <table>
            <thead><tr><th>Student</th><th>ID</th><th>Score (0–100)</th></tr></thead>
            <tbody>
              {students.map(s => (
                <tr key={s.id}>
                  <td className="td-name">{s.name}</td>
                  <td style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11 }}>{s.studentId}</td>
                  <td>
                    <input className="form-input" type="number" min={0} max={100}
                      defaultValue={marksMap[s.studentId] ?? 0} style={{ width: 80 }}
                      onChange={e => { marksMap[s.studentId] = Number(e.target.value); }} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button className="btn btn-primary" style={{ marginTop: 14, width: '100%' }} onClick={async () => {
          const errors: string[] = [];

          // Step 1: save to assessment_marks
          for (const s of students) {
            const score = marksMap[s.studentId] ?? 0;
            const ex = (existing || []).find((x: any) => x.student_id === s.studentId);
            if (ex) {
              const { error } = await supabase.from('assessment_marks').update({ score }).eq('id', ex.id);
              if (error) errors.push(`assessment_marks update: ${s.studentId}`);
            } else {
              const { error } = await supabase.from('assessment_marks').insert({
                id: 'am_' + Date.now() + '_' + s.studentId,
                student_id: s.studentId, assessment_id: exam.id, assessment_type: 'exam',
                class_id: exam.classId, module_id: exam.moduleId, score,
              });
              if (error) errors.push(`assessment_marks insert: ${s.studentId}`);
            }
          }

          // Step 2: sync to marks table (final_exam column) for ResultsPage / Transcripts
          for (const s of students) {
            const score = marksMap[s.studentId] ?? 0;
            const { data: existingMark, error: fetchErr } = await supabase
              .from('marks').select('id')
              .eq('student_id', s.studentId)
              .eq('module_id', exam.moduleId)
              .eq('class_id', exam.classId)
              .maybeSingle();
            if (fetchErr) { errors.push(`marks lookup: ${s.studentId}`); continue; }
            if (existingMark) {
              const { error } = await supabase.from('marks').update({ final_exam: score })
                .eq('student_id', s.studentId)
                .eq('module_id', exam.moduleId)
                .eq('class_id', exam.classId);
              if (error) errors.push(`marks update: ${s.studentId}`);
            } else {
              const { error } = await supabase.from('marks').insert({
                student_id: s.studentId, module_id: exam.moduleId,
                class_id: exam.classId, final_exam: score,
                test1: 0, test2: 0, pract_test: 0, ind_ass: 0, grp_ass: 0, practical: 0,
                year: db.config.currentYear, semester: db.config.currentSemester,
              });
              if (error) errors.push(`marks insert: ${s.studentId}`);
            }
          }

          await supabase.from('exams').update({ status: 'done' }).eq('id', exam.id);
          if (errors.length > 0) {
            toast(`${errors.length} mark(s) could not be saved. Please try again.`, 'error');
          } else {
            toast('Marks saved!', 'success'); closeModal(); reloadDb();
          }
        }}>Save Marks</button>
      </div>
    ), 'large');
  };

  return (<>
    <div className="page-header">
      <div><div className="page-title"><i className="fa-solid fa-file-pen" style={{color:'var(--accent)',marginRight:8}}/>Examinations</div><div className="page-sub">{exams.length} exam(s)</div></div>
      {(isAdmin || isTeacher) && <button className="btn btn-primary btn-sm" onClick={handleCreateExam}><i className="fa-solid fa-plus" /> Create Exam</button>}
    </div>
    <div className="card"><div className="table-wrap"><table>
      <thead><tr><th>Exam Name</th><th>Module</th><th>Class</th><th>Date</th><th>Status</th>{(isAdmin || isTeacher) && <th>Actions</th>}</tr></thead>
      <tbody>{exams.map(e => {
        const mod = db.modules.find(m => m.id === e.moduleId);
        const cls = db.classes.find(c => c.id === e.classId);
        return (
          <tr key={e.id}>
            <td className="td-name">{e.name}<div style={{fontSize:10,color:'var(--text3)',marginTop:2}}>{e.type||'Written Exam'}</div></td>
            <td>{mod?.name}</td>
            <td>{cls?.name}</td>
            <td style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11}}>{e.date}</td>
            <td><span className={`badge ${e.status==='done'?'badge-credit':e.status==='confirmed'?'badge-pass':'badge-pending'}`}>{e.status}</span></td>
            {(role === 'lecturer' || role === 'admin') && (
              <td>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button className="btn btn-primary btn-sm" onClick={() => handleEnterMarks(e)}>
                    <i className="fa-solid fa-pen-to-square" /> Enter Marks
                  </button>
                  <button className="btn btn-outline btn-sm" onClick={() => handleEditExam(e)}>
                    <i className="fa-solid fa-pen" /> Edit
                  </button>
                  <button className="btn btn-danger btn-sm" onClick={() => handleDeleteExam(e)}>
                    <i className="fa-solid fa-trash" /> Delete
                  </button>
                </div>
              </td>
            )}
          </tr>
        );
      })}</tbody>
    </table></div></div>
  </>);
}
