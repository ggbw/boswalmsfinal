import { useState } from 'react';
import { useApp } from '@/context/AppContext';
import { supabase } from '@/integrations/supabase/client';

export default function AttendancePage() {
  const { db, setDb, toast, currentUser } = useApp();
  const role = currentUser?.role;

  // Admin sees all classes; HOD/HOA/Lecturer see only classes they teach
  const availableClasses = role === 'admin'
    ? db.classes
    : db.classes.filter(c => c.lecturer === currentUser?.name);

  const [attClass, setAttClass] = useState(availableClasses[0]?.id || '');
  const [attDate, setAttDate] = useState(new Date().toISOString().split('T')[0]);
  const [attModule, setAttModule] = useState('');
  const [attState, setAttState] = useState<Record<string, string>>({});

  const students = db.students.filter(s => s.classId === attClass);
  students.forEach(s => { if (!attState[s.id]) attState[s.id] = 'present'; });

  const present = Object.values(attState).filter(v => v === 'present').length;
  const absent  = Object.values(attState).filter(v => v === 'absent').length;
  const late    = Object.values(attState).filter(v => v === 'late').length;

  const setAtt = (id: string, status: string) =>
    setAttState(prev => ({ ...prev, [id]: status }));

  const saveAttendance = async () => {
    if (!attClass) { toast('Please select a class', 'error'); return; }
    if (!attDate)  { toast('Please select a date', 'error'); return; }

    const records = students.map(s => ({
      student_id: s.studentId,
      class_id: attClass,
      module_id: attModule || null,
      date: attDate,
      status: attState[s.id] || 'present',
    }));

    const { error } = await supabase
      .from('attendance')
      .upsert(records, { onConflict: 'student_id,class_id,date' });

    if (error) { toast('Error saving attendance: ' + error.message, 'error'); return; }

    // Mirror into local state so UI stays in sync
    const localRecords = students.map(s => ({
      studentId: s.studentId, classId: attClass,
      moduleId: attModule || '', date: attDate,
      status: attState[s.id] || 'present',
    }));
    setDb(prev => ({
      ...prev,
      attendance: [
        ...prev.attendance.filter(a => !(a.classId === attClass && a.date === attDate)),
        ...localRecords,
      ],
    }));
    toast('Attendance saved successfully!', 'success');
  };

  const classModules = db.modules.filter(m => m.classes.includes(attClass));

  return (<>
    <div className="page-header"><div className="page-title">Mark Attendance</div></div>
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="form-row cols3" style={{ marginBottom: 14 }}>
        <div className="form-group">
          <label>Class</label>
          <select className="form-select" value={attClass} onChange={e => { setAttClass(e.target.value); setAttState({}); setAttModule(''); }}>
            {availableClasses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label>Date</label>
          <input className="form-input" type="date" value={attDate} onChange={e => setAttDate(e.target.value)} />
        </div>
        <div className="form-group">
          <label>Module</label>
          <select className="form-select" value={attModule} onChange={e => setAttModule(e.target.value)}>
            <option value="">— All modules —</option>
            {classModules.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 14 }}>
        <div style={{ background: '#dafbe1', border: '1px solid #aceebb', borderRadius: 8, padding: '12px 14px' }}><div style={{ fontSize: 24, fontWeight: 700, color: '#1a7f37', fontFamily: "'JetBrains Mono',monospace" }}>{present}</div><div style={{ fontSize: 11, color: '#1a7f37', fontWeight: 600 }}>Present</div></div>
        <div style={{ background: '#ffebe9', border: '1px solid #ffc1ba', borderRadius: 8, padding: '12px 14px' }}><div style={{ fontSize: 24, fontWeight: 700, color: '#cf222e', fontFamily: "'JetBrains Mono',monospace" }}>{absent}</div><div style={{ fontSize: 11, color: '#cf222e', fontWeight: 600 }}>Absent</div></div>
        <div style={{ background: '#fff8c5', border: '1px solid #ffe07c', borderRadius: 8, padding: '12px 14px' }}><div style={{ fontSize: 24, fontWeight: 700, color: '#9a6700', fontFamily: "'JetBrains Mono',monospace" }}>{late}</div><div style={{ fontSize: 11, color: '#9a6700', fontWeight: 600 }}>Late</div></div>
        <div style={{ background: '#ddf4ff', border: '1px solid #addcff', borderRadius: 8, padding: '12px 14px' }}><div style={{ fontSize: 24, fontWeight: 700, color: '#0969da', fontFamily: "'JetBrains Mono',monospace" }}>{students.length}</div><div style={{ fontSize: 11, color: '#0969da', fontWeight: 600 }}>Total</div></div>
      </div>

      <div className="att-grid">{students.map(s => (
        <div key={s.id} className="att-card">
          <div className="att-name">{s.name.split(' ').slice(0, 2).join(' ')}</div>
          <div className="att-toggle">
            <button className={`att-btn present ${attState[s.id] === 'present' ? 'active' : ''}`} onClick={() => setAtt(s.id, 'present')}>P</button>
            <button className={`att-btn absent ${attState[s.id] === 'absent' ? 'active' : ''}`} onClick={() => setAtt(s.id, 'absent')}>A</button>
            <button className={`att-btn late ${attState[s.id] === 'late' ? 'active' : ''}`} onClick={() => setAtt(s.id, 'late')}>L</button>
          </div>
        </div>
      ))}</div>

      {students.length === 0 && (
        <div style={{ textAlign: 'center', padding: 32, color: 'var(--text2)' }}>No students in this class.</div>
      )}

      <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
        <button className="btn btn-primary" onClick={saveAttendance}>💾 Save Attendance</button>
        <button className="btn btn-outline" onClick={() => { const ns: Record<string, string> = {}; students.forEach(s => ns[s.id] = 'present'); setAttState(ns); }}>✓ All Present</button>
      </div>
    </div>
  </>);
}
