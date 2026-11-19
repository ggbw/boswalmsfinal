import { useState } from 'react';
import { useApp } from '@/context/AppContext';
import { supabase } from '@/integrations/supabase/client';
import { useAssessmentMarks } from '@/hooks/useAssessmentMarks';
import { buildStudentProgress } from '@/hooks/useStudentProgress';
import { recordClassOutcomes } from '@/lib/recordClassOutcomes';
import { isReadOnlyOversight } from '@/lib/scope';

export default function ProgressionPage() {
  const { db, toast, reloadDb, currentUser } = useApp();
  // Marks for every class on the page. Progression is gated on them, and this
  // used to read db.marks — which is keyed by students.id while the filter used
  // the student number, so it ALWAYS found zero marks and every approval was
  // refused with "has no marks recorded. Cannot approve progression."
  // Nobody could be promoted.
  const { scoreOf, loading: marksLoading } = useAssessmentMarks({
    classIds: db.classes.map(c => c.id),
  });
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
      // Don't judge anyone while marks are still arriving — an empty result set
      // mid-load is indistinguishable from genuinely having no marks.
      if (marksLoading) {
        toast('Marks are still loading — try again in a moment.', 'error');
        return false;
      }

      // Judge with the SAME rules the student's dashboard uses
      // (buildStudentProgress → progression.ts), so staff and student can never
      // see different answers (UAT M3/M4). Approval needs this semester's
      // results settled (every module marked, final exam included, no
      // supplementary outstanding) and the progression rule met.
      const progress = buildStudentProgress(db, student, scoreOf, null);
      if (!progress.settled || !progress.verdict) {
        toast(`${student.name}: ${progress.settledReason} Cannot approve yet.`, 'error');
        return false;
      }
      if (!progress.verdict.mayProgress) {
        toast(`${student.name}: ${progress.verdict.reason}`, 'error');
        return false;
      }

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

  /**
   * Move the class to the semester most of its students are now in, so the
   * class follows the cohort (UAT retest correction 13). Uses the
   * sync_class_period database function (HOD/HOA may call it); if that has not
   * been created yet, admins fall back to a direct update.
   */
  const syncClassPeriod = async (classId: string) => {
    const { data, error } = await supabase.rpc('sync_class_period', { _class_id: classId });
    if (!error) {
      const row = (data as { year: number; semester: number }[] | null)?.[0];
      const cls = db.classes.find(c => c.id === classId);
      if (row && cls && (row.year !== cls.year || row.semester !== cls.semester)) {
        toast(`${cls.name} moved to Year ${row.year} · Semester ${row.semester} with its students.`, 'info');
      }
      return;
    }
    // Only fall back when the database function has not been created yet.
    const missing = error.code === 'PGRST202' || error.code === '42883' || /could not find the function|does not exist/i.test(error.message);
    if (!missing) {
      toast(`Students approved, but the class could not be moved: ${error.message}`, 'error');
      return;
    }
    // Function not there yet: work it out here (works for admins).
    const { data: rows } = await supabase.from('students').select('year,semester,status').eq('class_id', classId);
    const counts = new Map<string, { year: number; semester: number; n: number }>();
    ((rows || []) as { year: number; semester: number; status: string | null }[])
      .filter(r => (r.status || 'active') === 'active')
      .forEach(r => {
        const k = `${r.year}|${r.semester}`;
        const c = counts.get(k) || { year: r.year, semester: r.semester, n: 0 };
        c.n++; counts.set(k, c);
      });
    const top = [...counts.values()].sort((a, b) => b.n - a.n || b.year - a.year || b.semester - a.semester)[0];
    const cls = db.classes.find(c => c.id === classId);
    if (!top || !cls) return;
    if (top.year > cls.year || (top.year === cls.year && top.semester > cls.semester)) {
      const { data: upd, error: upErr } = await supabase.from('classes')
        .update({ year: top.year, semester: top.semester }).eq('id', classId).select('id');
      // Row security can silently update nothing (non-admins): treat that as a failure.
      if (upErr || !upd || upd.length === 0) toast(`Students approved, but ${cls.name} could not be moved to their semester — ask an administrator.`, 'error');
      else toast(`${cls.name} moved to Year ${top.year} · Semester ${top.semester} with its students.`, 'info');
    }
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
    if (action === 'approved' && count > 0) await syncClassPeriod(classId);
    setSelected(prev => ({ ...prev, [classId]: new Set() }));
    setProcessing(false);
    reloadDb();
  };

  // Records each settled student's module outcomes (and announces new
  // supplementaries) for one class — the same step that runs after exam marks
  // are saved, for marks that arrived another way.
  const handleRecordOutcomes = async (classId: string) => {
    setProcessing(true);
    const res = await recordClassOutcomes(db, classId, currentUser?.id ?? null);
    setProcessing(false);
    if (res.errors.length) { toast(`Could not record outcomes: ${res.errors[0]}`, 'error'); return; }
    toast(
      res.studentsSettled === 0
        ? 'No student in this class has all results in yet.'
        : `${res.outcomesWritten} outcome(s) recorded for ${res.studentsSettled} student(s).`,
      'success',
    );
  };

  const handleIndividual = async (studentId: string, classId: string, action: 'approved' | 'rejected') => {
    setProcessing(true);
    const ok = await progressStudent(studentId, classId, action);
    if (ok) toast(`Student ${action}`, 'success');
    if (ok && action === 'approved') await syncClassPeriod(classId);
    setProcessing(false);
    reloadDb();
  };

  return (
    <>
      <div className="page-header">
        <div><div className="page-title">Student Progression / Promotion</div><div className="page-sub">Approve or reject student progression individually or in bulk</div></div>
      </div>
      <div className="notif-banner"><span style={{ fontSize: 16 }}>ℹ️</span><div>HOD and HOA must approve student progression from Semester 1 → Semester 2 and from one academic year to the next.</div></div>

      {db.classes.map(cls => {
        const students = db.students.filter(s => s.classId === cls.id);
        const prog = db.config.programmes.find(p => p.id === cls.programme);
        const nextSem = cls.semester < (prog?.semesters || 2) ? `Year ${cls.year} · Semester ${cls.semester + 1}` : `Year ${cls.year + 1} · Semester 1`;
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
                    {prog?.type} · Year {cls.year} · Semester {cls.semester} → {nextSem}
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
                  {!isReadOnlyOversight(currentUser?.role) && (
                    <button className="btn btn-outline btn-sm" disabled={processing} data-testid="progression-record-outcomes"
                            onClick={() => handleRecordOutcomes(cls.id)}>
                      {processing ? <span data-testid="progression-record-outcomes-loading">Working…</span> : 'Record outcomes'}
                    </button>
                  )}
                  <button className="btn btn-outline btn-sm" onClick={() => selectAll(cls.id, students.map(s => s.id))}>
                    {students.every(s => sel.has(s.id)) ? 'Deselect All' : 'Select All'}
                  </button>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead><tr><th style={{ width: 30 }}></th><th>Name</th><th>Student ID</th><th>Year</th><th>Semester</th><th>Results</th><th>Status</th><th>Action</th></tr></thead>
                    <tbody>
                      {students.map(s => {
                        const pStatus = (s as any).progressionStatus || 'pending';
                        // Outcomes for staff — these used to be visible only on
                        // the student's own dashboard (UAT M3).
                        const pr = marksLoading ? null : buildStudentProgress(db, s, scoreOf, null);
                        const nPass = pr?.standings.filter(x => x.outcome === 'passed').length ?? 0;
                        const supps = pr?.standings.filter(x => x.outcome === 'supp') ?? [];
                        const retakes = pr?.standings.filter(x => x.outcome === 'retake') ?? [];
                        const nPending = pr?.standings.filter(x => x.outcome === null).length ?? 0;
                        return (
                          <tr key={s.id}>
                            <td>
                              <input type="checkbox" checked={sel.has(s.id)} onChange={() => toggleStudent(cls.id, s.id)} />
                            </td>
                            <td className="td-name">{s.name}</td>
                            <td style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11 }}>{s.studentId}</td>
                            <td>{s.year}</td>
                            <td>{s.semester}</td>
                            <td style={{ fontSize: 11, lineHeight: 1.6 }} data-testid="progression-outcomes">
                              {!pr ? '…' : pr.standings.length === 0 ? <span style={{ color: 'var(--text2)' }}>No modules</span> : (<>
                                {nPass > 0 && <span className="badge badge-pass" style={{ marginRight: 4 }}>{nPass} passed</span>}
                                {supps.length > 0 && <span className="badge badge-active" style={{ marginRight: 4 }} title={supps.map(x => x.result.module.name).join(', ')}>{supps.length} supp</span>}
                                {retakes.length > 0 && <span className="badge badge-fail" style={{ marginRight: 4 }} title={retakes.map(x => x.result.module.name).join(', ')}>{retakes.length} retake</span>}
                                {nPending > 0 && <span className="badge badge-pending" title="Not every assessment (including the final exam) is marked yet">{nPending} pending</span>}
                              </>)}
                            </td>
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
