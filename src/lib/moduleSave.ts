/** Saving a module's class links and settings (used by the module editors). */
import { supabase } from '@/integrations/supabase/client';

/** Add/remove only the class links that changed. */
export async function saveModuleClasses(moduleId: string, before: string[], after: string[]): Promise<string | null> {
  const b = new Set(before), a = new Set(after);
  const removed = before.filter(id => !a.has(id));
  const added = after.filter(id => !b.has(id));
  if (removed.length) {
    const { error } = await supabase.from('module_classes').delete().eq('module_id', moduleId).in('class_id', removed);
    if (error) return error.message;
  }
  if (added.length) {
    const { error } = await supabase.from('module_classes').insert(added.map(class_id => ({ module_id: moduleId, class_id })));
    if (error) return error.message;
  }
  return null;
}

/**
 * Update a module row. coursework_items is only sent when it changed, and if
 * the column has not been added on the database yet the rest still saves.
 */
export async function updateModuleRow(
  id: string,
  fields: Record<string, unknown>,
  courseworkItems: number | null | undefined,
  originalItems: number | null | undefined,
): Promise<{ error: string | null; warning: string | null }> {
  const changed = (courseworkItems ?? 4) !== (originalItems ?? 4);
  const payload = changed ? { ...fields, coursework_items: courseworkItems } : fields;
  const { error } = await supabase.from('modules').update(payload as never).eq('id', id);
  if (error && changed && /coursework_items/i.test(error.message)) {
    const warning = 'Saved, but the coursework setting needs the database update (coursework_items) to be applied first.';
    if (Object.keys(fields).length === 0) return { error: null, warning };
    const { error: e2 } = await supabase.from('modules').update(fields as never).eq('id', id);
    return { error: e2?.message ?? null, warning };
  }
  return { error: error?.message ?? null, warning: null };
}
