import { useApp } from '@/context/AppContext';
import { supabase } from '@/integrations/supabase/client';

export default function AssignmentsPage() {
  const { db, currentUser, showModal, closeModal, toast, reloadDb } = useApp();
  const role = currentUser?.role;

  let assignments = db.assignments;

  if (role === 'lecturer') {
    // Lecturers only see assignments they created
    assignments = assignments.filter(a => a.createdBy === currentUser?.id);
  }

  if (role === 'student') {
    // Students only see assignments for modules they are enrolled in
    const stu = db.students.find(s => s.studentId === currentUser?.studentId || s.name.split(' ')[0].toLowerCase() === (currentUser?.name||'').split(' ')[0].toLowerCase());
    if (stu) {
      const myModuleIds = db.modules.filter(m => m.classes.includes(stu.classId)).map(m => m.id);
      const overrideModuleIds = db.studentModules.filter(sm => sm.studentId === stu.id).map(sm => sm.moduleId);
      const allModuleIds = [...new Set([...myModuleIds, ...overrideModuleIds])];
      assignments = assignments.filter(a => allModuleIds.includes(a.moduleId));
    }
  }

  // Get lecturer's modules
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

  return (<>
    <div className="page-header">
      <div><div className="page-title"><i className="fa-solid fa-list-check" style={{color:'var(--accent)',marginRight:8}}/>Assignments</div><div className="page-sub">{assignments.length} assignment(s)</div></div>
      {role === 'lecturer' && <button className="btn btn-primary btn-sm" onClick={handleCreateAssignment}><i className="fa-solid fa-plus" /> Create Assignment</button>}
    </div>
    <div className="card"><div className="table-wrap"><table><thead><tr><th>Title</th><th>Module</th><th>Class</th><th>Due Date</th><th style={{textAlign:'center'}}>Marks</th><th>Type</th><th>Status</th></tr></thead>
      <tbody>{assignments.map(a=>{const mod=db.modules.find(m=>m.id===a.moduleId);const cls=db.classes.find(c=>c.id===a.classId);return<tr key={a.id}><td className="td-name">{a.title}</td><td>{mod?.name}</td><td>{cls?.name}</td><td style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11}}>{a.dueDate}</td><td style={{fontFamily:"'JetBrains Mono',monospace",textAlign:'center'}}>{a.marks}</td><td><span className={`badge ${a.submissionType==='hardcopy'?'badge-pending':'badge-active'}`}>{(a.submissionType||'softcopy').charAt(0).toUpperCase()+(a.submissionType||'softcopy').slice(1)}</span></td><td><span className={`badge ${a.status==='graded'?'badge-credit':a.status==='active'?'badge-pass':'badge-inactive'}`}>{a.status}</span></td></tr>;})}</tbody>
    </table></div></div>
  </>);
}
