/**
 * Timetable documents.
 *
 * The timetable is an uploaded Word or Excel file rather than slots built in the
 * app. Admins upload and delete; everyone else reads and downloads.
 *
 * Deliberately NOT part of the bulk loader in useDbData — only two screens need
 * it, and the bulk loader is already fetching more than it should.
 */

import { supabase } from '@/integrations/supabase/client';

export const TIMETABLE_BUCKET = 'timetables';
export const MAX_TIMETABLE_BYTES = 10 * 1024 * 1024; // matches the bucket limit

/** Word and Excel only — these are what the viewer can render. */
export const ACCEPT_TIMETABLE = '.xlsx,.xls,.docx,.doc';

export interface TimetableDoc {
  id: string;
  title: string;
  fileName: string;
  filePath: string;
  fileSize: number | null;
  academicYear: number | null;
  semester: number | null;
  notes: string;
  uploadedByName: string;
  uploadedAt: string;
}

export type DocKind = 'excel' | 'word' | 'unknown';

export function docKind(fileName: string): DocKind {
  const ext = (fileName.split('.').pop() || '').toLowerCase();
  if (ext === 'xlsx' || ext === 'xls') return 'excel';
  if (ext === 'docx' || ext === 'doc') return 'word';
  return 'unknown';
}

/** Newest first — the first entry is the timetable currently in force. */
export async function fetchTimetableDocs(): Promise<{ docs: TimetableDoc[]; error: string | null }> {
  const { data, error } = await supabase
    .from('timetable_documents' as never)
    .select('*')
    .order('uploaded_at', { ascending: false });

  if (error) return { docs: [], error: error.message };

  const docs = ((data || []) as Record<string, unknown>[]).map(d => ({
    id: String(d.id),
    title: String(d.title ?? ''),
    fileName: String(d.file_name ?? ''),
    filePath: String(d.file_path ?? ''),
    fileSize: (d.file_size as number) ?? null,
    academicYear: (d.academic_year as number) ?? null,
    semester: (d.semester as number) ?? null,
    notes: String(d.notes ?? ''),
    uploadedByName: String(d.uploaded_by_name ?? ''),
    uploadedAt: String(d.uploaded_at ?? ''),
  }));
  return { docs, error: null };
}

/** Raw bytes, for rendering in the page. */
export async function downloadTimetableBlob(path: string): Promise<{ blob: Blob | null; error: string | null }> {
  const { data, error } = await supabase.storage.from(TIMETABLE_BUCKET).download(path);
  if (error) return { blob: null, error: error.message };
  return { blob: data, error: null };
}

/** Save the file to the viewer's device under its original name. */
export async function saveTimetableFile(doc: TimetableDoc): Promise<string | null> {
  const { blob, error } = await downloadTimetableBlob(doc.filePath);
  if (error || !blob) return error || 'Could not download the file.';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = doc.fileName || 'timetable';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return null;
}
