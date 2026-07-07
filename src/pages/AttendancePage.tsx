import { useState, useEffect, useMemo } from 'react';
import { useApp } from '@/context/AppContext';
import { supabase } from '@/integrations/supabase/client';
import { getLecturerClasses } from '@/lib/lecturerHelpers';

type Session = 'start' | 'end';
type Tab = 'mark' | 'summary';

export default function AttendancePage() {
  const { db, setDb, toast, currentUser } = useApp();
  const role = currentUser?.role;

  // Admin sees all classes; HOD/HOA/Lecturer see only classes they teach
  const availableClasses = role === 'admin'
    ? db.classes
    : getLecturerClasses(db.lecturerModules, db.classes, currentUser?.id || '');

  const [tab, setTab] = useState<Tab>('mark');
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

  const tabBtn = (t: Tab, label: string, icon: string) => (
    <button
      className="btn"
      style={{
        border: 'none', borderRadius: 0, padding: '8px 18px',
        background: tab === t ? 'var(--accent)' : 'transparent',
        color: tab === t ? '#fff' : 'var(--text2)', fontWeight: 700,
      }}
      onClick={() => setTab(t)}
    >
      <i className={`fa-solid ${icon}`} style={{ marginRight: 6 }} /> {label}
    </button>
  );

  return (<>
    <div className="page-header" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <div className="page-title">Attendance</div>
      <div style={{ display: 'inline-flex', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
        {tabBtn('mark', 'Mark', 'fa-user-check')}
        {tabBtn('summary', 'Summary Report', 'fa-chart-column')}
      </div>
    </div>

    {tab === 'summary' ? <AttendanceSummary availableClasses={availableClasses} /> : (
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
    )}
  </>);
}

// ── Attendance Summary Report ────────────────────────────────────────────────
type ClassRow = { id: string; name: string };

// Local YYYY-MM-DD formatter (avoids the UTC shift of toISOString()).
const pad = (n: number) => String(n).padStart(2, '0');
const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// The [from, to] date window (inclusive) for a period around a reference date.
function computeRange(period: 'day' | 'week' | 'month', dateStr: string): { from: string; to: string; label: string } {
  const d = new Date(dateStr + 'T00:00:00');
  if (period === 'day') {
    return { from: dateStr, to: dateStr, label: d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) };
  }
  if (period === 'week') {
    const day = d.getDay();               // 0 Sun … 6 Sat
    const diffToMon = (day + 6) % 7;       // days since Monday
    const mon = new Date(d); mon.setDate(d.getDate() - diffToMon);
    const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
    const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
    return { from: fmt(mon), to: fmt(sun), label: `${mon.toLocaleDateString('en-GB', opts)} – ${sun.toLocaleDateString('en-GB', { ...opts, year: 'numeric' })}` };
  }
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return { from: fmt(first), to: fmt(last), label: d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) };
}

function AttendanceSummary({ availableClasses }: { availableClasses: ClassRow[] }) {
  const { db } = useApp();
  const [cls, setCls] = useState(availableClasses[0]?.id || '');
  const [moduleId, setModuleId] = useState('');
  const [period, setPeriod] = useState<'day' | 'week' | 'month'>('month');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [search, setSearch] = useState('');

  const classModules = db.modules.filter(m => m.classes.includes(cls));
  const range = useMemo(() => computeRange(period, date), [period, date]);

  // Attendance records in scope: this class, (optional) module, within the range.
  const recs = useMemo(
    () => db.attendance.filter(a =>
      a.classId === cls &&
      (!moduleId || (a.moduleId || '') === moduleId) &&
      a.date >= range.from && a.date <= range.to,
    ),
    [db.attendance, cls, moduleId, range.from, range.to],
  );

  const students = db.students.filter(s =>
    s.classId === cls &&
    (!search || s.name.toLowerCase().includes(search.toLowerCase()) || s.studentId.toLowerCase().includes(search.toLowerCase())),
  );

  const rows = students.map(s => {
    const sr = recs.filter(a => a.studentId === s.studentId);
    const present = sr.filter(a => a.status === 'present').length;
    const absent = sr.filter(a => a.status === 'absent').length;
    const late = sr.filter(a => a.status === 'late').length;
    const total = sr.length;
    // Rate treats "late" as attended (present + late) over all registers taken.
    const rate = total ? Math.round(((present + late) / total) * 100) : null;
    return { s, present, absent, late, total, rate };
  }).sort((a, b) => (a.rate ?? -1) - (b.rate ?? -1)); // worst attendance first

  const tot = rows.reduce((acc, r) => ({
    present: acc.present + r.present, absent: acc.absent + r.absent,
    late: acc.late + r.late, total: acc.total + r.total,
  }), { present: 0, absent: 0, late: 0, total: 0 });
  const overallRate = tot.total ? Math.round(((tot.present + tot.late) / tot.total) * 100) : null;

  const rateColor = (r: number | null) => r == null ? 'var(--text2)' : r >= 75 ? '#1a7f37' : r >= 50 ? '#9a6700' : '#cf222e';

  const periodBtn = (p: 'day' | 'week' | 'month', label: string) => (
    <button
      className="btn"
      style={{
        border: 'none', borderRadius: 0, padding: '7px 16px',
        background: period === p ? 'var(--accent)' : 'transparent',
        color: period === p ? '#fff' : 'var(--text2)', fontWeight: 700,
      }}
      onClick={() => setPeriod(p)}
    >
      {label}
    </button>
  );

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="form-row cols3" style={{ marginBottom: 12 }}>
        <div className="form-group">
          <label>Class</label>
          <select className="form-select" value={cls} onChange={e => { setCls(e.target.value); setModuleId(''); }}>
            {availableClasses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label>Module</label>
          <select className="form-select" value={moduleId} onChange={e => setModuleId(e.target.value)}>
            <option value="">All modules</option>
            {classModules.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label>Date</label>
          <input className="form-input" type="date" value={date} onChange={e => setDate(e.target.value)} />
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'inline-flex', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
          {periodBtn('day', 'Day')}
          {periodBtn('week', 'Week')}
          {periodBtn('month', 'Month')}
        </div>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text1)' }}>
          <i className="fa-solid fa-calendar-day" style={{ marginRight: 6, color: 'var(--accent)' }} />
          {range.label}
        </div>
        <input
          className="form-input"
          placeholder="Search student…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ marginLeft: 'auto', maxWidth: 240 }}
        />
      </div>

      {/* Overall tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 10, marginBottom: 14 }}>
        <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px' }}><div style={{ fontSize: 22, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace" }}>{rows.length}</div><div style={{ fontSize: 11, color: 'var(--text2)', fontWeight: 600 }}>Students</div></div>
        <div style={{ background: '#dafbe1', border: '1px solid #aceebb', borderRadius: 8, padding: '10px 12px' }}><div style={{ fontSize: 22, fontWeight: 700, color: '#1a7f37', fontFamily: "'JetBrains Mono',monospace" }}>{tot.present}</div><div style={{ fontSize: 11, color: '#1a7f37', fontWeight: 600 }}>Present</div></div>
        <div style={{ background: '#ffebe9', border: '1px solid #ffc1ba', borderRadius: 8, padding: '10px 12px' }}><div style={{ fontSize: 22, fontWeight: 700, color: '#cf222e', fontFamily: "'JetBrains Mono',monospace" }}>{tot.absent}</div><div style={{ fontSize: 11, color: '#cf222e', fontWeight: 600 }}>Absent</div></div>
        <div style={{ background: '#fff8c5', border: '1px solid #ffe07c', borderRadius: 8, padding: '10px 12px' }}><div style={{ fontSize: 22, fontWeight: 700, color: '#9a6700', fontFamily: "'JetBrains Mono',monospace" }}>{tot.late}</div><div style={{ fontSize: 11, color: '#9a6700', fontWeight: 600 }}>Late</div></div>
        <div style={{ background: '#ddf4ff', border: '1px solid #addcff', borderRadius: 8, padding: '10px 12px' }}><div style={{ fontSize: 22, fontWeight: 700, color: '#0969da', fontFamily: "'JetBrains Mono',monospace" }}>{overallRate == null ? '—' : `${overallRate}%`}</div><div style={{ fontSize: 11, color: '#0969da', fontWeight: 600 }}>Attendance</div></div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th style={{ width: 30 }}>#</th>
              <th>Student</th>
              <th>ID</th>
              <th style={{ textAlign: 'center' }}>Present</th>
              <th style={{ textAlign: 'center' }}>Absent</th>
              <th style={{ textAlign: 'center' }}>Late</th>
              <th style={{ textAlign: 'center' }}>Registers</th>
              <th style={{ textAlign: 'center' }}>Attendance %</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.s.id}>
                <td style={{ textAlign: 'center', color: 'var(--text2)' }}>{i + 1}</td>
                <td className="td-name">{r.s.name}</td>
                <td style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11 }}>{r.s.studentId}</td>
                <td style={{ textAlign: 'center', color: '#1a7f37', fontWeight: 600 }}>{r.present}</td>
                <td style={{ textAlign: 'center', color: '#cf222e', fontWeight: 600 }}>{r.absent}</td>
                <td style={{ textAlign: 'center', color: '#9a6700', fontWeight: 600 }}>{r.late}</td>
                <td style={{ textAlign: 'center', color: 'var(--text2)' }}>{r.total}</td>
                <td style={{ textAlign: 'center', fontWeight: 700, color: rateColor(r.rate) }}>
                  {r.rate == null ? '—' : `${r.rate}%`}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={8} style={{ textAlign: 'center', padding: 28, color: 'var(--text2)' }}>No students match.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {tot.total === 0 && rows.length > 0 && (
        <div style={{ textAlign: 'center', padding: 14, color: 'var(--text2)', fontSize: 13 }}>
          No attendance was recorded for this class in the selected period.
        </div>
      )}
    </div>
  );
}
