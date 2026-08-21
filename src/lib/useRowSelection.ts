import { useState, useRef, useCallback } from 'react';

/**
 * Tick-box selection for a table, with shift-click ranges.
 *
 * Both the register and the marks sheet had the same problem: every student had
 * to be handled individually. Marking six absentees was six clicks, and the only
 * bulk control was "all present", which is all-or-nothing and so gets used as a
 * starting point rather than an answer.
 *
 * Shift-click matters more than it sounds. Absences and zeroes cluster in a
 * sorted list — consecutive students on the same row of a seating plan, a whole
 * practical group — so a range is usually what someone actually wants, and
 * ticking twelve boxes one at a time is barely better than twelve clicks.
 *
 * `ids` must be in the order the rows are RENDERED, or a shift-range selects a
 * different set to the one the user drew.
 */
export function useRowSelection(ids: string[]) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const lastIndex = useRef<number | null>(null);

  const toggle = useCallback((id: string, shiftKey = false) => {
    const index = ids.indexOf(id);
    setSelected(prev => {
      const next = new Set(prev);

      if (shiftKey && lastIndex.current !== null && index !== -1) {
        // Extend from the previous anchor. The anchor's own state decides
        // whether the range is being selected or cleared, so shift-clicking
        // back over a range undoes it rather than re-selecting it.
        const [from, to] = [lastIndex.current, index].sort((a, b) => a - b);
        const selecting = !prev.has(id);
        for (let i = from; i <= to; i++) {
          if (selecting) next.add(ids[i]);
          else next.delete(ids[i]);
        }
      } else if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }

      return next;
    });
    if (index !== -1) lastIndex.current = index;
  }, [ids]);

  const toggleAll = useCallback(() => {
    setSelected(prev => (prev.size === ids.length ? new Set() : new Set(ids)));
    lastIndex.current = null;
  }, [ids]);

  const clear = useCallback(() => {
    setSelected(new Set());
    lastIndex.current = null;
  }, []);

  return {
    selected,
    count: selected.size,
    isSelected: (id: string) => selected.has(id),
    allSelected: ids.length > 0 && selected.size === ids.length,
    someSelected: selected.size > 0 && selected.size < ids.length,
    toggle,
    toggleAll,
    clear,
  };
}
