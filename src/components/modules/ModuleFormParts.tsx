/**
 * Pieces shared by the two module editors (Modules page and Configuration).
 *
 * The class picker used to be a Ctrl+click multi-select whose save DELETED every
 * class link and re-inserted the highlighted ones. One plain click without Ctrl
 * therefore unlinked the module from every other class — that is how "Hot
 * Kitchen" lost its five real classes during UAT. Tick-boxes make the selection
 * visible, and saving now only adds and removes the links that changed.
 */
import { useState } from 'react';
import type { ClassItem } from '@/data/db';

export function ClassChecklist({ classes, initial, onChange }: {
  classes: ClassItem[];
  initial: string[];
  onChange: (ids: string[]) => void;
}) {
  const [sel, setSel] = useState<Set<string>>(new Set(initial));
  const [q, setQ] = useState('');
  const toggle = (id: string) => {
    const next = new Set(sel);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSel(next);
    onChange([...next]);
  };
  const shown = classes.filter(c => !q || c.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div>
      <input className="form-input" placeholder="Filter classes…" value={q} onChange={e => setQ(e.target.value)}
        style={{ marginBottom: 6 }} data-testid="module-class-filter" />
      <div style={{ maxHeight: 150, overflowY: 'auto', border: '1px solid var(--border, #e3e6eb)', borderRadius: 6, padding: '6px 8px' }}>
        {shown.map(c => (
          <label key={c.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 400, fontSize: 13, padding: '3px 0', cursor: 'pointer' }}>
            <input type="checkbox" checked={sel.has(c.id)} onChange={() => toggle(c.id)} data-testid={`module-class-${c.id}`} />
            {c.name} <span style={{ color: 'var(--text2)', fontSize: 11 }}>· Year {c.year} · Semester {c.semester}</span>
          </label>
        ))}
        {shown.length === 0 && <div style={{ fontSize: 12, color: 'var(--text2)' }}>No classes match.</div>}
      </div>
      <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 4 }}>
        {sel.size} class(es) ticked. Saving adds and removes only the classes you changed.
      </div>
    </div>
  );
}

export function CourseworkItemsField({ initial, onChange }: { initial: number | null | undefined; onChange: (n: number | null) => void }) {
  return (
    <div className="form-group">
      <label>Coursework assessments</label>
      <input className="form-input" type="number" min={1} max={20} defaultValue={initial ?? 4} style={{ width: 90 }}
        data-testid="module-coursework-items"
        onChange={e => { const v = parseInt(e.target.value, 10); onChange(Number.isFinite(v) && v > 0 ? v : null); }} />
      <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 4 }}>
        Usually 4 (Test 1, Test 2, Individual and Group Assignment). Each is an equal share of the coursework;
        one not yet marked counts as 0.
      </div>
    </div>
  );
}

