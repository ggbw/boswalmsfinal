import { useState } from 'react';
import { useApp } from '@/context/AppContext';
import { supabase } from '@/integrations/supabase/client';

export default function AssignmentsPage() {
  const { db, currentUser, showModal, closeModal, toast, reloadDb } = useApp();
  const role = currentUser?.role;
  const [selectedAssignment, setSelectedAssignment] = useState<string | null>(null);

  const isAdmin = role === 'admin';
  const isTeacher = role === 'lecturer' || role === 'hod' || role === 'hoy';

  let assignments = db.assignments;

  if (isTeacher) {
    assignments = assignments.filter(a => a.createdBy === currentUser?.id);
  }

  const currentStudent = role === 'student'
    ? db.students.find(s => s.studentId === currentUser?.studentId)
    : null;

  if (role === 'student' && currentStudent) {
    const myModuleIds = db.modules.filter(m => m.classes.includes(currentStudent.classId)).map(m => m.id);
    const overrideModuleIds = db.studentModules.filter(sm => sm.studentId === currentStudent.id).map(sm => sm.moduleId);
    const allModuleIds = [...new Set([...myModuleIds, ...overrideModuleIds])];
    assignments = assignments.filter(a => allModuleIds.includes(a.moduleId));
  }

  const getLecturerModules = () => {
    const lecClasses = db.classes.filter(c => c.lecturer === currentUser?.name).map(c => c.id);
    return db.modules.filter(m => m.classes.some(cid => lecClasses.includes(cid)));
  };

  const handleCreateAssignment = () => {
    const lecModules = isAdmin ? db.modules : getLecturerModules();
    let title = '', description = '', moduleId = lecModules[0]?.id || '', classId = '';
    let dueDate = '', marks = 100, submissionType = 'softcopy';
    let attachmentFile: File | null = null;

    const getClassesForModule = (mid: string) => {
      const mod = db.modules.find(m => m.id === mid);
      if (!mod) return [];
      if (role === 'admin') return db.classes.filter(c => mod.classes.includes(c.id));
      const lecClassIds = db.classes.filter(c => c.lecturer === currentUser?.name).map(c => c.id);
      return db.classes.filter(c => mod.classes.includes(c.id) && lecClassIds.includes(c.id));
    };

    const initialClasses = getClassesForModule(moduleId);
    classId = initialClasses[0]?.id || '';

    showModal('Create Assignment', (
      <div>
        <div className="form-group"><label>Title *</label><input className="form-input" onChange={e => title = e.target.value} /></div>
        <div className="form-group"><label>Description</label><textarea className="form-input" rows={3} onChange={e => description = e.target.value} /></div>
        <div className="form-row cols2">
          <div className="form-group"><label>Module *</label>
            <select className="form-select" defaultValue={moduleId} onChange={e => moduleId = e.target.value}>
              {lecModules.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          <div className="form-group"><label>Class *</label>
            <select className="form-select" defaultValue={classId} onChange={e => classId = e.target.value}>
              {initialClasses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>
        <div className="form-row cols2">
          <div className="form-group"><label>Due Date</label><input className="form-input" type="date" onChange={e => dueDate = e.target.value} /></div>
          <div className="form-group"><label>Total Marks</label><input className="form-input" type="number" defaultValue={100} onChange={e => marks = Number(e.target.value)} /></div>
        </div>
        <div className="form-group"><label>Submission Type *</label>
          <select className="form-select" defaultValue={submissionType} onChange={e => submissionType = e.target.value}>
            <option value="softcopy">Softcopy (Digital Upload)</option>
            <option value="hardcopy">Hardcopy (Physical Submission)</option>
          </select>
        </div>
        <div className="form-group">
          <label>Attach File (optional)</label>
          <input className="form-input" type="file" onChange={e => { attachmentFile = e.target.files?.[0] || null; }} />
          <div style={{fontSize:11,color:'var(--text2)',marginTop:4}}>Attach a reference document, rubric, or instructions file (max 10MB)</div>
        </div>
        <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={async () => {
          if (!title || !moduleId) { toast('Title and module are required', 'error'); return; }
          if (attachmentFile && attachmentFile.size > 10 * 1024 * 1024) { toast('Attachment must be under 10MB', 'error'); return; }

          let attachmentData: string | null = null;
          let attachmentName: string | null = null;

          if (attachmentFile) {
            attachmentName = attachmentFile.name;
            attachmentData = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result as string);
              reader.onerror = () => reject(new Error('Failed to read file'));
              reader.readAsDataURL(attachmentFile!);
            });
          }

          const id = 'asgn_' + Date.now();
          const { error } = await supabase.from('assignments').insert({
            id, title, description, module_id: moduleId, class_id: classId || null,
            due_date: dueDate || null, marks, status: 'active',
            submission_type: submissionType, created_by: currentUser?.id || null,
            uploaded_by: currentUser?.name || null, uploaded_date: new Date().toISOString().split('T')[0],
            attachment_name: attachmentName, attachment_data: attachmentData,
          });
          if (error) { toast(error.message, 'error'); } else {
            toast('Assignment created!', 'success'); closeModal(); reloadDb();
          }
        }}>Create Assignment</button>
      </div>
    ));
  };

  const handleDeleteAssignment = async (assignmentId: string) => {
    if (!confirm('Are you sure you want to delete this assignment? This will also remove all submissions.')) return;
    // Delete submissions first
    await supabase.from('submissions').delete().eq('assignment_id', assignmentId);
    const { error } = await supabase.from('assignments').delete().eq('id', assignmentId);
    if (error) { toast(error.message, 'error'); } else {
      toast('Assignment deleted', 'success');
      setSelectedAssignment(null);
      reloadDb();
    }
  };

  const handleEnterMarks = async (a: typeof assignments[0]) => {
    const students = db.students.filter(s => s.classId === a.classId);
    if (students.length === 0) { toast('No students in this class', 'error'); return; }

    const { data: existing } = await supabase
      .from('assessment_marks').select('*')
      .eq('assessment_id', a.id).eq('assessment_type', 'assignment');

    const marksMap: Record<string, number> = {};
    students.forEach(s => {
      const ex = (existing || []).find((x: any) => x.student_id === s.studentId);
      marksMap[s.studentId] = ex ? Number(ex.score) : 0;
    });

    showModal(`Enter Marks — ${a.title}`, (
      <div>
        <div style={{ background: 'var(--bg2)', borderRadius: 8, padding: '8px 14px', marginBottom: 12, fontSize: 12, color: 'var(--text2)' }}>
          Assignment · Out of <strong>{a.marks}</strong> · {students.length} student(s)
        </div>
        <div className="table-wrap" style={{ maxHeight: 400, overflowY: 'auto' }}>
          <table>
            <thead><tr><th>Student</th><th>ID</th><th>Score (0–{a.marks})</th></tr></thead>
            <tbody>
              {students.map(s => (
                <tr key={s.id}>
                  <td className="td-name">{s.name}</td>
                  <td style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11 }}>{s.studentId}</td>
                  <td>
                    <input className="form-input" type="number" min={0} max={a.marks}
                      defaultValue={marksMap[s.studentId] ?? 0} style={{ width: 80 }}
                      onChange={e => { marksMap[s.studentId] = Number(e.target.value); }} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button className="btn btn-primary" style={{ marginTop: 14, width: '100%' }} onClick={async () => {
          let hasError = false;
          for (const s of students) {
            const score = marksMap[s.studentId] ?? 0;
            // Normalise to 0-100
            const normalised = a.marks > 0 ? Math.round((score / a.marks) * 100) : score;
            const ex = (existing || []).find((x: any) => x.student_id === s.studentId);
            if (ex) {
              const { error } = await supabase.from('assessment_marks').update({ score: normalised }).eq('id', ex.id);
              if (error) hasError = true;
            } else {
              const { error } = await supabase.from('assessment_marks').insert({
                id: 'am_' + Date.now() + '_' + s.studentId,
                student_id: s.studentId, assessment_id: a.id, assessment_type: 'assignment',
                class_id: a.classId, module_id: a.moduleId, score: normalised,
              });
              if (error) hasError = true;
            }
          }
          if (hasError) { toast('Some marks could not be saved', 'error'); }
          else { toast('Marks saved!', 'success'); closeModal(); reloadDb(); }
        }}>Save Marks</button>
      </div>
    ), 'large');
  };

  const handleViewAssignment = (assignmentId: string) => {
    setSelectedAssignment(selectedAssignment === assignmentId ? null : assignmentId);
  };

  const handleGradeSubmission = (submission: any, assignment: any) => {
    let grade = submission.grade ?? '';
    let feedback = submission.feedback ?? '';

    showModal(`Grade: ${db.students.find(s => s.id === submission.studentId)?.name || 'Student'}`, (
      <div>
        <div className="form-row cols2">
          <div className="form-group">
            <label>Grade (out of {assignment.marks})</label>
            <input className="form-input" type="number" min={0} max={assignment.marks} defaultValue={grade} onChange={e => grade = Number(e.target.value)} />
          </div>
          <div className="form-group">
            <label>Status</label>
            <div style={{padding:'8px 0',fontSize:13,color:'var(--text2)'}}>Will be set to "graded"</div>
          </div>
        </div>
        <div className="form-group">
          <label>Feedback</label>
          <textarea className="form-input" rows={3} defaultValue={feedback} placeholder="Provide feedback to the student..." onChange={e => feedback = e.target.value} />
        </div>
        <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={async () => {
          const { error } = await supabase.from('submissions').update({
            grade: Number(grade), feedback, status: 'graded'
          }).eq('id', submission.id);
          if (error) { toast(error.message, 'error'); } else {
            toast('Submission graded!', 'success'); closeModal(); reloadDb();
          }
        }}>Save Grade</button>
      </div>
    ));
  };

  const handleSubmitAssignment = (assignment: typeof assignments[0]) => {
    if (!currentStudent) return;
    let notes = '';
    let selectedFile: File | null = null;

    const existingSubmission = db.submissions.find(
      sub => sub.assignmentId === assignment.id && sub.studentId === currentStudent.id
    );

    if (existingSubmission) {
      toast('You have already submitted this assignment', 'info');
      return;
    }

    showModal(`Submit: ${assignment.title}`, (
      <div>
        <div className="form-group">
          <label>Upload File *</label>
          <input className="form-input" type="file" onChange={e => { selectedFile = e.target.files?.[0] || null; }} />
          <div style={{fontSize:11,color:'var(--text2)',marginTop:4}}>Max file size: 10MB</div>
        </div>
        <div className="form-group">
          <label>Notes (optional)</label>
          <textarea className="form-input" rows={3} placeholder="Any notes for your lecturer..." onChange={e => notes = e.target.value} />
        </div>
        <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={async () => {
          if (!selectedFile) { toast('Please select a file to upload', 'error'); return; }
          if (selectedFile.size > 10 * 1024 * 1024) { toast('File size must be under 10MB', 'error'); return; }

          const reader = new FileReader();
          reader.onload = async () => {
            const base64 = reader.result as string;
            const now = new Date();
            const id = 'sub_' + Date.now();
            const { error } = await supabase.from('submissions').insert({
              id,
              assignment_id: assignment.id,
              student_id: currentStudent.id,
              submitted_date: now.toISOString().split('T')[0],
              submitted_time: now.toTimeString().split(' ')[0],
              file_name: selectedFile!.name,
              file_data: base64,
              file_size: `${(selectedFile!.size / 1024).toFixed(1)} KB`,
              notes,
              status: 'submitted',
            });
            if (error) { toast(error.message, 'error'); } else {
              toast('Assignment submitted successfully!', 'success'); closeModal(); reloadDb();
            }
          };
          reader.readAsDataURL(selectedFile);
        }}>Submit Assignment</button>
      </div>
    ));
  };

  // Get submissions for an assignment (for lecturer/admin view)
  const getAssignmentSubmissions = (assignmentId: string) => {
    return db.submissions.filter(sub => sub.assignmentId === assignmentId);
  };

  return (<>
    <div className="page-header">
      <div><div className="page-title"><i className="fa-solid fa-list-check" style={{color:'var(--accent)',marginRight:8}}/>Assignments</div><div className="page-sub">{assignments.length} assignment(s)</div></div>
      {(isAdmin || isTeacher) && <button className="btn btn-primary btn-sm" onClick={handleCreateAssignment}><i className="fa-solid fa-plus" /> Create Assignment</button>}
    </div>
    <div className="card"><div className="table-wrap"><table><thead><tr><th>Title</th><th>Module</th><th>Class</th><th>Due Date</th><th style={{textAlign:'center'}}>Marks</th><th>Type</th><th>Status</th><th>Submissions</th>{role === 'student' && <th>Action</th>}{(isAdmin || isTeacher) && <th>Actions</th>}</tr></thead>
      <tbody>{assignments.map(a => {
        const mod = db.modules.find(m => m.id === a.moduleId);
        const cls = db.classes.find(c => c.id === a.classId);
        const mySubmission = currentStudent ? db.submissions.find(sub => sub.assignmentId === a.id && sub.studentId === currentStudent.id) : null;
        const submissionCount = db.submissions.filter(sub => sub.assignmentId === a.id).length;

        return (
          <tr key={a.id} onClick={() => handleViewAssignment(a.id)} style={{cursor:'pointer'}}>
            <td className="td-name">{a.title}</td>
            <td>{mod?.name}</td>
            <td>{cls?.name}</td>
            <td style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11}}>{a.dueDate}</td>
            <td style={{fontFamily:"'JetBrains Mono',monospace",textAlign:'center'}}>{a.marks}</td>
            <td><span className={`badge ${a.submissionType==='hardcopy'?'badge-pending':'badge-active'}`}>{(a.submissionType||'softcopy').charAt(0).toUpperCase()+(a.submissionType||'softcopy').slice(1)}</span></td>
            <td>
              {mySubmission 
                ? <span className="badge badge-credit">Submitted</span>
                : <span className={`badge ${a.status==='graded'?'badge-credit':a.status==='active'?'badge-pass':'badge-inactive'}`}>{a.status}</span>
              }
            </td>
            <td style={{textAlign:'center'}}>{submissionCount}</td>
            {role === 'student' && (
              <td onClick={e => e.stopPropagation()}>
                {a.submissionType === 'softcopy' && !mySubmission && a.status === 'active' && (
                  <button className="btn btn-primary btn-sm" onClick={() => handleSubmitAssignment(a)}>
                    <i className="fa-solid fa-upload" /> Submit
                  </button>
                )}
                {mySubmission && <span style={{fontSize:11,color:'var(--text2)'}}>✓ Submitted</span>}
              </td>
            )}
            {(isAdmin || isTeacher) && (
              <td onClick={e => e.stopPropagation()}>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button className="btn btn-primary btn-sm" onClick={() => handleEnterMarks(a)}>
                    <i className="fa-solid fa-pen-to-square" /> Marks
                  </button>
                  <button className="btn btn-outline btn-sm" style={{color:'var(--danger)'}} onClick={() => handleDeleteAssignment(a.id)}>
                    <i className="fa-solid fa-trash" />
                  </button>
                </div>
              </td>
            )}
          </tr>
        );
      })}</tbody>
    </table></div></div>

    {/* Expanded assignment detail */}
    {selectedAssignment && (() => {
      const a = assignments.find(x => x.id === selectedAssignment);
      if (!a) return null;
      const mod = db.modules.find(m => m.id === a.moduleId);
      const cls = db.classes.find(c => c.id === a.classId);
      const mySubmission = currentStudent ? db.submissions.find(sub => sub.assignmentId === a.id && sub.studentId === currentStudent.id) : null;
      const allSubmissions = getAssignmentSubmissions(a.id);

      return (
        <div className="card" style={{marginTop:16}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
            <div>
              <div className="card-title" style={{margin:0}}>{a.title}</div>
              <div style={{fontSize:12,color:'var(--text2)',marginTop:4}}>{mod?.name} • {cls?.name}</div>
            </div>
            <div style={{display:'flex',gap:8}}>
              {(isAdmin || isTeacher) && (
                <button className="btn btn-outline btn-sm" style={{color:'var(--danger)'}} onClick={() => handleDeleteAssignment(a.id)}>
                  <i className="fa-solid fa-trash" /> Delete
                </button>
              )}
              <button className="btn btn-outline btn-sm" onClick={() => setSelectedAssignment(null)}>
                <i className="fa-solid fa-times" /> Close
              </button>
            </div>
          </div>
          <div style={{marginTop:16,display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
            <div className="info-row"><span className="info-label">Due Date</span><span className="info-val">{a.dueDate || '—'}</span></div>
            <div className="info-row"><span className="info-label">Total Marks</span><span className="info-val">{a.marks}</span></div>
            <div className="info-row"><span className="info-label">Submission Type</span><span className="info-val">{(a.submissionType||'softcopy').charAt(0).toUpperCase()+(a.submissionType||'softcopy').slice(1)}</span></div>
            <div className="info-row"><span className="info-label">Status</span><span className="info-val">{a.status}</span></div>
            {a.uploadedBy && <div className="info-row"><span className="info-label">Created By</span><span className="info-val">{a.uploadedBy}</span></div>}
            {a.uploadedDate && <div className="info-row"><span className="info-label">Created Date</span><span className="info-val">{a.uploadedDate}</span></div>}
          </div>
          {a.description && (
            <div style={{marginTop:16}}>
              <div style={{fontSize:12,fontWeight:600,color:'var(--text2)',marginBottom:4}}>Description</div>
              <div style={{fontSize:13,color:'var(--text1)',lineHeight:1.6,whiteSpace:'pre-wrap'}}>{a.description}</div>
            </div>
          )}
          {a.instructions && (
            <div style={{marginTop:12}}>
              <div style={{fontSize:12,fontWeight:600,color:'var(--text2)',marginBottom:4}}>Instructions</div>
              <div style={{fontSize:13,color:'var(--text1)',lineHeight:1.6,whiteSpace:'pre-wrap'}}>{a.instructions}</div>
            </div>
          )}
          {a.attachmentName && a.attachmentData && (
            <div style={{marginTop:12}}>
              <div style={{fontSize:12,fontWeight:600,color:'var(--text2)',marginBottom:4}}>Attachment</div>
              <a href={a.attachmentData} download={a.attachmentName} className="btn btn-outline btn-sm" style={{display:'inline-flex',alignItems:'center',gap:6}}>
                <i className="fa-solid fa-paperclip" /> {a.attachmentName}
              </a>
            </div>
          )}

          {/* Student submission status */}
          {role === 'student' && mySubmission && (
            <div style={{marginTop:16,padding:12,background:'var(--bg2)',borderRadius:8}}>
              <div style={{fontSize:12,fontWeight:600,color:'var(--accent)',marginBottom:8}}>Your Submission</div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
                <div className="info-row"><span className="info-label">File</span><span className="info-val">{mySubmission.fileName}</span></div>
                <div className="info-row"><span className="info-label">Size</span><span className="info-val">{mySubmission.fileSize}</span></div>
                <div className="info-row"><span className="info-label">Submitted</span><span className="info-val">{mySubmission.submittedDate} {mySubmission.submittedTime}</span></div>
                <div className="info-row"><span className="info-label">Status</span><span className="info-val"><span className="badge badge-credit">{mySubmission.status}</span></span></div>
                {mySubmission.grade !== null && <div className="info-row"><span className="info-label">Grade</span><span className="info-val">{mySubmission.grade}/{a.marks}</span></div>}
                {mySubmission.feedback && <div className="info-row" style={{gridColumn:'1/-1'}}><span className="info-label">Feedback</span><span className="info-val">{mySubmission.feedback}</span></div>}
              </div>
            </div>
          )}

          {/* Submit button for students */}
          {role === 'student' && a.submissionType === 'softcopy' && !mySubmission && a.status === 'active' && (
            <div style={{marginTop:16}}>
              <button className="btn btn-primary" onClick={() => handleSubmitAssignment(a)}>
                <i className="fa-solid fa-upload" /> Submit Assignment
              </button>
            </div>
          )}

          {/* Lecturer/Admin: Submissions list */}
          {(isAdmin || isTeacher) && (
            <div style={{marginTop:20}}>
              <div style={{fontSize:14,fontWeight:700,color:'var(--text1)',marginBottom:12}}>
                Submissions ({allSubmissions.length})
              </div>
              {allSubmissions.length === 0 ? (
                <div style={{textAlign:'center',padding:20,color:'var(--text2)',fontSize:13}}>No submissions yet.</div>
              ) : (
                <div className="table-wrap"><table>
                  <thead><tr><th>Student</th><th>Student ID</th><th>File</th><th>Submitted</th><th>Status</th><th>Grade</th><th>Actions</th></tr></thead>
                  <tbody>
                    {allSubmissions.map(sub => {
                      const student = db.students.find(s => s.id === sub.studentId);
                      return (
                        <tr key={sub.id}>
                          <td className="td-name">{student?.name || 'Unknown'}</td>
                          <td style={{fontSize:11,fontFamily:"'JetBrains Mono',monospace"}}>{student?.studentId || '—'}</td>
                          <td>
                            {sub.fileData ? (
                              <a href={sub.fileData} download={sub.fileName} className="btn btn-outline btn-sm" style={{fontSize:11}} onClick={e => e.stopPropagation()}>
                                <i className="fa-solid fa-download" /> {sub.fileName}
                              </a>
                            ) : (
                              <span style={{fontSize:11,color:'var(--text2)'}}>{sub.fileName || '—'}</span>
                            )}
                          </td>
                          <td style={{fontSize:11}}>{sub.submittedDate} {sub.submittedTime}</td>
                          <td>
                            <span className={`badge ${sub.status === 'graded' ? 'badge-credit' : 'badge-pending'}`}>{sub.status}</span>
                          </td>
                          <td style={{fontFamily:"'JetBrains Mono',monospace",textAlign:'center'}}>
                            {sub.grade !== null && sub.grade !== undefined ? `${sub.grade}/${a.marks}` : '—'}
                          </td>
                          <td onClick={e => e.stopPropagation()}>
                            <button className="btn btn-primary btn-sm" onClick={() => handleGradeSubmission(sub, a)}>
                              <i className="fa-solid fa-pen" /> Grade
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table></div>
              )}
            </div>
          )}
        </div>
      );
    })()}
  </>);
}
