import { useState, useEffect, useRef } from "react";
import { useApp } from "@/context/AppContext";
import { isAdminRole } from '@/lib/scope';
import { supabase } from "@/integrations/supabase/client";
import { ACCEPT_DOCUMENTS, MAX_NOTE_BYTES, checkUpload } from "@/lib/uploads";
import { getLecturerClassIds } from "@/lib/lecturerHelpers";

/*
  SUPABASE SETUP REQUIRED:
  ─────────────────────────
  1. Run this SQL in your Supabase SQL editor:

     CREATE TABLE module_notes (
       id TEXT PRIMARY KEY,
       module_id TEXT NOT NULL,
       title TEXT NOT NULL,
       file_name TEXT NOT NULL,
       file_path TEXT NOT NULL,
       uploaded_by TEXT NOT NULL,
       uploaded_at TIMESTAMPTZ DEFAULT NOW()
     );

  2. Create a storage bucket named: module-notes
     Set it to PUBLIC so students can download files.
*/

interface Note {
  id: string;
  module_id: string;
  title: string;
  file_name: string;
  file_path: string;
  uploaded_by: string;
  uploaded_at: string;
}

export default function NotesPage() {
  const { db, currentUser } = useApp();
  const role = currentUser?.role;
  const isStudent = role === "student";
  const canUpload = isAdminRole(role) || role === "lecturer" || role === "hod" || role === "hoa";

  // Determine which modules to show
  const visibleModules = (() => {
    if (isStudent) {
      const stu = db.students.find((s) => s.studentId === currentUser?.studentId);
      if (!stu || !stu.classId) return [];
      return db.modules.filter((m) => m.classes.includes(stu.classId));
    }
    if (role === "lecturer") {
      const lecClassIds = getLecturerClassIds(db.lecturerModules, currentUser?.id || '');
      return db.modules.filter((m) => m.classes.some((cid) => lecClassIds.includes(cid)));
    }
    return db.modules;
  })();

  const [openModuleId, setOpenModuleId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, Note[]>>({});
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const loadNotes = async (moduleId: string) => {
    setLoadingId(moduleId);
    const { data } = await supabase
      .from("module_notes" as any)
      .select("*")
      .eq("module_id", moduleId)
      .order("uploaded_at", { ascending: false });
    setNotes((prev) => ({ ...prev, [moduleId]: (data || []) as unknown as Note[] }));
    setLoadingId(null);
  };

  const handleOpenModule = (moduleId: string) => {
    if (openModuleId === moduleId) {
      setOpenModuleId(null);
      return;
    }
    setOpenModuleId(moduleId);
    if (!notes[moduleId]) loadNotes(moduleId);
  };

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">
            <i className="fa-solid fa-folder-open" style={{ color: "var(--accent)", marginRight: 8 }} />
            Module Notes
          </div>
          <div className="page-sub">{visibleModules.length} module(s)</div>
        </div>
      </div>

      {visibleModules.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: 40, color: "var(--text2)" }}>
          No modules found.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {visibleModules.map((mod) => {
            const isOpen = openModuleId === mod.id;
            const moduleNotes = notes[mod.id] || [];

            return (
              <div
                key={mod.id}
                className="card"
                style={{ padding: 0, overflow: "hidden" }}
              >
                {/* Folder header */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "14px 20px",
                    cursor: "pointer",
                    background: isOpen ? "var(--bg2)" : "var(--card)",
                    borderBottom: isOpen ? "1px solid var(--border)" : "none",
                  }}
                  onClick={() => handleOpenModule(mod.id)}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <i
                      className={`fa-solid fa-folder${isOpen ? "-open" : ""}`}
                      style={{ color: "#C9A227", fontSize: 20 }}
                    />
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{mod.name}</div>
                      <div style={{ fontSize: 11, color: "var(--text2)", marginTop: 1 }}>
                        {mod.code} · {notes[mod.id] ? `${notes[mod.id].length} file(s)` : "Click to open"}
                      </div>
                    </div>
                  </div>
                  <i
                    className={`fa-solid fa-chevron-${isOpen ? "up" : "down"}`}
                    style={{ color: "var(--text2)", fontSize: 12 }}
                  />
                </div>

                {/* Folder contents */}
                {isOpen && (
                  <div style={{ padding: "16px 20px" }}>
                    {canUpload && (
                      <UploadNote
                        moduleId={mod.id}
                        uploadedBy={currentUser?.name || ""}
                        onUploaded={() => loadNotes(mod.id)}
                      />
                    )}

                    {loadingId === mod.id ? (
                      <div style={{ padding: "20px 0", textAlign: "center", color: "var(--text2)", fontSize: 13 }}>
                        Loading…
                      </div>
                    ) : moduleNotes.length === 0 ? (
                      <div style={{ padding: "20px 0", textAlign: "center", color: "var(--text2)", fontSize: 13 }}>
                        No notes uploaded yet.
                      </div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: canUpload ? 16 : 0 }}>
                        {moduleNotes.map((note) => (
                          <NoteRow
                            key={note.id}
                            note={note}
                            canDelete={canUpload}
                            onDeleted={() => loadNotes(mod.id)}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

// ── Upload component ──────────────────────────────────────────────────────────
function UploadNote({
  moduleId,
  uploadedBy,
  onUploaded,
}: {
  moduleId: string;
  uploadedBy: string;
  onUploaded: () => void;
}) {
  const { toast } = useApp();
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  // A note is either an uploaded file or a link to one. Much teaching material
  // is a URL — a video, a recipe site, a shared document — and uploading a
  // placeholder to carry a link helps nobody.
  const [mode, setMode] = useState<"file" | "link">("file");
  const [linkUrl, setLinkUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const handleUpload = async () => {
    setError("");
    if (!title.trim()) { setError("Title is required."); return; }

    // A note is EITHER a file or a link. Requiring one and only one keeps the
    // list honest: every row has something to open.
    if (mode === "link") {
      const url = linkUrl.trim();
      if (!url) { setError("Paste a link, or switch to File."); return; }
      // Accept a bare domain and make it openable — a link that silently
      // resolves relative to the app is worse than a rejected one.
      const href = /^https?:\/\//i.test(url) ? url : `https://${url}`;
      try { new URL(href); } catch { setError("That doesn't look like a valid link."); return; }

      setUploading(true);
      const { error: dbErr } = await supabase.from("module_notes" as any).insert({
        id: "note_" + Date.now(),
        module_id: moduleId,
        title: title.trim(),
        // file_name doubles as the display label; file_path stays empty because
        // the column is NOT NULL and existing rows depend on that.
        file_name: new URL(href).hostname.replace(/^www\./, ""),
        file_path: "",
        link_url: href,
        uploaded_by: uploadedBy,
        uploaded_at: new Date().toISOString(),
      });
      setUploading(false);
      if (dbErr) { setError(dbErr.message); return; }
      setTitle(""); setLinkUrl("");
      onUploaded();
      return;
    }

    if (!file) { setError("Please select a file."); return; }

    setUploading(true);
    try {
      const path = `${moduleId}/${Date.now()}_${file.name}`;
      const { error: storageErr } = await supabase.storage
        .from("module-notes")
        .upload(path, file);

      if (storageErr) {
        setError(storageErr.message);
        setUploading(false);
        return;
      }

      const { error: dbErr } = await supabase.from("module_notes" as any).insert({
        id: "note_" + Date.now(),
        module_id: moduleId,
        title: title.trim(),
        file_name: file.name,
        file_path: path,
        uploaded_by: uploadedBy,
        uploaded_at: new Date().toISOString(),
      });

      if (dbErr) {
        setError(dbErr.message);
      } else {
        setTitle("");
        setFile(null);
        if (fileRef.current) fileRef.current.value = "";
        onUploaded();
      }
    } catch (e: any) {
      setError(e.message || "Upload failed.");
    }
    setUploading(false);
  };

  return (
    <div
      style={{
        background: "var(--bg2)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: "14px 16px",
      }}
    >
      <div style={{ fontWeight: 600, fontSize: 12, color: "var(--text2)", marginBottom: 10 }}>
        UPLOAD NOTE
      </div>
      {error && (
        <div
          style={{
            background: "#fef2f2",
            border: "1px solid #fca5a5",
            borderRadius: 6,
            padding: "6px 10px",
            fontSize: 12,
            color: "#dc2626",
            marginBottom: 10,
          }}
        >
          {error}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div className="form-group" style={{ marginBottom: 0, flex: "1 1 200px" }}>
          <label style={{ fontSize: 11 }}>Title *</label>
          <input
            className="form-input"
            placeholder="e.g. Week 3 Lecture Notes"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div className="form-group" style={{ marginBottom: 0, flex: "1 1 260px" }}>
          <label style={{ fontSize: 11 }}>{mode === "file" ? "File *" : "Link *"}</label>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            {/* A note is EITHER an upload or a URL. Choosing first means the
                field beside it is never ambiguous about what it wants. */}
            {(["file", "link"] as const).map(m => (
              <button
                key={m}
                type="button"
                className={`btn btn-sm ${mode === m ? "btn-primary" : "btn-outline"}`}
                onClick={() => { setMode(m); setError(""); }}
                title={m === "file" ? "Upload a document" : "Link to something online"}
                aria-pressed={mode === m}
              >
                <i className={`fa-solid ${m === "file" ? "fa-paperclip" : "fa-link"}`} />
              </button>
            ))}

            {mode === "file" ? (
              <>
                <button type="button" className="btn btn-outline btn-sm" onClick={() => fileRef.current?.click()}>
                  <i className="fa-solid fa-upload" style={{ marginRight: 5 }} />
                  {file ? file.name : "Choose File"}
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept={ACCEPT_DOCUMENTS}
                  style={{ display: "none" }}
                  onChange={(e) => {
                    // Nothing checked type or size here before — the bucket had
                    // no limit either, so anything of any size could be uploaded.
                    const f = e.target.files?.[0] || null;
                    const err = f && checkUpload(f, MAX_NOTE_BYTES);
                    if (err) { toast(err, "error"); e.target.value = ""; setFile(null); return; }
                    setFile(f);
                  }}
                />
                {file && <span style={{ fontSize: 11, color: "#16a34a" }}>✓</span>}
              </>
            ) : (
              <input
                className="form-input"
                style={{ flex: "1 1 180px", minWidth: 150 }}
                placeholder="https://…"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleUpload(); }}
              />
            )}
          </div>
        </div>
        <button
          className="btn btn-primary btn-sm"
          onClick={handleUpload}
          disabled={uploading}
          style={{ marginBottom: 0 }}
        >
          {uploading ? "Uploading…" : "Upload"}
        </button>
      </div>
    </div>
  );
}

// ── Note row ──────────────────────────────────────────────────────────────────
function NoteRow({
  note,
  canDelete,
  onDeleted,
}: {
  note: Note;
  canDelete: boolean;
  onDeleted: () => void;
}) {
  const [downloading, setDownloading] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // A link note has no stored file — opening it is the whole action.
  const isLink = !!(note as any).link_url;

  const handleDownload = async () => {
    if (isLink) {
      // noopener/noreferrer: an external page must not get a handle on this tab.
      window.open((note as any).link_url, "_blank", "noopener,noreferrer");
      return;
    }
    setDownloading(true);
    const { data } = await supabase.storage.from("module-notes").download(note.file_path);
    if (data) {
      const url = URL.createObjectURL(data);
      const a = document.createElement("a");
      a.href = url;
      a.download = note.file_name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
    setDownloading(false);
  };

  const handleDelete = async () => {
    if (!confirm(`Delete "${note.title}"?`)) return;
    setDeleting(true);
    // Only files live in storage; a link note has nothing to remove, and calling
    // remove([""]) would be a pointless request that can also error.
    if (!isLink && note.file_path) {
      await supabase.storage.from("module-notes").remove([note.file_path]);
    }
    await supabase.from("module_notes" as any).delete().eq("id", note.id);
    onDeleted();
    setDeleting(false);
  };

  const ext = note.file_name.split(".").pop()?.toLowerCase() || "";
  // A link has no extension worth reading — the chain icon says what it is.
  const icon = isLink ? "fa-link" :
    ext === "pdf" ? "fa-file-pdf" :
    ["doc", "docx"].includes(ext) ? "fa-file-word" :
    ["ppt", "pptx"].includes(ext) ? "fa-file-powerpoint" :
    ["xls", "xlsx"].includes(ext) ? "fa-file-excel" :
    ["jpg", "jpeg", "png", "gif"].includes(ext) ? "fa-file-image" :
    "fa-file";

  const iconColor = isLink ? "#2a78d6" :
    ext === "pdf" ? "#dc2626" :
    ["doc", "docx"].includes(ext) ? "#1d4ed8" :
    ["ppt", "pptx"].includes(ext) ? "#ea580c" :
    ["xls", "xlsx"].includes(ext) ? "#16a34a" :
    "var(--text2)";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "10px 14px",
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        gap: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
        <i className={`fa-solid ${icon}`} style={{ color: iconColor, fontSize: 22, flexShrink: 0 }} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {note.title}
          </div>
          <div style={{ fontSize: 11, color: "var(--text2)", marginTop: 1 }}>
            {note.file_name} · Uploaded by {note.uploaded_by} ·{" "}
            {new Date(note.uploaded_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
          </div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
        <button className="btn btn-primary btn-sm" onClick={handleDownload} disabled={downloading && !isLink}>
          <i className={`fa-solid ${isLink ? "fa-arrow-up-right-from-square" : "fa-download"}`} style={{ marginRight: 5 }} />
          {isLink ? "Open" : downloading ? "…" : "Download"}
        </button>
        {canDelete && (
          <button className="btn btn-danger btn-sm" onClick={handleDelete} disabled={deleting}>
            <i className="fa-solid fa-trash" />
          </button>
        )}
      </div>
    </div>
  );
}
