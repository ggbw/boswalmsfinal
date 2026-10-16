import { useState } from 'react';

import { supabase } from '@/integrations/supabase/client';
import type { DB } from '@/data/db';
import { compressImage } from '@/lib/imageCompression';
import {
  IMPORT_COLUMNS, downloadImportTemplate, matchPhotoToStudent, parseImportFile, toStudentInsert,
  type ImportRow,
} from '@/lib/studentImport';

type Toast = (msg: string, type?: string) => void;

/**
 * Import students from an Excel or CSV sheet. Every row is checked and shown
 * before anything is written; only rows without errors are imported.
 */
export function StudentImportDialog({ db, toast, onDone }: { db: DB; toast: Toast; onDone: () => void }) {
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);

  const valid = (rows || []).filter(r => r.errors.length === 0);
  const invalid = (rows || []).filter(r => r.errors.length > 0);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setFileName(file.name);
    try {
      setRows(await parseImportFile(file, db));
    } catch {
      setRows(null);
      toast('Could not read that file. Use the template, saved as .xlsx or .csv.', 'error');
    }
  };

  const doImport = async () => {
    if (valid.length === 0) return;
    setBusy(true);
    const { error } = await supabase.from('students').insert(valid.map((r, i) => toStudentInsert(r, db, i)));
    setBusy(false);
    if (error) { toast(error.message, 'error'); return; }
    toast(`${valid.length} student(s) imported.`, 'success');
    onDone();
  };

  return (
    <div data-testid="student-import-dialog">
      <ol style={{ fontSize: 12, color: 'var(--text2)', margin: '0 0 12px 18px', lineHeight: 1.7 }}>
        <li>Download the template and fill in one student per row. <strong>Student ID</strong> and <strong>Full Name</strong> are required.</li>
        <li>Use the class name exactly as it appears in the system, or leave Class blank to assign later. Dates as YYYY-MM-DD.</li>
        <li>Choose the file, check the preview, then import.</li>
      </ol>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <button className="btn btn-outline btn-sm" data-testid="student-import-template" onClick={downloadImportTemplate}>
          <i className="fa-solid fa-file-arrow-down" /> Download template
        </button>
        <input type="file" accept=".xlsx,.xls,.csv" data-testid="student-import-file"
               onChange={e => onFile(e.target.files?.[0])} />
        {fileName && <span style={{ fontSize: 12, color: 'var(--text2)' }}>{fileName}</span>}
      </div>

      {rows && (
        <>
          <div style={{ fontSize: 12, marginBottom: 8 }} data-testid="student-import-summary">
            <span className="badge badge-active">{valid.length} ready</span>{' '}
            {invalid.length > 0 && <span className="badge badge-fail">{invalid.length} with errors (will be skipped)</span>}
          </div>
          <div className="table-wrap" style={{ maxHeight: 320, overflowY: 'auto', marginBottom: 12 }}>
            <table>
              <thead><tr><th>Row</th><th>{IMPORT_COLUMNS[0]}</th><th>{IMPORT_COLUMNS[1]}</th><th>Class</th><th>Status</th></tr></thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.line} data-testid={`student-import-row-${r.line}`}>
                    <td>{r.line}</td>
                    <td style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11 }}>{r.studentId || '—'}</td>
                    <td>{r.name || '—'}</td>
                    <td>{r.className || <span style={{ color: 'var(--text3)' }}>Assign later</span>}</td>
                    <td>
                      {r.errors.length === 0
                        ? <span className="badge badge-active">Ready</span>
                        : <span style={{ color: 'var(--danger)', fontSize: 11 }}>{r.errors.join('; ')}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button className="btn btn-primary" style={{ width: '100%' }} disabled={busy || valid.length === 0}
                  data-testid="student-import-confirm" onClick={doImport}>
            {busy ? <span data-testid="student-import-loading">Importing…</span> : `Import ${valid.length} student(s)`}
          </button>
        </>
      )}
    </div>
  );
}

interface PhotoMatch { file: File; studentName: string | null; studentRef: string | null; }

/**
 * Upload many student photos at once. Each file is named by the student number
 * (e.g. BCI2026D-01.jpg) and becomes that student's profile photo — the same
 * `<student id>/profile_photo.webp` the gallery and profile page use.
 */
export function StudentPhotoUploadDialog({ db, toast, onDone }: { db: DB; toast: Toast; onDone: () => void }) {
  const [matches, setMatches] = useState<PhotoMatch[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);

  const matched = matches.filter(m => m.studentRef);
  const unmatched = matches.filter(m => !m.studentRef);

  const onFiles = (files: FileList | null) => {
    if (!files) return;
    setMatches([...files].map(file => {
      const s = matchPhotoToStudent(file.name, db);
      return { file, studentName: s?.name ?? null, studentRef: s?.id ?? null };
    }));
  };

  const upload = async () => {
    setBusy(true);
    setProgress(0);
    const failed: string[] = [];
    for (const m of matched) {
      try {
        const compressed = await compressImage(m.file);
        const { error } = await supabase.storage
          .from('student-photos')
          .upload(`${m.studentRef}/profile_photo.webp`, compressed, { contentType: 'image/webp', upsert: true });
        if (error) failed.push(`${m.file.name}: ${error.message}`);
      } catch {
        failed.push(`${m.file.name}: could not process image`);
      }
      setProgress(p => p + 1);
    }
    setBusy(false);
    if (failed.length) {
      toast(`${matched.length - failed.length} photo(s) uploaded, ${failed.length} failed — ${failed[0]}`, 'error');
      return;
    }
    toast(`${matched.length} photo(s) uploaded.`, 'success');
    onDone();
  };

  return (
    <div data-testid="student-photos-dialog">
      <p style={{ fontSize: 12, color: 'var(--text2)', marginTop: 0 }}>
        Name each photo with the student&apos;s ID, e.g. <code>BCI2026D-01.jpg</code>. Each photo becomes that
        student&apos;s profile photo, replacing any existing one.
      </p>
      <input type="file" accept="image/*" multiple data-testid="student-photos-files"
             onChange={e => onFiles(e.target.files)} style={{ marginBottom: 12 }} />

      {matches.length > 0 && (
        <>
          <div style={{ fontSize: 12, marginBottom: 8 }} data-testid="student-photos-summary">
            <span className="badge badge-active">{matched.length} matched</span>{' '}
            {unmatched.length > 0 && <span className="badge badge-fail">{unmatched.length} not matched (will be skipped)</span>}
          </div>
          <div className="table-wrap" style={{ maxHeight: 300, overflowY: 'auto', marginBottom: 12 }}>
            <table>
              <thead><tr><th>File</th><th>Student</th></tr></thead>
              <tbody>
                {matches.map(m => (
                  <tr key={m.file.name}>
                    <td style={{ fontSize: 11 }}>{m.file.name}</td>
                    <td>{m.studentName ?? <span style={{ color: 'var(--danger)', fontSize: 11 }}>No student with this ID</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button className="btn btn-primary" style={{ width: '100%' }} disabled={busy || matched.length === 0}
                  data-testid="student-photos-confirm" onClick={upload}>
            {busy
              ? <span data-testid="student-photos-loading">Uploading {progress}/{matched.length}…</span>
              : `Upload ${matched.length} photo(s)`}
          </button>
        </>
      )}
    </div>
  );
}
