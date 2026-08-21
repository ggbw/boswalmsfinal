/**
 * Timetable.
 *
 * Replaces the previous slot-by-slot builder: an admin uploads a Word or Excel
 * timetable, everyone views it read-only in the page and can download the
 * original, and only an admin can upload or delete.
 *
 * The old `public.timetable` table still holds its 65 slot rows. Nothing reads
 * them any more, but they were left in place rather than dropped — see
 * 20260812090000_timetable_documents.sql.
 */

import { useCallback, useEffect, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { supabase } from '@/integrations/supabase/client';
import TimetableDocumentViewer from '@/components/TimetableDocumentViewer';
import {
  ACCEPT_TIMETABLE, MAX_TIMETABLE_BYTES, TIMETABLE_BUCKET,
  docKind, fetchTimetableDocs, saveTimetableFile, type TimetableDoc,
} from '@/lib/timetableDocs';
import { formatBytes } from '@/lib/uploads';

export default function TimetablePage() {
  const { db, currentUser, toast, showModal, closeModal } = useApp();
  const [docs, setDocs] = useState<TimetableDoc[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Upload and delete are admin-only, matching the RLS policy. Anyone else
  // sees the timetable but no controls.
  const isAdmin = currentUser?.role === 'admin' || currentUser?.role === 'super_admin';

  const load = useCallback(async () => {
    setLoading(true);
    const { docs: rows, error } = await fetchTimetableDocs();
    setLoadError(error);
    setDocs(rows);
    setSelectedId(prev => (prev && rows.some(d => d.id === prev) ? prev : rows[0]?.id ?? null));
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const selected = docs.find(d => d.id === selectedId) || null;
  const isCurrent = selected != null && docs[0]?.id === selected.id;

  // ── Upload ────────────────────────────────────────────────────────────────
  const handleUpload = () => {
    let title = `Timetable — Semester ${db.config.currentSemester} ${db.config.currentYear}`;
    let notes = '';
    let file: File | null = null;
    let busy = false;

    showModal('Upload Timetable', (
      <div>
        <div className="form-group">
          <label>Title *</label>
          <input className="form-input" defaultValue={title} onChange={e => { title = e.target.value; }} />
        </div>
        <div className="form-group">
          <label>Notes (optional)</label>
          <textarea className="form-input" rows={2} placeholder="e.g. Revised after the room changes"
            onChange={e => { notes = e.target.value; }} />
        </div>
        <div className="form-group">
          <label>File *</label>
          <input
            className="form-input"
            type="file"
            accept={ACCEPT_TIMETABLE}
            onChange={e => {
              const f = e.target.files?.[0] || null;
              if (f && docKind(f.name) === 'unknown') {
                toast('Please choose a Word (.docx) or Excel (.xlsx) file.', 'error');
                e.target.value = ''; file = null; return;
              }
              if (f && f.size > MAX_TIMETABLE_BYTES) {
                toast(`That file is ${formatBytes(f.size)}. The limit is ${formatBytes(MAX_TIMETABLE_BYTES)}.`, 'error');
                e.target.value = ''; file = null; return;
              }
              file = f;
            }}
          />
          <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 4 }}>
            Word or Excel, up to {formatBytes(MAX_TIMETABLE_BYTES)}. Everyone will be notified once it's uploaded.
          </div>
        </div>

        <button className="btn btn-primary" style={{ width: '100%', marginTop: 8 }} onClick={async () => {
          if (busy) return;
          if (!title.trim()) { toast('A title is required', 'error'); return; }
          if (!file) { toast('Choose a file to upload', 'error'); return; }
          busy = true;

          const id = 'tt_' + Date.now();
          const path = `${id}/${file.name}`;

          // Upload first. If this fails there is no row claiming a file that
          // isn't there.
          const { error: upErr } = await supabase.storage
            .from(TIMETABLE_BUCKET).upload(path, file, { upsert: true });
          if (upErr) { busy = false; toast('Upload failed: ' + upErr.message, 'error'); return; }

          const { error: rowErr } = await supabase.from('timetable_documents' as never).insert({
            id, title: title.trim(), file_name: file.name, file_path: path,
            file_size: file.size, mime_type: file.type || null,
            academic_year: db.config.currentYear, semester: db.config.currentSemester,
            notes: notes.trim(), uploaded_by: currentUser?.id ?? null,
            uploaded_by_name: currentUser?.name ?? null,
          } as never);

          if (rowErr) {
            await supabase.storage.from(TIMETABLE_BUCKET).remove([path]);
            busy = false;
            toast(rowErr.message, 'error');
            return;
          }

          // Notify everyone. `notifications` is a broadcast table — every
          // signed-in user reads every row — so one insert reaches students and
          // staff alike. A failure here must not fail the upload: the timetable
          // is published either way.
          const { error: noteErr } = await supabase.from('notifications').insert({
            id: 'ntf_' + Date.now(),
            title: 'New timetable published',
            body: `${title.trim()} has been uploaded and is available on the Timetable page.`,
            date: new Date().toISOString().split('T')[0],
            priority: 'high',
            author: currentUser?.name || 'Administration',
          });

          closeModal();
          toast(
            noteErr
              ? 'Timetable uploaded, but the notification could not be sent.'
              : 'Timetable uploaded and everyone has been notified.',
            noteErr ? 'error' : 'success',
          );
          setSelectedId(id);
          load();
        }}>Upload &amp; Notify</button>
      </div>
    ));
  };

  // ── Delete ────────────────────────────────────────────────────────────────
  const handleDelete = (doc: TimetableDoc) => {
    if (!confirm(`Delete "${doc.title}"?\n\nThis removes the file as well and cannot be undone.`)) return;
    (async () => {
      const { error } = await supabase.from('timetable_documents' as never).delete().eq('id', doc.id);
      if (error) { toast(error.message, 'error'); return; }
      // Remove the file too, or the bucket fills with orphans nobody can reach.
      await supabase.storage.from(TIMETABLE_BUCKET).remove([doc.filePath]);
      toast('Timetable deleted', 'success');
      load();
    })();
  };

  const handleDownload = async (doc: TimetableDoc) => {
    const err = await saveTimetableFile(doc);
    if (err) toast(err, 'error');
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Timetable</div>
          <div className="page-sub">
            {loading ? 'Loading…'
              : docs.length === 0 ? 'No timetable published yet'
              : `${docs.length} version${docs.length > 1 ? 's' : ''} · showing ${isCurrent ? 'the current timetable' : 'an earlier version'}`}
          </div>
        </div>
        {isAdmin && (
          <button className="btn btn-primary btn-sm" onClick={handleUpload}>
            <i className="fa-solid fa-upload" /> Upload Timetable
          </button>
        )}
      </div>

      {loadError && (
        <div className="card" style={{ padding: 16, color: '#cf222e', fontSize: 13 }}>
          <i className="fa-solid fa-triangle-exclamation" style={{ marginRight: 8 }} />
          The timetable could not be loaded: {loadError}
        </div>
      )}

      {!loading && !loadError && docs.length === 0 && (
        <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--text2)' }}>
          <i className="fa-solid fa-calendar-days" style={{ fontSize: 30, opacity: 0.35, display: 'block', marginBottom: 12 }} />
          No timetable has been published yet.
          <div style={{ fontSize: 12, marginTop: 6 }}>
            {isAdmin
              ? 'Use Upload Timetable to publish a Word or Excel file. Everyone will be notified.'
              : 'You\'ll be notified as soon as one is published.'}
          </div>
        </div>
      )}

      {docs.length > 0 && (
        <>
          {/* Version picker — only worth showing once there's history. */}
          {docs.length > 1 && (
            <div className="card" style={{ padding: 12, marginBottom: 14 }}>
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--text3)', marginBottom: 8 }}>
                Versions
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {docs.map((d, i) => (
                  <button
                    key={d.id}
                    className={`btn btn-sm ${d.id === selectedId ? 'btn-primary' : 'btn-outline'}`}
                    onClick={() => setSelectedId(d.id)}
                  >
                    {d.title}
                    {i === 0 && <span style={{ marginLeft: 6, fontSize: 10, opacity: 0.8 }}>· current</span>}
                  </button>
                ))}
              </div>
            </div>
          )}

          {selected && (
            <div className="card" style={{ padding: 18 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{selected.title}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--text2)', marginTop: 3 }}>
                    {selected.fileName}
                    {selected.fileSize ? ` · ${formatBytes(selected.fileSize)}` : ''}
                    {selected.uploadedByName ? ` · uploaded by ${selected.uploadedByName}` : ''}
                    {selected.uploadedAt ? ` · ${new Date(selected.uploadedAt).toLocaleDateString('en-GB')}` : ''}
                  </div>
                  {selected.notes && (
                    <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 6 }}>{selected.notes}</div>
                  )}
                  {!isCurrent && (
                    <div style={{ fontSize: 11.5, color: '#9a6700', marginTop: 6 }}>
                      <i className="fa-solid fa-clock-rotate-left" style={{ marginRight: 5 }} />
                      This is a superseded version. The current timetable is “{docs[0].title}”.
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-outline btn-sm" onClick={() => handleDownload(selected)}>
                    <i className="fa-solid fa-download" /> Download
                  </button>
                  {isAdmin && (
                    <button className="btn btn-outline btn-sm" style={{ color: '#f85149' }} onClick={() => handleDelete(selected)}>
                      <i className="fa-solid fa-trash" /> Delete
                    </button>
                  )}
                </div>
              </div>

              {/* Read-only. Nothing on this page edits the document; Download
                  hands over the original file untouched. */}
              <TimetableDocumentViewer doc={selected} />

              <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 12, textAlign: 'right' }}>
                <i className="fa-solid fa-lock" style={{ marginRight: 5 }} />
                View only — download the file to make changes
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
