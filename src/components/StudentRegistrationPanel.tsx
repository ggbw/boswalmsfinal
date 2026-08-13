/**
 * The student's own view of where they stand, and how they register for what's
 * next. Lives on their dashboard, because that is where they will look.
 *
 * Progression is automatic: the moment every module they took has a settled
 * outcome and no supplementary is outstanding, they are told they have passed
 * and invited to register. Nobody approves the progression — an admin only
 * approves the registration that follows.
 */

import { useCallback, useEffect, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { supabase } from '@/integrations/supabase/client';
import { useStudentProgress } from '@/hooks/useStudentProgress';
import { MAX_CARRIED_FAILURES } from '@/lib/progression';
import { recordOutcomes } from '@/lib/recordOutcomes';
import type { Student } from '@/data/db';

interface Registration {
  id: string;
  year: number;
  semester: number;
  status: string;
  decision_note: string | null;
  submitted_at: string;
}

export default function StudentRegistrationPanel({ student }: { student: Student }) {
  const { db, toast, currentUser } = useApp();
  const progress = useStudentProgress(db, student);
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [busy, setBusy] = useState(false);

  const loadRegistrations = useCallback(async () => {
    const { data } = await supabase
      .from('student_registrations' as never)
      .select('id,year,semester,status,decision_note,submitted_at')
      .eq('student_id', student.id)
      .order('submitted_at', { ascending: false });
    setRegistrations((data || []) as unknown as Registration[]);
  }, [student.id]);

  useEffect(() => { loadRegistrations(); }, [loadRegistrations]);

  // Settle the record once results are in, and notify any NEW supplementary.
  // Runs from the student's own dashboard because that is the first moment
  // anyone looks — waiting for an admin to open a screen would mean a student
  // learns of a supplementary later than the system knew about it.
  //
  // recordOutcomes only writes where the outcome CHANGED, so this is cheap on
  // every visit and cannot re-notify about the same supplementary twice.
  const settledKey = progress.settled
    ? progress.standings.map(s => `${s.result.module.id}:${s.outcome}`).join('|')
    : '';
  useEffect(() => {
    if (!settledKey || !progress.settled) return;
    let cancelled = false;
    (async () => {
      const res = await recordOutcomes({
        student,
        standings: progress.standings,
        authUserId: currentUser?.id ?? null,
        decidedBy: null,
      });
      if (!cancelled && res.suppsNotified > 0) {
        toast(`You have ${res.suppsNotified} supplementary exam(s) — see your notifications.`, 'info');
      }
    })();
    return () => { cancelled = true; };
    // settledKey captures both "is settled" and "what the outcomes are", so this
    // re-runs only when a result actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settledKey, student.id]);

  // Where they'd be going next. Semester 1 → 2 within a year, then Year N+1 S1.
  const programme = db.config.programmes.find(p => p.id === student.programme);
  const maxSemester = programme?.semesters || 2;
  const nextSemester = student.semester < maxSemester ? student.semester + 1 : 1;
  const nextYear = student.semester < maxSemester ? student.year : student.year + 1;

  // The end of the programme. Without this a final-year student who passed was
  // invited to register for a year their programme does not have — Year 4 of a
  // three-year course. They have finished; they should be told so.
  const totalYears = programme?.years ?? 0;
  const hasCompleted = totalYears > 0
    && student.year >= totalYears
    && student.semester >= maxSemester;

  const alreadyRegistered = registrations.find(
    r => r.year === nextYear && r.semester === nextSemester && r.status !== 'rejected',
  );
  const lastRejected = registrations.find(
    r => r.year === nextYear && r.semester === nextSemester && r.status === 'rejected',
  );

  const handleRegister = async () => {
    if (busy) return;
    setBusy(true);

    const id = 'reg_' + Date.now();
    const { error } = await supabase.from('student_registrations' as never).insert({
      id,
      student_id: student.id,
      year: nextYear,
      semester: nextSemester,
      status: 'pending',
    } as never);

    if (error) {
      setBusy(false);
      toast(error.message, 'error');
      return;
    }

    // Modules owed carry across as retakes — that is the whole point of being
    // allowed to progress with up to two failures.
    const owedModules = progress.owed.map((s, i) => ({
      id: `${id}_r${i}`,
      registration_id: id,
      module_id: s.result.module.id,
      kind: 'retake',
      class_id: null,
    }));
    if (owedModules.length) {
      await supabase.from('student_registration_modules' as never).insert(owedModules as never);
    }

    setBusy(false);
    toast('Registration submitted. An administrator will review it.', 'success');
    loadRegistrations();
  };

  if (progress.loading) {
    return (
      <div className="card">
        <div className="card-title"><span><i className="fa-solid fa-graduation-cap" /> My Progress</span></div>
        <div style={{ padding: 12, color: 'var(--text2)', fontSize: 12 }}>Loading your results…</div>
      </div>
    );
  }

  const v = progress.verdict;

  return (
    <div className="card">
      <div className="card-title">
        <span><i className="fa-solid fa-graduation-cap" /> My Progress</span>
        <span style={{ fontSize: 11, color: 'var(--text2)' }}>
          Year {student.year} · Semester {student.semester}
        </span>
      </div>

      {/* Still being marked — say so plainly rather than implying a result. */}
      {!progress.settled && (
        <div style={{ padding: '10px 0', fontSize: 13, color: 'var(--text2)', lineHeight: 1.6 }}>
          <i className="fa-solid fa-hourglass-half" style={{ marginRight: 8 }} />
          {progress.settledReason}
          <div style={{ fontSize: 12, marginTop: 4 }}>
            You'll be able to register for next semester once all your results are in.
          </div>
        </div>
      )}

      {/* Discontinued. */}
      {v?.discontinued && (
        <div style={{ background: '#fae9e7', border: '1px solid #f0b8b2', borderRadius: 8, padding: '12px 14px', fontSize: 13, color: '#a8261e', lineHeight: 1.6 }}>
          <strong>You have not met the requirements to continue.</strong>
          <div style={{ marginTop: 4 }}>
            {v.reason} Please speak to the academic office.
          </div>
        </div>
      )}

      {/* Finished the programme — no next semester to register for. */}
      {v?.mayProgress && hasCompleted && (
        <div style={{ background: '#e6eef8', border: '1px solid #b3cbe8', borderRadius: 8, padding: '12px 14px', fontSize: 13, color: '#1c4e8a', lineHeight: 1.6 }}>
          <strong>You have completed your programme.</strong>
          <div style={{ marginTop: 4 }}>
            {v.reason} There is no further semester to register for — the academic
            office will be in touch about your results and graduation.
          </div>
        </div>
      )}

      {/* Passed, with more of the programme to come. */}
      {v?.mayProgress && !hasCompleted && (
        <>
          <div style={{ background: '#e4f3e9', border: '1px solid #a9d9ba', borderRadius: 8, padding: '12px 14px', fontSize: 13, color: '#16693a', lineHeight: 1.6, marginBottom: 12 }}>
            <strong>You have passed. Register for the next semester.</strong>
            <div style={{ marginTop: 4 }}>
              {v.reason} You are progressing to <strong>Year {nextYear} · Semester {nextSemester}</strong>.
            </div>
          </div>

          {alreadyRegistered ? (
            <div className="info-row">
              <span className="info-label">
                Registration for Year {nextYear} Semester {nextSemester}
              </span>
              <span className="info-val">
                <span className={`badge ${alreadyRegistered.status === 'approved' ? 'badge-pass' : 'badge-active'}`}>
                  {alreadyRegistered.status === 'approved' ? 'Approved' : 'Awaiting approval'}
                </span>
              </span>
            </div>
          ) : (
            <>
              {lastRejected?.decision_note && (
                <div style={{ fontSize: 12, color: '#a8261e', marginBottom: 8 }}>
                  Your previous registration was not approved: {lastRejected.decision_note}
                </div>
              )}
              <button className="btn btn-primary" style={{ width: '100%' }} disabled={busy} onClick={handleRegister}>
                {busy ? 'Submitting…' : `Register for Year ${nextYear} · Semester ${nextSemester}`}
              </button>
              {progress.owed.length > 0 && (
                <div style={{ fontSize: 11.5, color: 'var(--text2)', marginTop: 8, lineHeight: 1.5 }}>
                  Your {progress.owed.length} outstanding module(s) will be included so you can retake them
                  when they are next offered.
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* What they owe — shown whatever the verdict, because it is what they act on. */}
      {progress.owed.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--text3)', marginBottom: 8 }}>
            Outstanding ({progress.owed.length} of a permitted {MAX_CARRIED_FAILURES})
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            {progress.owed.map(s => (
              <div key={s.result.module.id} className="info-row">
                <span className="info-label">{s.result.module.name}</span>
                <span className="info-val" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12 }}>
                    {s.result.mark.moduleMark}%
                  </span>
                  {s.outcome === 'supp' ? (
                    <span className="badge badge-active" title="Resit the exam only. Pass mark 50%.">
                      Supplementary exam
                    </span>
                  ) : (
                    <span className="badge badge-fail" title="Retake the module in full when it is next offered.">
                      Retake
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
