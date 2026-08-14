/**
 * Registration approvals — the admin half of progression.
 *
 * A student progresses automatically the moment every module they took has a
 * settled outcome; nobody approves that. What an admin approves is the
 * REGISTRATION that follows: which modules they will take, and — for a retake —
 * which class they will sit it with.
 *
 * Approving is the only place the student's year and semester actually move, so
 * it is deliberately one explicit action with everything it will do stated up
 * front.
 */

import { useCallback, useEffect, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { needsAcademicReview, MAX_SEMESTER_ATTEMPTS } from '@/lib/progression';
import { supabase } from '@/integrations/supabase/client';

interface RegModule {
  id: string;
  module_id: string;
  kind: string;
  class_id: string | null;
}

interface Registration {
  id: string;
  student_id: string;
  year: number;
  semester: number;
  status: string;
  note: string | null;
  decision_note: string | null;
  submitted_at: string;
  modules: RegModule[];
}

export default function RegistrationsPage() {
  const { db, currentUser, toast } = useApp();
  const [rows, setRows] = useState<Registration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'pending' | 'all'>('pending');
  const [busyId, setBusyId] = useState<string | null>(null);
  // Which class each retake will be sat with — chosen by the admin per module.
  const [retakeClass, setRetakeClass] = useState<Record<string, string>>({});

  const isAdmin = currentUser?.role === 'admin' || currentUser?.role === 'super_admin';

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: regs, error: regErr }, { data: mods }] = await Promise.all([
      supabase.from('student_registrations' as never).select('*').order('submitted_at', { ascending: false }),
      supabase.from('student_registration_modules' as never).select('*'),
    ]);
    setError(regErr?.message ?? null);
    const byReg: Record<string, RegModule[]> = {};
    ((mods || []) as unknown as RegModule[] & { registration_id: string }[]).forEach((m: any) => {
      (byReg[m.registration_id] ||= []).push(m);
    });
    setRows(((regs || []) as unknown as Registration[]).map(r => ({ ...r, modules: byReg[r.id] || [] })));
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const studentOf = (id: string) => db.students.find(s => s.id === id);

  /**
   * How many times this student has registered for this same year and semester.
   *
   * Shown to the admin because this is where the decision is made. The student
   * sees the same count on their dashboard, but only an administrator can act
   * on it — the system never excludes anyone by itself.
   */
  const attemptsAt = (r: Registration) =>
    rows.filter(x => x.student_id === r.student_id
                  && x.year === r.year && x.semester === r.semester
                  && x.status !== 'rejected').length;
  const moduleName = (id: string) => db.modules.find(m => m.id === id)?.name || id;
  const className = (id: string | null) => (id ? db.classes.find(c => c.id === id)?.name || id : null);

  /** Classes currently offering a module — where a retake can be sat. */
  const classesOffering = (moduleId: string) => {
    const mod = db.modules.find(m => m.id === moduleId);
    return db.classes.filter(c => (mod?.classes || []).includes(c.id));
  };

  const approve = async (r: Registration) => {
    const student = studentOf(r.student_id);
    if (!student) { toast('Student record not found', 'error'); return; }

    const retakes = r.modules.filter(m => m.kind === 'retake');
    const missing = retakes.filter(m => !(retakeClass[m.id] || m.class_id));
    if (missing.length) {
      toast(`Choose which class will run: ${missing.map(m => moduleName(m.module_id)).join(', ')}`, 'error');
      return;
    }

    const attempts = attemptsAt(r);
    if (!confirm(
      (needsAcademicReview(attempts)
        ? `⚠ This is attempt ${attempts} at Year ${r.year} Semester ${r.semester}.\n`
          + `After ${MAX_SEMESTER_ATTEMPTS} attempts this should go to academic review first.\n\n`
        : '') +
      `Approve ${student.name}'s registration?\n\n` +
      `• They move to Year ${r.year} · Semester ${r.semester}\n` +
      (retakes.length ? `• ${retakes.length} retake module(s) enrolled with the chosen class\n` : '') +
      `• They are notified\n\nThis is what actually advances the student.`
    )) return;

    setBusyId(r.id);
    try {
      // 1. Retake enrolments, carrying the class they will sit it with. Without
      //    the class the module's assessments cannot be found and it would read
      //    as unmarked — see classForModule().
      for (const m of retakes) {
        const classId = retakeClass[m.id] || m.class_id;
        const { error: enrErr } = await supabase.from('student_modules').upsert({
          student_id: student.id,
          module_id: m.module_id,
          class_id: classId,
          added_by: currentUser?.name || 'registration',
        } as never, { onConflict: 'student_id,module_id' } as never);
        if (enrErr) throw new Error('Enrolment failed: ' + enrErr.message);

        await supabase.from('student_registration_modules' as never)
          .update({ class_id: classId } as never).eq('id', m.id);
      }

      // 2. The student actually moves. This is the only place it happens.
      const { error: stuErr } = await supabase.from('students')
        .update({ year: r.year, semester: r.semester })
        .eq('id', student.id);
      if (stuErr) throw new Error('Could not update the student record: ' + stuErr.message);

      // 3. Record the decision.
      const { error: regErr } = await supabase.from('student_registrations' as never)
        .update({
          status: 'approved',
          decided_at: new Date().toISOString(),
          decided_by: currentUser?.id ?? null,
        } as never)
        .eq('id', r.id);
      if (regErr) throw new Error(regErr.message);

      // 4. Tell them. user_notifications is per-user — the `notifications` table
      //    is a broadcast every account can read, so it cannot carry this.
      //    A failure here must not undo the approval.
      // Match on EITHER profile link — a profile carrying only student_ref would
      // otherwise resolve to nobody and the student would never learn they had
      // been approved.
      const profile = db.users.find(
        u => (u.studentId && u.studentId === student.studentId)
          || (u.studentRef && u.studentRef === student.id),
      );
      if (profile) {
        await supabase.from('user_notifications' as never).insert({
          user_id: profile.id,
          title: 'Registration approved',
          message: `You are registered for Year ${r.year} Semester ${r.semester}.`
                 + (retakes.length ? ` This includes ${retakes.length} module(s) you are retaking.` : ''),
          type: 'registration',
          related_id: r.id,
        } as never);
      }

      toast(
        profile
          ? `${student.name} moved to Year ${r.year} Semester ${r.semester}`
          : `${student.name} moved to Year ${r.year} Semester ${r.semester} — but they have no login, so no notification was sent.`,
        profile ? 'success' : 'info',
      );
      load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Approval failed', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const reject = async (r: Registration) => {
    const student = studentOf(r.student_id);
    const reason = prompt(`Why is ${student?.name || 'this'} registration not approved?\n\nThe student sees this.`);
    if (reason === null) return;
    if (!reason.trim()) { toast('A reason is required — the student sees it.', 'error'); return; }

    setBusyId(r.id);
    const { error: err } = await supabase.from('student_registrations' as never)
      .update({
        status: 'rejected',
        decision_note: reason.trim(),
        decided_at: new Date().toISOString(),
        decided_by: currentUser?.id ?? null,
      } as never)
      .eq('id', r.id);
    if (err) { toast(err.message, 'error'); setBusyId(null); return; }

    const profile = db.users.find(
      u => (u.studentId && u.studentId === student?.studentId)
        || (u.studentRef && student && u.studentRef === student.id),
    );
    if (profile) {
      await supabase.from('user_notifications' as never).insert({
        user_id: profile.id,
        title: 'Registration not approved',
        message: reason.trim(),
        type: 'registration',
        related_id: r.id,
      } as never);
    }
    toast(profile
      ? 'Registration rejected and the student notified'
      : 'Registration rejected — the student has no login, so no notification was sent.', 'success');
    setBusyId(null);
    load();
  };

  const visible = rows.filter(r => filter === 'all' || r.status === 'pending');
  const pendingCount = rows.filter(r => r.status === 'pending').length;

  if (!isAdmin) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text2)' }}>
        Only administrators can approve registrations.
      </div>
    );
  }

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Registrations</div>
          <div className="page-sub">
            {loading ? 'Loading…' : `${pendingCount} awaiting approval`}
          </div>
        </div>
        <select className="form-select" value={filter} onChange={e => setFilter(e.target.value as 'pending' | 'all')}
                style={{ width: 'auto', fontSize: 11 }}>
          <option value="pending">Awaiting approval ({pendingCount})</option>
          <option value="all">All ({rows.length})</option>
        </select>
      </div>

      {error && (
        <div className="card" style={{ padding: 16, color: '#cf222e', fontSize: 13 }}>
          <i className="fa-solid fa-triangle-exclamation" style={{ marginRight: 8 }} />
          Registrations could not be loaded: {error}
        </div>
      )}

      {!loading && visible.length === 0 && (
        <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--text2)' }}>
          <i className="fa-solid fa-inbox" style={{ fontSize: 28, opacity: 0.35, display: 'block', marginBottom: 10 }} />
          {filter === 'pending' ? 'Nothing awaiting approval.' : 'No registrations yet.'}
          <div style={{ fontSize: 12, marginTop: 6 }}>
            Students register from their dashboard once all their results are in.
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gap: 12 }}>
        {visible.map(r => {
          const student = studentOf(r.student_id);
          const retakes = r.modules.filter(m => m.kind === 'retake');
          return (
            <div key={r.id} className="card" style={{ padding: 18 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{student?.name || r.student_id}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--text2)', marginTop: 3 }}>
                    {student?.studentId} · currently Year {student?.year} Semester {student?.semester}
                    {' → '}
                    <strong>Year {r.year} Semester {r.semester}</strong>
                    {' · '}submitted {new Date(r.submitted_at).toLocaleDateString('en-GB')}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  {(() => {
                    const n = attemptsAt(r);
                    if (n <= 1) return null;
                    const flag = needsAcademicReview(n);
                    return (
                      <span
                        className={`badge ${flag ? 'badge-fail' : 'badge-active'}`}
                        title={flag
                          ? `Attempt ${n} at this semester — at ${MAX_SEMESTER_ATTEMPTS} this needs academic review before approval.`
                          : `Attempt ${n} at this semester.`}
                      >
                        {flag && <i className="fa-solid fa-triangle-exclamation" style={{ marginRight: 5 }} />}
                        Attempt {n}
                      </span>
                    );
                  })()}
                  <span className={`badge ${r.status === 'approved' ? 'badge-pass' : r.status === 'rejected' ? 'badge-fail' : 'badge-active'}`}>
                    {r.status}
                  </span>
                </div>
              </div>

              {retakes.length > 0 && (
                <div style={{ background: 'var(--bg2)', borderRadius: 8, padding: '10px 14px', marginBottom: 12 }}>
                  <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--text3)', marginBottom: 8 }}>
                    Retaking {retakes.length} module(s) — choose the class each will be sat with
                  </div>
                  <div style={{ display: 'grid', gap: 8 }}>
                    {retakes.map(m => {
                      const options = classesOffering(m.module_id);
                      return (
                        <div key={m.id} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 13, minWidth: 200 }}>{moduleName(m.module_id)}</span>
                          {r.status === 'pending' ? (
                            <select
                              className="form-select"
                              style={{ width: 'auto', fontSize: 12 }}
                              value={retakeClass[m.id] || m.class_id || ''}
                              onChange={e => setRetakeClass(prev => ({ ...prev, [m.id]: e.target.value }))}
                            >
                              <option value="">— Choose class —</option>
                              {options.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                          ) : (
                            <span style={{ fontSize: 12, color: 'var(--text2)' }}>{className(m.class_id) || '—'}</span>
                          )}
                          {options.length === 0 && r.status === 'pending' && (
                            <span style={{ fontSize: 11, color: '#9a6700' }}>
                              No class is currently running this module.
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {r.decision_note && (
                <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 10 }}>
                  Decision note: {r.decision_note}
                </div>
              )}

              {r.status === 'pending' && (
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-primary btn-sm" disabled={busyId === r.id} onClick={() => approve(r)}>
                    {busyId === r.id ? 'Working…' : 'Approve & advance'}
                  </button>
                  <button className="btn btn-outline btn-sm" disabled={busyId === r.id} onClick={() => reject(r)}
                          style={{ color: '#f85149' }}>
                    Reject
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
