import { useState } from 'react';
import { useApp } from '@/context/AppContext';
import { supabase } from '@/integrations/supabase/client';

export default function AssignmentsPage() {
  const { db, currentUser, showModal, closeModal, toast, reloadDb } = useApp();
  const role = currentUser?.role;
  const [selectedAssignment, setSelectedAssignment] = useState<string | null>(null);

  let assignments = db.assignments;

  if (role === 'lecturer') {
    assignments = assignments.filter(a => a.createdBy === currentUser?.id);
  }

  // Find current student record
  const currentStudent = role === 'student'
    ? db.students.find(s => s.studentId === currentUser?.studentId || s.name.split(' ')[0].toLowerCase() === (currentUser?.name||'').split(' ')[0].toLowerCase())
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
    const lecModules = getLecturerModules();
    let title = '', description = '', moduleId = lecModules[0]?.id || '', classId = '';
    let dueDate = '', marks = 100, submissionType = 'softcopy';

    const getClassesForModule = (mid: string) => {
      const mod = db.modules.find(m => m.id === mid);
      if (!mod) return [];
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
        <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={async () => {
          if (!title || !moduleId) { toast('Title and module are required', 'error'); return; }
          const id = 'asgn_' + Date.now();
          const { error } = await supabase.from('assignments').insert({
            id, title, description, module_id: moduleId, class_id: classId || null,
            due_date: dueDate || null, marks, status: 'active',
            submission_type: submissionType, created_by: currentUser?.id || null,
            uploaded_by: currentUser?.name || null, uploaded_date: new Date().toISOString().split('T')[0],
          });
          if (error) { toast(error.message, 'error'); } else {
            toast('Assignment created!', 'success'); closeModal(); reloadDb();
          }
        }}>Create Assignment</button>
      </div>
    ));
  };

  const handleViewAssignment = (assignmentId: string) => {
    setSelectedAssignment(selectedAssignment === assignmentId ? null : assignmentId);
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

          // Convert file to base64 for storage in submissions table
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

  return (<>
    <div className="page-header">
      <div><div className="page-title"><i className="fa-solid fa-list-check" style={{color:'var(--accent)',marginRight:8}}/>Assignments</div><div className="page-sub">{assignments.length} assignment(s)</div></div>
      {role === 'lecturer' && <button className="btn btn-primary btn-sm" onClick={handleCreateAssignment}><i className="fa-solid fa-plus" /> Create Assignment</button>}
    </div>
    <div className="card"><div className="table-wrap"><table><thead><tr><th>Title</th><th>Module</th><th>Class</th><th>Due Date</th><th style={{textAlign:'center'}}>Marks</th><th>Type</th><th>Status</th>{role === 'student' && <th>Action</th>}</tr></thead>
      <tbody>{assignments.map(a => {
        const mod = db.modules.find(m => m.id === a.moduleId);
        const cls = db.classes.find(c => c.id === a.classId);
        const mySubmission = currentStudent ? db.submissions.find(sub => sub.assignmentId === a.id && sub.studentId === currentStudent.id) : null;
        const isExpanded = selectedAssignment === a.id;

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

      return (
        <div className="card" style={{marginTop:16}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
            <div>
              <div className="card-title" style={{margin:0}}>{a.title}</div>
              <div style={{fontSize:12,color:'var(--text2)',marginTop:4}}>{mod?.name} • {cls?.name}</div>
            </div>
            <button className="btn btn-outline btn-sm" onClick={() => setSelectedAssignment(null)}>
              <i className="fa-solid fa-times" /> Close
            </button>
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
        </div>
      );
    })()}
  </>);
}
