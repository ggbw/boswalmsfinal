import { useState, useEffect } from 'react';
import { useApp } from '@/context/AppContext';
import { supabase } from '@/integrations/supabase/client';
import { getLecturerClasses } from '@/lib/lecturerHelpers';

type Session = 'start' | 'end';

export default function AttendancePage() {
  const { db, setDb, toast, currentUser } = useApp();
  const role = currentUser?.role;

  // Admin sees all classes; HOD/HOA/Lecturer see only classes they teach
  const availableClasses = role === 'admin'
    ? db.classes
    : getLecturerClasses(db.lecturerModules, db.classes, currentUser?.id || '');

  const [attClass, setAttClass] = useState(availableClasses[0]?.id || '');
  const [attDate, setAttDate] = useState(new Date().toISOString().split('T')[0]);
  const [attModule, setAttModule] = useState('');
  // Which register we're taking: 'start' of the lesson (P/A/L) or 'end' (P/A).
  const [attSession, setAttSession] = useState<Session>('start');
  const [attState, setAttState] = useState<Record<string, string>>({});

  const students = db.students.filter(s => s.classId === attClass);
  const classModules = db.modules.filter(m => m.classes.includes(attClass));

  // Prefill the register from any attendance already saved for this exact
  // class + date + module + session; everyone else defaults to Present.
  useEffect(() => {
    const next: Record<string, string> = {};
    students.forEach(s => {
      const rec = db.attendance.find(a =>
        a.studentId === s.studentId &&
        a.classId === attClass &&
        (a.moduleId || '') === (attModule || '') &&
        a.date === attDate &&
        (a.session || 'start') === attSession,
      );
      next[s.id] = rec ? rec.status : 'present';
    });
    setAttState(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attClass, attModule, attDate, attSession, db.attendance, db.students]);

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
      module_id: attModule || '',
      date: attDate,
      status: attState[s.id] || 'present',
      session: attSession,
    }));

    const { error } = await supabase
      .from('attendance')
      .upsert(records, { onConflict: 'student_id,class_id,module_id,date,session' });

    if (error) { toast('Error saving attendance: ' + error.message, 'error'); return; }

    // Mirror into local state so UI stays in sync — replace only rows for this
    // same class/date/module/session register, leaving the other register intact.
    const localRecords = students.map(s => ({
      studentId: s.studentId, classId: attClass,
      moduleId: attModule || '', date: attDate,
      status: attState[s.id] || 'present', session: attSession as Session,
    }));
    setDb(prev => ({
      ...prev,
      attendance: [
        ...prev.attendance.filter(a => !(
          a.classId === attClass &&
          a.date === attDate &&
          (a.moduleId || '') === (attModule || '') &&
          (a.session || 'start') === attSession
        )),
        ...localRecords,
      ],
    }));
    toast(`${attSession === 'start' ? 'Start-of-lesson' : 'End-of-lesson'} attendance saved!`, 'success');
  };

  const isEnd = attSession === 'end';

  return (<>
    <div className="page-header"><div className="page-title">Mark Attendance</div></div>
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="form-row cols3" style={{ marginBottom: 14 }}>
        <div className="form-group">
          <label>Class</label>
          <select className="form-select" value={attClass} onChange={e => { setAttClass(e.target.value); setAttModule(''); }}>
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
            <option value="">— Whole class (no module) —</option>
            {classModules.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
      </div>

      {/* Register toggle: a lesson is marked twice — once at the start, once at the end. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text2)' }}>Register:</div>
        <div style={{ display: 'inline-flex', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
          <button
            className="btn"
            style={{
              border: 'none', borderRadius: 0, padding: '8px 18px',
              background: !isEnd ? 'var(--accent)' : 'transparent',
              color: !isEnd ? '#fff' : 'var(--text2)', fontWeight: 700,
            }}
            onClick={() => setAttSession('start')}
          >
            <i className="fa-solid fa-play" style={{ marginRight: 6 }} /> Lesson Start
          </button>
          <button
            className="btn"
            style={{
              border: 'none', borderRadius: 0, padding: '8px 18px',
              background: isEnd ? 'var(--accent)' : 'transparent',
              color: isEnd ? '#fff' : 'var(--text2)', fontWeight: 700,
            }}
            onClick={() => setAttSession('end')}
          >
            <i className="fa-solid fa-flag-checkered" style={{ marginRight: 6 }} /> Lesson End
          </button>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text2)' }}>
          {isEnd
            ? 'End of lesson — mark Present (P) or Absent (A).'
            : 'Start of lesson — mark Present (P), Absent (A) or Late (L).'}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 14 }}>
        <div style={{ background: '#dafbe1', border: '1px solid #aceebb', borderRadius: 8, padding: '12px 14px' }}><div style={{ fontSize: 24, fontWeight: 700, color: '#1a7f37', fontFamily: "'JetBrains Mono',monospace" }}>{present}</div><div style={{ fontSize: 11, color: '#1a7f37', fontWeight: 600 }}>Present</div></div>
        <div style={{ background: '#ffebe9', border: '1px solid #ffc1ba', borderRadius: 8, padding: '12px 14px' }}><div style={{ fontSize: 24, fontWeight: 700, color: '#cf222e', fontFamily: "'JetBrains Mono',monospace" }}>{absent}</div><div style={{ fontSize: 11, color: '#cf222e', fontWeight: 600 }}>Absent</div></div>
        {!isEnd && (
          <div style={{ background: '#fff8c5', border: '1px solid #ffe07c', borderRadius: 8, padding: '12px 14px' }}><div style={{ fontSize: 24, fontWeight: 700, color: '#9a6700', fontFamily: "'JetBrains Mono',monospace" }}>{late}</div><div style={{ fontSize: 11, color: '#9a6700', fontWeight: 600 }}>Late</div></div>
        )}
        <div style={{ background: '#ddf4ff', border: '1px solid #addcff', borderRadius: 8, padding: '12px 14px' }}><div style={{ fontSize: 24, fontWeight: 700, color: '#0969da', fontFamily: "'JetBrains Mono',monospace" }}>{students.length}</div><div style={{ fontSize: 11, color: '#0969da', fontWeight: 600 }}>Total</div></div>
      </div>

      <div className="att-grid">{students.map(s => (
        <div key={s.id} className="att-card">
          <div className="att-name">{s.name.split(' ').slice(0, 2).join(' ')}</div>
          <div className="att-toggle">
            <button className={`att-btn present ${attState[s.id] === 'present' ? 'active' : ''}`} onClick={() => setAtt(s.id, 'present')}>P</button>
            <button className={`att-btn absent ${attState[s.id] === 'absent' ? 'active' : ''}`} onClick={() => setAtt(s.id, 'absent')}>A</button>
            {!isEnd && (
              <button className={`att-btn late ${attState[s.id] === 'late' ? 'active' : ''}`} onClick={() => setAtt(s.id, 'late')}>L</button>
            )}
          </div>
        </div>
      ))}</div>

      {students.length === 0 && (
        <div style={{ textAlign: 'center', padding: 32, color: 'var(--text2)' }}>No students in this class.</div>
      )}

      <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
        <button className="btn btn-primary" onClick={saveAttendance}>
          💾 Save {isEnd ? 'End' : 'Start'} Register
        </button>
        <button className="btn btn-outline" onClick={() => { const ns: Record<string, string> = {}; students.forEach(s => ns[s.id] = 'present'); setAttState(ns); }}>✓ All Present</button>
      </div>
    </div>
  </>);
}
