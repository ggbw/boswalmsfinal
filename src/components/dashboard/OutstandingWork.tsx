/**
 * The lecturer's outstanding marking, ITEM BY ITEM.
 *
 * UAT retest 18 Nov, correction 14: the dashboard buttons opened the whole
 * Assignments / Exams list, not the item. Each row here opens that exact
 * assignment (its marks or submissions) or that exam's Enter Marks window.
 */
import { useEffect, useMemo, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { supabase } from '@/integrations/supabase/client';
import { SUPP_EXAM_TYPE } from '@/lib/progression';

interface Item { kind: 'assignment' | 'exam' | 'submissions'; id: string; title: string; sub: string; count?: number }

export function OutstandingWork() {
  const { db, currentUser, navigate } = useApp();
  const [marked, setMarked] = useState<Set<string> | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // The (module, class) pairs this lecturer teaches.
  const pairs = useMemo(() => new Set(
    db.lecturerModules.filter(lm => lm.lecturerId === currentUser?.id).map(lm => `${lm.moduleId}|${lm.classId}`),
  ), [db.lecturerModules, currentUser?.id]);
  const mine = <T extends { moduleId: string; classId: string }>(x: T) => pairs.has(`${x.moduleId}|${x.classId}`);
  const assignments = useMemo(() => db.assignments.filter(mine), [db.assignments, pairs]); // eslint-disable-line react-hooks/exhaustive-deps
  // Supplementary exams are sat only by some students, so they are not "unmarked work".
  const exams = useMemo(() => db.exams.filter(e => mine(e) && e.type !== SUPP_EXAM_TYPE), [db.exams, pairs]); // eslint-disable-line react-hooks/exhaustive-deps

  const idsKey = [...assignments.map(a => a.id), ...exams.map(e => e.id)].join(',');
  useEffect(() => {
    const ids = idsKey ? idsKey.split(',') : [];
    if (!ids.length) { setMarked(new Set()); return; }
    let cancelled = false;
    (async () => {
      const found = new Set<string>();
      // One row per mark, so a chunk can pass Supabase's 1,000-row cap: page it.
      for (let i = 0; i < ids.length; i += 150) {
        const chunk = ids.slice(i, i + 150);
        for (let from = 0; from < 200_000; from += 1000) {
          const { data, error } = await supabase.from('assessment_marks').select('id,assessment_id')
            .in('assessment_id', chunk).order('id', { ascending: true }).range(from, from + 999);
          if (error) { if (!cancelled) setLoadError(error.message); return; }
          (data || []).forEach((r: { assessment_id: string }) => found.add(r.assessment_id));
          if (!data || data.length < 1000) break;
        }
      }
      if (!cancelled) { setLoadError(null); setMarked(found); }
    })();
    return () => { cancelled = true; };
  }, [idsKey]);

  const label = (moduleId: string, classId: string) => {
    const m = db.modules.find(x => x.id === moduleId)?.name || 'Module';
    const c = db.classes.find(x => x.id === classId)?.name || '';
    return c ? `${m} · ${c}` : m;
  };

  const items: Item[] = [];
  assignments.forEach(a => {
    const ungraded = db.submissions.filter(s => s.assignmentId === a.id && (s.grade === null || s.grade === undefined)).length;
    if (ungraded > 0) items.push({ kind: 'submissions', id: a.id, title: a.title, sub: label(a.moduleId, a.classId), count: ungraded });
    else if (marked && !marked.has(a.id)) items.push({ kind: 'assignment', id: a.id, title: a.title, sub: label(a.moduleId, a.classId) });
  });
  if (marked) exams.forEach(e => {
    if (!marked.has(e.id)) items.push({ kind: 'exam', id: e.id, title: e.name, sub: `${e.type || 'Exam'} · ${label(e.moduleId, e.classId)}` });
  });

  if (loadError) return <div style={{ fontSize: 12, color: '#cf222e', padding: '6px 0' }}>Could not check your marking: {loadError}</div>;
  if (marked === null) return <div style={{ fontSize: 12, color: 'var(--text2)', padding: '6px 0' }}>Checking your marking…</div>;
  if (!items.length) return <div style={{ fontSize: 12, color: 'var(--text2)', padding: '6px 0' }}>Nothing outstanding — every submission is graded and every assessment has marks.</div>;

  const open = (it: Item) => {
    if (it.kind === 'exam') navigate('exams', { openMarksFor: it.id });
    else navigate('assignments', { openAssignment: it.id, openMarks: it.kind === 'assignment' });
  };

  return (
    <div style={{ display: 'grid', gap: 6, paddingTop: 4 }} data-testid="outstanding-work">
      {items.slice(0, 12).map(it => (
        <div key={it.kind + it.id} className="info-row">
          <span className="info-label">
            <b style={{ fontWeight: 600 }}>{it.title}</b>
            <span style={{ display: 'block', fontSize: 10.5, color: 'var(--text2)' }}>{it.sub}</span>
          </span>
          <span className="info-val">
            <button className="btn btn-outline btn-sm" data-testid={`outstanding-${it.kind}-${it.id}`} onClick={() => open(it)}>
              {it.kind === 'submissions' ? `${it.count} to grade` : it.kind === 'exam' ? 'Enter exam marks' : 'Enter marks'}
            </button>
          </span>
        </div>
      ))}
      {items.length > 12 && <div style={{ fontSize: 11, color: 'var(--text3)' }}>…and {items.length - 12} more.</div>}
    </div>
  );
}
