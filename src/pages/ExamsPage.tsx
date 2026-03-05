import { useApp } from '@/context/AppContext';
import { supabase } from '@/integrations/supabase/client';

export default function ExamsPage() {
  const { db, currentUser, showModal, closeModal, toast, reloadDb } = useApp();
  const role = currentUser?.role;

  // Lecturer scoping: only see exams they created
  let exams = db.exams;
  if (role === 'lecturer') {
    exams = exams.filter(e => e.createdBy === currentUser?.id);
  }

  // Get lecturer's modules (modules assigned to classes they teach)
  const getLecturerModules = () => {
    const lecClasses = db.classes.filter(c => c.lecturer === currentUser?.name).map(c => c.id);
    return db.modules.filter(m => m.classes.some(cid => lecClasses.includes(cid)));
  };

  const handleCreateExam = () => {
    const lecModules = getLecturerModules();
    let name = '', moduleId = lecModules[0]?.id || '', classId = '', date = '', type = 'Written Exam';

    const getClassesForModule = (mid: string) => {
      const mod = db.modules.find(m => m.id === mid);
      if (!mod) return [];
      const lecClassIds = db.classes.filter(c => c.lecturer === currentUser?.name).map(c => c.id);
      return db.classes.filter(c => mod.classes.includes(c.id) && lecClassIds.includes(c.id));
    };

    const initialClasses = getClassesForModule(moduleId);
    classId = initialClasses[0]?.id || '';

    showModal('Create Exam', (
      <div>
        <div className="form-group"><label>Exam Name *</label><input className="form-input" onChange={e => name = e.target.value} /></div>
        <div className="form-row cols2">
          <div className="form-group"><label>Module *</label>
            <select className="form-select" defaultValue={moduleId} onChange={e => { moduleId = e.target.value; }}>
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
          <div className="form-group"><label>Date</label><input className="form-input" type="date" onChange={e => date = e.target.value} /></div>
          <div className="form-group"><label>Type</label>
            <select className="form-select" defaultValue={type} onChange={e => type = e.target.value}>
              <option>Written Exam</option><option>Practical Exam</option><option>Oral Exam</option>
            </select>
          </div>
        </div>
        <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={async () => {
          if (!name || !moduleId) { toast('Name and module are required', 'error'); return; }
          const id = 'exam_' + Date.now();
          const { error } = await supabase.from('exams').insert({
            id, name, module_id: moduleId, class_id: classId || null,
            date: date || null, type, status: 'scheduled',
            created_by: currentUser?.id || null,
          });
          if (error) { toast(error.message, 'error'); } else {
            toast('Exam created!', 'success'); closeModal(); reloadDb();
          }
        }}>Create Exam</button>
      </div>
    ));
  };

  return (<>
    <div className="page-header">
      <div><div className="page-title"><i className="fa-solid fa-file-pen" style={{color:'var(--accent)',marginRight:8}}/>Examinations</div><div className="page-sub">{exams.length} exam(s)</div></div>
      {role === 'lecturer' && <button className="btn btn-primary btn-sm" onClick={handleCreateExam}><i className="fa-solid fa-plus" /> Create Exam</button>}
    </div>
    <div className="card"><div className="table-wrap"><table><thead><tr><th>Exam Name</th><th>Module</th><th>Class</th><th>Date</th><th>Status</th></tr></thead>
      <tbody>{exams.map(e=>{const mod=db.modules.find(m=>m.id===e.moduleId);const cls=db.classes.find(c=>c.id===e.classId);return<tr key={e.id}><td className="td-name">{e.name}<div style={{fontSize:10,color:'var(--text3)',marginTop:2}}>{e.type||'Written Exam'}</div></td><td>{mod?.name}</td><td>{cls?.name}</td><td style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11}}>{e.date}</td><td><span className={`badge ${e.status==='done'?'badge-credit':e.status==='confirmed'?'badge-pass':'badge-pending'}`}>{e.status}</span></td></tr>;})}</tbody>
    </table></div></div>
  </>);
}
