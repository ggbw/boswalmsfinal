import { useState, useEffect, useMemo, useRef } from "react";
import { useApp } from "@/context/AppContext";
import { supabase } from "@/integrations/supabase/client";
import { compressImage, createThumbnail } from "@/lib/imageCompression";
import { getLecturerClassIds } from "@/lib/lecturerHelpers";
import { buildZip, uniqueName } from "@/lib/zip";

type ViewMode = "folders" | "student" | "custom_folder";

// Reject folder names that would break storage-path parsing. Folder detection
// relies on the absence of a "." in the name, and "/" would nest unintentionally.
function validFolderName(name: string): string | null {
  const n = name.trim();
  if (!n) return null;
  if (n.includes("/") || n.includes(".")) return null;
  return n;
}

export default function PhotoGalleryPage() {
  const { db, currentUser, toast } = useApp();
  const role = currentUser?.role;
  const isStudent = role === "student";
  const canManage = role === "admin" || role === "super_admin" || role === "lecturer"; // upload + delete
  const canView = canManage || role === "hod" || role === "hoy"; // view folders
  const canUploadToOthers = canManage; // keep alias for existing JSX

  // For students: their own student record ID (from studentRef on profile)
  const myStudentId = isStudent ? currentUser?.studentRef || null : null;

  const [search, setSearch] = useState("");
  const [classFilter, setClassFilter] = useState("");
  const [photoMap, setPhotoMap] = useState<Record<string, string[]>>({});
  const [thumbMap, setThumbMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>(isStudent ? "student" : canView ? "folders" : "folders");
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(isStudent ? myStudentId : null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [zipping, setZipping] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [folderPrompt, setFolderPrompt] = useState<FileList | null>(null);
  const [folderNameInput, setFolderNameInput] = useState("");
  const [customFolders, setCustomFolders] = useState<string[]>([]);
  const [selectedCustomFolder, setSelectedCustomFolder] = useState<string | null>(null);
  // Per-student named subfolders (the "folders inside a student's bucket").
  const [studentSubfolders, setStudentSubfolders] = useState<Record<string, string[]>>({});
  const [studentRootPhotos, setStudentRootPhotos] = useState<Record<string, string[]>>({});
  // When viewing a student's subfolder we reuse the custom-folder view; this
  // remembers which student to return to.
  const [folderParent, setFolderParent] = useState<string | null>(null);
  const [createSubfolderModal, setCreateSubfolderModal] = useState(false);
  const [newSubfolderName, setNewSubfolderName] = useState("");
  const [createFolderModal, setCreateFolderModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [renameModal, setRenameModal] = useState<{ oldName: string } | null>(null);
  const [renameInput, setRenameInput] = useState("");
  const [deleteFolderConfirm, setDeleteFolderConfirm] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const profileInputRef = useRef<HTMLInputElement>(null);
  const customFileInputRef = useRef<HTMLInputElement>(null);

  const loadPhotos = async () => {
    setLoading(true);
    const { data: files } = await supabase.storage.from("student-photos").list("", { limit: 2000 });
    if (!files) {
      setLoading(false);
      return;
    }

    // Folders have no file extension and metadata.size is 0 or null
    // In Supabase storage, folders appear as items with no "." in the name
    const studentIds = new Set(db.students.map((s) => s.id));
    const allFolders = files.filter((f) => !f.name.includes("."));
    const folders = allFolders.filter((f) => studentIds.has(f.name));
    const customFolderNames = allFolders.filter((f) => !studentIds.has(f.name)).map((f) => f.name);
    setCustomFolders(customFolderNames);
    const allPhotos: Record<string, string[]> = {};
    const thumbs: Record<string, string> = {};
    const rootPhotos: Record<string, string[]> = {};
    const subfolderNames: Record<string, string[]> = {};

    await Promise.all(
      folders.map(async (folder) => {
        const { data: inner } = await supabase.storage.from("student-photos").list(folder.name, { limit: 200 });
        if (!inner || inner.length === 0) return;

        const subfolders = inner.filter((f) => !f.name.includes("."));
        const photoFiles = inner.filter(
          (f) => f.name.endsWith(".webp") && !f.name.startsWith("thumb_") && !f.name.startsWith("profile_"),
        );
        const thumbFiles = inner.filter((f) => f.name.startsWith("thumb_"));
        const profileFile = inner.find((f) => f.name.startsWith("profile_"));

        // Photos sitting directly in the student folder (not in a named subfolder).
        const rootUrls = photoFiles.map((f) => {
          const { data } = supabase.storage.from("student-photos").getPublicUrl(`${folder.name}/${f.name}`);
          return data.publicUrl;
        });
        rootPhotos[folder.name] = rootUrls;

        // Named subfolders: each is addressed by the path key "studentId/subName"
        // so the existing custom-folder view can render/upload to it directly.
        const galleryUrls = [...rootUrls];
        const subNames: string[] = [];
        await Promise.all(
          subfolders.map(async (sub) => {
            const { data: subFiles } = await supabase.storage
              .from("student-photos")
              .list(`${folder.name}/${sub.name}`, { limit: 200 });
            subNames.push(sub.name);
            const subUrls = (subFiles || [])
              .filter((f) => f.name.endsWith(".webp") && !f.name.startsWith("thumb_") && !f.name.startsWith("profile_"))
              .map((f) => {
                const { data } = supabase.storage
                  .from("student-photos")
                  .getPublicUrl(`${folder.name}/${sub.name}/${f.name}`);
                return data.publicUrl;
              });
            const pathKey = `${folder.name}/${sub.name}`;
            allPhotos[pathKey] = subUrls;
            if (subUrls.length > 0) thumbs[pathKey] = subUrls[0];
            galleryUrls.push(...subUrls);
          }),
        );
        subfolderNames[folder.name] = subNames.sort((a, b) => a.localeCompare(b));

        allPhotos[folder.name] = galleryUrls;

        // Thumbnail priority: profile photo > thumb_ > first gallery photo
        if (profileFile) {
          const { data } = supabase.storage.from("student-photos").getPublicUrl(`${folder.name}/${profileFile.name}`);
          thumbs[folder.name] = data.publicUrl;
        } else if (thumbFiles.length > 0) {
          const { data } = supabase.storage.from("student-photos").getPublicUrl(`${folder.name}/${thumbFiles[0].name}`);
          thumbs[folder.name] = data.publicUrl;
        } else if (galleryUrls.length > 0) {
          thumbs[folder.name] = galleryUrls[0];
        }
      }),
    );

    setPhotoMap(allPhotos);
    setThumbMap(thumbs);
    setStudentRootPhotos(rootPhotos);
    setStudentSubfolders(subfolderNames);
    setLoading(false);
  };

  useEffect(() => {
    loadPhotos();
  }, []);

  // If student, auto-open their own folder
  useEffect(() => {
    if (isStudent && myStudentId && !loading) {
      setSelectedStudentId(myStudentId);
      setViewMode("student");
    }
  }, [isStudent, myStudentId, loading]);

  // Scope: lecturers see only their own classes; admin/hod/hoy see all
  const allowedClassIds = useMemo(() => {
    if (role !== "lecturer") return null;
    return getLecturerClassIds(db.lecturerModules, currentUser?.id || '');
  }, [role, db.lecturerModules, currentUser]);

  const visibleClasses = allowedClassIds ? db.classes.filter((c) => allowedClassIds.includes(c.id)) : db.classes;

  const filteredStudents = useMemo(() => {
    return db.students.filter((s) => {
      if (allowedClassIds && !allowedClassIds.includes(s.classId)) return false;
      if (classFilter && s.classId !== classFilter) return false;
      if (
        search &&
        !s.name.toLowerCase().includes(search.toLowerCase()) &&
        !s.studentId.toLowerCase().includes(search.toLowerCase())
      )
        return false;
      return true;
    });
  }, [db.students, classFilter, search, allowedClassIds]);

  // Custom folders also respond to the search box (previously only student
  // folders were filtered).
  const filteredCustomFolders = useMemo(
    () => customFolders.filter((n) => !search || n.toLowerCase().includes(search.toLowerCase())),
    [customFolders, search],
  );

  const selectedStudent = selectedStudentId ? db.students.find((s) => s.id === selectedStudentId) : null;
  const selectedPhotos = selectedStudentId ? photoMap[selectedStudentId] || [] : [];
  const profilePhotoUrl = selectedStudentId ? thumbMap[selectedStudentId] : null;

  // Check if profile photo exists for selected student
  const hasProfilePhoto = !!profilePhotoUrl;

  // Upload gallery photos (admin/lecturer only)
  const handleUpload = async (files: FileList, subfolder?: string) => {
    if (!selectedStudentId || !selectedStudent) return;
    setUploading(true);
    let success = 0;
    const folderPath = subfolder ? `${selectedStudentId}/${subfolder}` : selectedStudentId;

    for (const file of Array.from(files)) {
      try {
        const [compressed, thumb] = await Promise.all([compressImage(file), createThumbnail(file)]);
        const ts = Date.now() + Math.floor(Math.random() * 1000);
        const photoPath = `${folderPath}/${ts}.webp`;
        const thumbPath = `${folderPath}/thumb_${ts}.webp`;

        const [r1, r2] = await Promise.all([
          supabase.storage
            .from("student-photos")
            .upload(photoPath, compressed, { contentType: "image/webp", upsert: false }),
          supabase.storage
            .from("student-photos")
            .upload(thumbPath, thumb, { contentType: "image/webp", upsert: false }),
        ]);

        if (r1.error || r2.error) {
          toast(`Failed to upload ${file.name}`, "error");
        } else {
          success++;
        }
      } catch {
        toast(`Error processing ${file.name}`, "error");
      }
    }

    if (success > 0) {
      toast(`Uploaded ${success} photo(s)`, "success");
      await loadPhotos();
    }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // Upload profile photo (student only — replaces existing)
  const handleProfileUpload = async (files: FileList) => {
    if (!myStudentId) return;
    const file = files[0];
    if (!file) return;
    setUploading(true);

    try {
      // Remove old profile photo first
      const { data: existing } = await supabase.storage.from("student-photos").list(myStudentId, { limit: 20 });
      if (existing) {
        const oldProfile = existing.filter((f) => f.name.startsWith("profile_"));
        if (oldProfile.length > 0) {
          await supabase.storage.from("student-photos").remove(oldProfile.map((f) => `${myStudentId}/${f.name}`));
        }
      }

      const compressed = await compressImage(file);
      const profilePath = `${myStudentId}/profile_photo.webp`;
      const { error } = await supabase.storage
        .from("student-photos")
        .upload(profilePath, compressed, { contentType: "image/webp", upsert: true });

      if (error) {
        toast("Failed to upload profile photo", "error");
      } else {
        toast("Profile photo updated!", "success");
        await loadPhotos();
      }
    } catch {
      toast("Error processing image", "error");
    }

    setUploading(false);
    if (profileInputRef.current) profileInputRef.current.value = "";
  };

  const handleDelete = async (url: string) => {
    if (!selectedStudentId) return;
    try {
      const urlObj = new URL(url);
      const pathParts = urlObj.pathname.split(`/student-photos/`);
      if (pathParts.length < 2) return;
      const filePath = decodeURIComponent(pathParts[1].split("?")[0]);
      const filename = filePath.split("/").pop() || "";
      // Directory the photo lives in (root, a student subfolder, or a custom
      // folder) — the matching thumbnail sits alongside it.
      const dir = filePath.includes("/") ? filePath.slice(0, filePath.lastIndexOf("/") + 1) : "";
      const toDelete = [filePath];
      if (!filename.startsWith("thumb_") && !filename.startsWith("profile_")) {
        toDelete.push(`${dir}thumb_${filename}`);
      }
      await supabase.storage.from("student-photos").remove(toDelete);
      toast("Photo deleted", "success");
      await loadPhotos();
    } catch {
      toast("Failed to delete photo", "error");
    }
    setDeleteConfirm(null);
  };

  const handleDownloadPhoto = async (url: string, studentName: string, index: number) => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `${studentName.replace(/\s+/g, "_")}_photo_${index + 1}.webp`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);
    } catch {
      toast("Failed to download", "error");
    }
  };

  // Bundle a whole folder into a single .zip and download it in one go
  // (previously this fired one browser download per photo).
  const handleDownloadAll = async (photos: string[], folderName: string) => {
    if (photos.length === 0) return;
    setZipping(true);
    try {
      const used = new Set<string>();
      const entries: { name: string; data: Uint8Array }[] = [];
      let failed = 0;
      const safeFolder = folderName.replace(/[^a-zA-Z0-9._-]+/g, "_");
      for (let i = 0; i < photos.length; i++) {
        try {
          const res = await fetch(photos[i]);
          if (!res.ok) throw new Error(String(res.status));
          const buf = new Uint8Array(await res.arrayBuffer());
          entries.push({ name: uniqueName(`${safeFolder}_${i + 1}.webp`, used), data: buf });
        } catch {
          failed++;
        }
      }
      if (entries.length === 0) {
        toast("Failed to download photos", "error");
        return;
      }
      const blob = buildZip(entries);
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `${safeFolder}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);
      toast(
        failed > 0
          ? `Downloaded ${entries.length} photo(s); ${failed} failed`
          : `Downloaded ${entries.length} photo(s) as a zip`,
        failed > 0 ? "error" : "success",
      );
    } finally {
      setZipping(false);
    }
  };

  const handleCreateFolder = async () => {
    const name = validFolderName(newFolderName);
    if (!name) { toast("Enter a valid folder name (no '/' or '.')", "error"); return; }
    // Create folder by uploading a hidden placeholder file
    const placeholder = new Blob([""], { type: "text/plain" });
    const { error } = await supabase.storage
      .from("student-photos")
      .upload(`${name}/.keep`, placeholder, { upsert: false });
    if (error && !error.message.includes("already exists")) {
      toast(error.message, "error"); return;
    }
    toast(`Folder "${name}" created!`, "success");
    setCreateFolderModal(false);
    setNewFolderName("");
    await loadPhotos();
  };

  // Create a named folder INSIDE the selected student's bucket.
  const handleCreateSubfolder = async () => {
    if (!selectedStudentId) return;
    const name = validFolderName(newSubfolderName);
    if (!name) { toast("Enter a valid folder name (no '/' or '.')", "error"); return; }
    const placeholder = new Blob([""], { type: "text/plain" });
    const { error } = await supabase.storage
      .from("student-photos")
      .upload(`${selectedStudentId}/${name}/.keep`, placeholder, { upsert: false });
    if (error && !error.message.includes("already exists")) {
      toast(error.message, "error"); return;
    }
    toast(`Folder "${name}" created!`, "success");
    setCreateSubfolderModal(false);
    setNewSubfolderName("");
    await loadPhotos();
  };

  // Open a student's named subfolder. Reuses the custom-folder view via a
  // "studentId/subName" path key, remembering the parent student for back-nav.
  const openSubfolder = (studentId: string, sub: string) => {
    setFolderParent(studentId);
    setSelectedCustomFolder(`${studentId}/${sub}`);
    setViewMode("custom_folder");
    setLightboxUrl(null);
    setDeleteConfirm(null);
  };

  const handleRenameFolder = async (oldName: string, newName: string) => {
    newName = newName.trim();
    if (!newName || newName === oldName) { setRenameModal(null); return; }
    // List all files in the old folder
    const { data: files } = await supabase.storage.from("student-photos").list(oldName, { limit: 500 });
    if (!files) { toast("Could not list folder contents", "error"); return; }
    // Copy each file to new folder
    const errors: string[] = [];
    for (const f of files) {
      const { error } = await supabase.storage.from("student-photos").copy(`${oldName}/${f.name}`, `${newName}/${f.name}`);
      if (error) errors.push(f.name);
    }
    if (errors.length) { toast(`Failed to move ${errors.length} file(s)`, "error"); return; }
    // Delete old folder files
    await supabase.storage.from("student-photos").remove(files.map((f) => `${oldName}/${f.name}`));
    toast(`Renamed to "${newName}"`, "success");
    setRenameModal(null);
    setRenameInput("");
    if (selectedCustomFolder === oldName) setSelectedCustomFolder(newName);
    await loadPhotos();
  };

  const handleDeleteFolder = async (name: string) => {
    const { data: files } = await supabase.storage.from("student-photos").list(name, { limit: 500 });
    if (files && files.length > 0) {
      await supabase.storage.from("student-photos").remove(files.map((f) => `${name}/${f.name}`));
    }
    toast(`Folder "${name}" deleted`, "success");
    setDeleteFolderConfirm(null);
    await loadPhotos();
  };

  const handleCustomUpload = async (files: FileList, folderName: string) => {
    setUploading(true);
    let success = 0;
    for (const file of Array.from(files)) {
      try {
        const [compressed, thumb] = await Promise.all([compressImage(file), createThumbnail(file)]);
        const ts = Date.now() + Math.floor(Math.random() * 1000);
        const [r1, r2] = await Promise.all([
          supabase.storage.from("student-photos").upload(`${folderName}/${ts}.webp`, compressed, { contentType: "image/webp", upsert: false }),
          supabase.storage.from("student-photos").upload(`${folderName}/thumb_${ts}.webp`, thumb, { contentType: "image/webp", upsert: false }),
        ]);
        if (r1.error || r2.error) { toast(`Failed to upload ${file.name}`, "error"); } else { success++; }
      } catch { toast(`Error processing ${file.name}`, "error"); }
    }
    if (success > 0) { toast(`Uploaded ${success} photo(s)`, "success"); await loadPhotos(); }
    setUploading(false);
    if (customFileInputRef.current) customFileInputRef.current.value = "";
  };

  const openStudent = (studentId: string) => {
    setSelectedStudentId(studentId);
    setViewMode("student");
  };

  const backToFolders = () => {
    setViewMode("folders");
    setSelectedStudentId(null);
    setSelectedCustomFolder(null);
    setFolderParent(null);
    setLightboxUrl(null);
    setDeleteConfirm(null);
  };

  // Return from a student's subfolder back to that student's folder view.
  const backToStudent = () => {
    setViewMode("student");
    setSelectedStudentId(folderParent);
    setSelectedCustomFolder(null);
    setFolderParent(null);
    setLightboxUrl(null);
    setDeleteConfirm(null);
  };

  // Access guard — applicants / unknown roles see nothing
  if (!isStudent && !canView) {
    return (
      <div className="card" style={{ textAlign: "center", padding: 60, color: "var(--text2)" }}>
        <i className="fa-solid fa-lock" style={{ fontSize: 40, marginBottom: 12, display: "block" }} />
        <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text1)" }}>Access Restricted</div>
        <div style={{ fontSize: 13, marginTop: 6 }}>You don't have permission to view the photo gallery.</div>
      </div>
    );
  }

  // ── CUSTOM FOLDER VIEW ──────────────────────────────────────────────────────
  if (viewMode === "custom_folder" && selectedCustomFolder) {
    const photos = photoMap[selectedCustomFolder] || [];
    // For a student subfolder the key is "studentId/subName"; show just the
    // folder name and name the parent student. Plain custom folders have no "/".
    const folderDisplayName = selectedCustomFolder.split("/").pop() || selectedCustomFolder;
    const parentStudent = folderParent ? db.students.find((s) => s.id === folderParent) : null;
    return (
      <>
        <style>{`.photo-card:hover .photo-overlay { opacity: 1 !important; }`}</style>

        {lightboxUrl && (
          <div onClick={() => setLightboxUrl(null)} style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.93)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <button onClick={() => setLightboxUrl(null)} style={{ position: "absolute", top: 20, right: 20, background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", borderRadius: 8, padding: "8px 14px", cursor: "pointer", fontSize: 18, fontWeight: 700 }}>✕</button>
            <img src={lightboxUrl} alt="Full size" style={{ maxWidth: "90vw", maxHeight: "90vh", borderRadius: 8, objectFit: "contain" }} onClick={(e) => e.stopPropagation()} />
          </div>
        )}

        {deleteConfirm && (
          <div style={{ position: "fixed", inset: 0, zIndex: 900, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div className="card" style={{ padding: 28, maxWidth: 380, width: "90%", textAlign: "center" }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>🗑️</div>
              <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 8 }}>Delete Photo?</div>
              <div style={{ color: "var(--text2)", fontSize: 13, marginBottom: 20 }}>This cannot be undone.</div>
              <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
                <button className="btn btn-outline btn-sm" onClick={() => setDeleteConfirm(null)}>Cancel</button>
                <button className="btn btn-sm" style={{ background: "#dc2626", color: "#fff", border: "none" }} onClick={() => handleDelete(deleteConfirm)}>Delete</button>
              </div>
            </div>
          </div>
        )}

        <div className="page-header" style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <button className="btn btn-outline btn-sm" onClick={folderParent ? backToStudent : backToFolders}>
            <i className="fa-solid fa-arrow-left" /> {parentStudent ? `Back to ${parentStudent.name}` : "Back to Gallery"}
          </button>
          <div>
            <div className="page-title" style={{ margin: 0 }}>{folderDisplayName}</div>
            <div style={{ fontSize: 12, color: "var(--text2)" }}>
              {parentStudent ? `Folder in ${parentStudent.name}'s gallery` : "Custom folder"}
            </div>
          </div>
        </div>

        <div className="card" style={{ marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div style={{ color: "var(--text2)", fontSize: 13 }}>
            <i className="fa-solid fa-images" style={{ marginRight: 6, color: "var(--accent)" }} />
            <strong style={{ color: "var(--text1)" }}>{photos.length}</strong> photo{photos.length !== 1 ? "s" : ""}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {photos.length > 0 && (
              <button className="btn btn-outline btn-sm" onClick={() => handleDownloadAll(photos, folderDisplayName)} disabled={zipping}>
                {zipping ? <><i className="fa-solid fa-spinner fa-spin" /> Zipping...</> : <><i className="fa-solid fa-download" /> Download Folder (.zip)</>}
              </button>
            )}
            {canManage && (
              <>
                <input ref={customFileInputRef} type="file" accept="image/*" multiple style={{ display: "none" }}
                  onChange={(e) => { if (e.target.files) handleCustomUpload(e.target.files, selectedCustomFolder); }} />
                <button className="btn btn-primary btn-sm" onClick={() => customFileInputRef.current?.click()} disabled={uploading}>
                  {uploading ? <><i className="fa-solid fa-spinner fa-spin" /> Uploading...</> : <><i className="fa-solid fa-cloud-arrow-up" /> Upload Photos</>}
                </button>
              </>
            )}
          </div>
        </div>

        {photos.length === 0 ? (
          <div className="card" style={{ textAlign: "center", padding: 60, color: "var(--text2)" }}>
            <div style={{ fontSize: 52, marginBottom: 12 }}>📷</div>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6, color: "var(--text1)" }}>No photos yet</div>
            {canManage && <div style={{ fontSize: 13 }}>Click <strong>Upload Photos</strong> to add photos to this folder.</div>}
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
            {photos.map((url, i) => (
              <div key={i} className="photo-card" style={{ borderRadius: 10, overflow: "hidden", background: "var(--bg3)", aspectRatio: "1", position: "relative", cursor: "pointer", boxShadow: "0 2px 8px rgba(0,0,0,0.25)" }}>
                <img src={url} alt={`photo ${i + 1}`} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} onClick={() => setLightboxUrl(url)} />
                <div className="photo-overlay" style={{ position: "absolute", bottom: 0, left: 0, right: 0, background: "linear-gradient(transparent, rgba(0,0,0,0.78))", padding: "28px 8px 8px", display: "flex", gap: 6, justifyContent: "flex-end", opacity: 0, transition: "opacity 0.2s" }}>
                  <button onClick={(e) => { e.stopPropagation(); setLightboxUrl(url); }} style={{ background: "rgba(255,255,255,0.2)", border: "none", color: "#fff", borderRadius: 6, padding: "5px 9px", cursor: "pointer", fontSize: 12 }}><i className="fa-solid fa-expand" /></button>
                  <button onClick={(e) => { e.stopPropagation(); handleDownloadPhoto(url, folderDisplayName, i); }} style={{ background: "rgba(255,255,255,0.2)", border: "none", color: "#fff", borderRadius: 6, padding: "5px 9px", cursor: "pointer", fontSize: 12 }}><i className="fa-solid fa-download" /></button>
                  {canManage && <button onClick={(e) => { e.stopPropagation(); setDeleteConfirm(url); }} style={{ background: "rgba(220,38,38,0.8)", border: "none", color: "#fff", borderRadius: 6, padding: "5px 9px", cursor: "pointer", fontSize: 12 }}><i className="fa-solid fa-trash" /></button>}
                </div>
              </div>
            ))}
            {canManage && (
              <div onClick={() => customFileInputRef.current?.click()} style={{ borderRadius: 10, border: "2px dashed var(--accent)", aspectRatio: "1", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "var(--accent)", background: "rgba(99,102,241,0.05)", gap: 8 }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(99,102,241,0.14)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(99,102,241,0.05)")}>
                <i className="fa-solid fa-plus" style={{ fontSize: 28 }} />
                <span style={{ fontSize: 12, fontWeight: 600 }}>Add Photos</span>
              </div>
            )}
          </div>
        )}
      </>
    );
  }

  // ── STUDENT FOLDER VIEW ─────────────────────────────────────────────────────
  if (viewMode === "student" && selectedStudent) {
    const cls = db.classes.find((c) => c.id === selectedStudent.classId);
    const isOwnFolder = isStudent && myStudentId === selectedStudentId;
    const subfolders = selectedStudentId ? studentSubfolders[selectedStudentId] || [] : [];
    const rootPhotos = selectedStudentId ? studentRootPhotos[selectedStudentId] || [] : [];

    return (
      <>
        <style>{`
          .photo-card:hover .photo-overlay { opacity: 1 !important; }
          .folder-card { transition: transform 0.15s, box-shadow 0.15s; }
          .folder-card:hover { transform: translateY(-3px); box-shadow: 0 8px 24px rgba(0,0,0,0.4); }
        `}</style>

        {/* Lightbox */}
        {lightboxUrl && (
          <div
            onClick={() => setLightboxUrl(null)}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 1000,
              background: "rgba(0,0,0,0.93)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <button
              onClick={() => setLightboxUrl(null)}
              style={{
                position: "absolute",
                top: 20,
                right: 20,
                background: "rgba(255,255,255,0.15)",
                border: "none",
                color: "#fff",
                borderRadius: 8,
                padding: "8px 14px",
                cursor: "pointer",
                fontSize: 18,
                fontWeight: 700,
              }}
            >
              ✕
            </button>
            <img
              src={lightboxUrl}
              alt="Full size"
              style={{ maxWidth: "90vw", maxHeight: "90vh", borderRadius: 8, objectFit: "contain" }}
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        )}

        {/* Delete confirm */}
        {deleteConfirm && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 900,
              background: "rgba(0,0,0,0.7)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div className="card" style={{ padding: 28, maxWidth: 380, width: "90%", textAlign: "center" }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>🗑️</div>
              <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 8, color: "var(--text1)" }}>Delete Photo?</div>
              <div style={{ color: "var(--text2)", fontSize: 13, marginBottom: 20 }}>This cannot be undone.</div>
              <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
                <button className="btn btn-outline btn-sm" onClick={() => setDeleteConfirm(null)}>
                  Cancel
                </button>
                <button
                  className="btn btn-sm"
                  style={{ background: "#dc2626", color: "#fff", border: "none" }}
                  onClick={() => handleDelete(deleteConfirm)}
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Folder name prompt */}
        {folderPrompt && (
          <div
            style={{
              position: "fixed", inset: 0, zIndex: 900,
              background: "rgba(0,0,0,0.7)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            <div className="card" style={{ padding: 28, maxWidth: 400, width: "90%" }}>
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6, color: "var(--text1)" }}>
                Upload Photos
              </div>
              <div style={{ fontSize: 12, color: "var(--text2)", marginBottom: 14 }}>
                Optionally enter a folder name to organise these photos (e.g. "Graduation", "Practical 3"). Leave blank to upload to the root folder.
              </div>
              <input
                className="form-input"
                placeholder="Folder name (optional)"
                value={folderNameInput}
                onChange={(e) => setFolderNameInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const name = folderNameInput.trim();
                    const files = folderPrompt;
                    setFolderPrompt(null);
                    handleUpload(files, name || undefined);
                  }
                }}
                autoFocus
              />
              <div style={{ display: "flex", gap: 10, marginTop: 16, justifyContent: "flex-end" }}>
                <button className="btn btn-outline btn-sm" onClick={() => { setFolderPrompt(null); if (fileInputRef.current) fileInputRef.current.value = ""; }}>
                  Cancel
                </button>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => {
                    const name = folderNameInput.trim();
                    const files = folderPrompt;
                    setFolderPrompt(null);
                    handleUpload(files, name || undefined);
                  }}
                >
                  Upload
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="page-header" style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          {!isStudent && (
            <button className="btn btn-outline btn-sm" onClick={backToFolders}>
              <i className="fa-solid fa-arrow-left" /> Back to Gallery
            </button>
          )}
          <div>
            <div className="page-title" style={{ margin: 0 }}>
              {isOwnFolder ? "My Photo Gallery" : selectedStudent.name}
            </div>
            <div style={{ fontSize: 12, color: "var(--text2)" }}>
              {selectedStudent.studentId}
              {cls ? ` • ${cls.name}` : ""}
            </div>
          </div>
        </div>

        {/* ── Profile Photo Section (student only) ── */}
        {isOwnFolder && (
          <div
            className="card"
            style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}
          >
            <div style={{ position: "relative" }}>
              <div
                style={{
                  width: 90,
                  height: 90,
                  borderRadius: "50%",
                  overflow: "hidden",
                  background: "var(--bg3)",
                  border: "3px solid var(--accent)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {hasProfilePhoto ? (
                  <img
                    src={profilePhotoUrl!}
                    alt="Profile"
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                ) : (
                  <span style={{ fontSize: 32, fontWeight: 700, color: "var(--text2)" }}>
                    {selectedStudent.name[0]}
                  </span>
                )}
              </div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 15, color: "var(--text1)", marginBottom: 4 }}>Profile Photo</div>
              <div style={{ fontSize: 12, color: "var(--text2)", marginBottom: 10 }}>
                {hasProfilePhoto
                  ? "Your current profile photo. Upload a new one to replace it."
                  : "No profile photo set. Upload one below."}
              </div>
              <input
                ref={profileInputRef}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={(e) => e.target.files && handleProfileUpload(e.target.files)}
              />
              <button
                className="btn btn-primary btn-sm"
                onClick={() => profileInputRef.current?.click()}
                disabled={uploading}
              >
                {uploading ? (
                  <>
                    <i className="fa-solid fa-spinner fa-spin" /> Uploading...
                  </>
                ) : (
                  <>
                    <i className="fa-solid fa-camera" />{" "}
                    {hasProfilePhoto ? "Change Profile Photo" : "Upload Profile Photo"}
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* ── Gallery Section ── */}
        <div
          className="card"
          style={{
            marginBottom: 16,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <div style={{ color: "var(--text2)", fontSize: 13 }}>
            <i className="fa-solid fa-images" style={{ marginRight: 6, color: "var(--accent)" }} />
            <strong style={{ color: "var(--text1)" }}>{rootPhotos.length}</strong> photo
            {rootPhotos.length !== 1 ? "s" : ""} here
            {subfolders.length > 0 && (
              <span style={{ marginLeft: 8 }}>
                · <strong style={{ color: "var(--text1)" }}>{subfolders.length}</strong> folder
                {subfolders.length !== 1 ? "s" : ""}
              </span>
            )}
            {isOwnFolder && <span style={{ marginLeft: 8, fontSize: 11 }}>(uploaded by staff)</span>}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {selectedPhotos.length > 0 && (
              <button
                className="btn btn-outline btn-sm"
                onClick={() => handleDownloadAll(selectedPhotos, selectedStudent.name)}
                disabled={zipping}
              >
                {zipping ? <><i className="fa-solid fa-spinner fa-spin" /> Zipping...</> : <><i className="fa-solid fa-download" /> Download Folder (.zip)</>}
              </button>
            )}
            {canManage && (
              <button
                className="btn btn-outline btn-sm"
                onClick={() => { setNewSubfolderName(""); setCreateSubfolderModal(true); }}
              >
                <i className="fa-solid fa-folder-plus" /> Create Folder
              </button>
            )}
            {canUploadToOthers && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  style={{ display: "none" }}
                  onChange={(e) => {
                    if (e.target.files) { setFolderNameInput(""); setFolderPrompt(e.target.files); }
                  }}
                />
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                >
                  {uploading ? (
                    <>
                      <i className="fa-solid fa-spinner fa-spin" /> Uploading...
                    </>
                  ) : (
                    <>
                      <i className="fa-solid fa-cloud-arrow-up" /> Upload Photos
                    </>
                  )}
                </button>
              </>
            )}
          </div>
        </div>

        {/* Create-folder modal (a folder inside this student's bucket) */}
        {createSubfolderModal && (
          <div style={{ position: "fixed", inset: 0, zIndex: 900, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div className="card" style={{ padding: 28, maxWidth: 400, width: "90%" }}>
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6, color: "var(--text1)" }}>Create Folder</div>
              <div style={{ fontSize: 12, color: "var(--text2)", marginBottom: 14 }}>
                New folder inside <strong>{selectedStudent.name}</strong>'s gallery (e.g. "Graduation", "Practical 3").
              </div>
              <input className="form-input" placeholder="Folder name" value={newSubfolderName} autoFocus
                onChange={(e) => setNewSubfolderName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleCreateSubfolder(); }} />
              <div style={{ display: "flex", gap: 10, marginTop: 16, justifyContent: "flex-end" }}>
                <button className="btn btn-outline btn-sm" onClick={() => { setCreateSubfolderModal(false); setNewSubfolderName(""); }}>Cancel</button>
                <button className="btn btn-primary btn-sm" onClick={handleCreateSubfolder}>Create</button>
              </div>
            </div>
          </div>
        )}

        {/* Folders inside this student's bucket */}
        {subfolders.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: "var(--text2)", marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>
              <i className="fa-solid fa-folder-open" style={{ marginRight: 6, color: "var(--accent)" }} /> Folders
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 12 }}>
              {subfolders.map((sub) => {
                const pathKey = `${selectedStudentId}/${sub}`;
                const count = photoMap[pathKey]?.length || 0;
                const thumb = thumbMap[pathKey];
                return (
                  <div key={sub} className="folder-card card" onClick={() => openSubfolder(selectedStudentId!, sub)}
                    style={{ padding: 0, cursor: "pointer", overflow: "hidden", border: "1px solid var(--accent)" }}>
                    <div style={{ height: 100, background: "var(--bg3)", position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {thumb ? (
                        <img src={thumb} alt={sub} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      ) : (
                        <i className="fa-solid fa-folder-open" style={{ fontSize: 22, color: "var(--accent)", opacity: 0.5 }} />
                      )}
                      {count > 0 && (
                        <div style={{ position: "absolute", bottom: 6, right: 6, background: "rgba(0,0,0,0.75)", color: "#fff", fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 10 }}>
                          <i className="fa-solid fa-images" style={{ fontSize: 8, marginRight: 3 }} />{count}
                        </div>
                      )}
                    </div>
                    <div style={{ padding: "8px 10px", textAlign: "center", fontSize: 12, fontWeight: 700, color: "var(--text1)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {rootPhotos.length === 0 && subfolders.length === 0 ? (
          <div className="card" style={{ textAlign: "center", padding: 60, color: "var(--text2)" }}>
            <div style={{ fontSize: 52, marginBottom: 12 }}>📷</div>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6, color: "var(--text1)" }}>
              No gallery photos yet
            </div>
            {isOwnFolder ? (
              <div style={{ fontSize: 13 }}>Photos uploaded by your lecturer or admin will appear here.</div>
            ) : (
              canUploadToOthers && (
                <div style={{ fontSize: 13 }}>
                  Click <strong>Upload Photos</strong> to add photos for this student.
                </div>
              )
            )}
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
            {rootPhotos.map((url, i) => (
              <div
                key={i}
                className="photo-card"
                style={{
                  borderRadius: 10,
                  overflow: "hidden",
                  background: "var(--bg3)",
                  aspectRatio: "1",
                  position: "relative",
                  cursor: "pointer",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
                }}
              >
                <img
                  src={url}
                  alt={`${selectedStudent.name} photo ${i + 1}`}
                  style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                  onClick={() => setLightboxUrl(url)}
                />
                <div
                  className="photo-overlay"
                  style={{
                    position: "absolute",
                    bottom: 0,
                    left: 0,
                    right: 0,
                    background: "linear-gradient(transparent, rgba(0,0,0,0.78))",
                    padding: "28px 8px 8px",
                    display: "flex",
                    gap: 6,
                    justifyContent: "flex-end",
                    opacity: 0,
                    transition: "opacity 0.2s",
                  }}
                >
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setLightboxUrl(url);
                    }}
                    title="View"
                    style={{
                      background: "rgba(255,255,255,0.2)",
                      border: "none",
                      color: "#fff",
                      borderRadius: 6,
                      padding: "5px 9px",
                      cursor: "pointer",
                      fontSize: 12,
                    }}
                  >
                    <i className="fa-solid fa-expand" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDownloadPhoto(url, selectedStudent.name, i);
                    }}
                    title="Download"
                    style={{
                      background: "rgba(255,255,255,0.2)",
                      border: "none",
                      color: "#fff",
                      borderRadius: 6,
                      padding: "5px 9px",
                      cursor: "pointer",
                      fontSize: 12,
                    }}
                  >
                    <i className="fa-solid fa-download" />
                  </button>
                  {canUploadToOthers && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteConfirm(url);
                      }}
                      title="Delete"
                      style={{
                        background: "rgba(220,38,38,0.8)",
                        border: "none",
                        color: "#fff",
                        borderRadius: 6,
                        padding: "5px 9px",
                        cursor: "pointer",
                        fontSize: 12,
                      }}
                    >
                      <i className="fa-solid fa-trash" />
                    </button>
                  )}
                </div>
              </div>
            ))}

            {canUploadToOthers && (
              <div
                onClick={() => fileInputRef.current?.click()}
                style={{
                  borderRadius: 10,
                  border: "2px dashed var(--accent)",
                  aspectRatio: "1",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                  color: "var(--accent)",
                  background: "rgba(99,102,241,0.05)",
                  transition: "background 0.15s",
                  gap: 8,
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(99,102,241,0.14)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(99,102,241,0.05)")}
              >
                <i className="fa-solid fa-plus" style={{ fontSize: 28 }} />
                <span style={{ fontSize: 12, fontWeight: 600 }}>Add Photos</span>
              </div>
            )}
          </div>
        )}
      </>
    );
  }

  // ── FOLDERS GRID (admin / lecturer) ─────────────────────────────────────────
  return (
    <>
      <style>{`.folder-card { transition: transform 0.15s, box-shadow 0.15s; } .folder-card:hover { transform: translateY(-3px) !important; box-shadow: 0 8px 24px rgba(0,0,0,0.4) !important; }`}</style>

      {/* Create Folder modal */}
      {createFolderModal && (
        <div style={{ position: "fixed", inset: 0, zIndex: 900, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div className="card" style={{ padding: 28, maxWidth: 400, width: "90%" }}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6, color: "var(--text1)" }}>Create New Folder</div>
            <div style={{ fontSize: 12, color: "var(--text2)", marginBottom: 14 }}>Enter a name for the new folder (e.g. "Graduation 2026", "Practical Week 3").</div>
            <input
              className="form-input"
              placeholder="Folder name"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleCreateFolder(); }}
              autoFocus
            />
            <div style={{ display: "flex", gap: 10, marginTop: 16, justifyContent: "flex-end" }}>
              <button className="btn btn-outline btn-sm" onClick={() => { setCreateFolderModal(false); setNewFolderName(""); }}>Cancel</button>
              <button className="btn btn-primary btn-sm" onClick={handleCreateFolder}>Create</button>
            </div>
          </div>
        </div>
      )}

      <div className="page-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div className="page-title">Student Photo Gallery</div>
        {canManage && (
          <button className="btn btn-outline btn-sm" onClick={() => { setNewFolderName(""); setCreateFolderModal(true); }}>
            <i className="fa-solid fa-folder-plus" /> Create Folder
          </button>
        )}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="form-row cols2">
          <div className="form-group">
            <label>Search</label>
            <input
              className="form-input"
              placeholder="Search students or folders..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label>Filter by Class</label>
            <select className="form-input" value={classFilter} onChange={(e) => setClassFilter(e.target.value)}>
              <option value="">All Classes</option>
              {visibleClasses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        {[
          { icon: "fa-users", color: "var(--accent)", label: "Students", value: filteredStudents.length },
          {
            icon: "fa-folder-open",
            color: "#f0b429",
            label: "With Photos",
            value: filteredStudents.filter((s) => (photoMap[s.id]?.length || 0) > 0 || thumbMap[s.id]).length,
          },
          {
            icon: "fa-images",
            color: "#10b981",
            label: "Total Photos",
            value: filteredStudents.reduce((sum, s) => sum + (photoMap[s.id]?.length || 0), 0),
          },
        ].map((stat) => (
          <div
            key={stat.label}
            className="card"
            style={{ padding: "10px 18px", flex: 1, minWidth: 130, display: "flex", alignItems: "center", gap: 10 }}
          >
            <i className={`fa-solid ${stat.icon}`} style={{ color: stat.color, fontSize: 18 }} />
            <div>
              <div style={{ fontSize: 11, color: "var(--text2)" }}>{stat.label}</div>
              <div style={{ fontWeight: 700, fontSize: 17 }}>{stat.value}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Rename folder modal */}
      {renameModal && (
        <div style={{ position: "fixed", inset: 0, zIndex: 900, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div className="card" style={{ padding: 28, maxWidth: 400, width: "90%" }}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6, color: "var(--text1)" }}>Rename Folder</div>
            <div style={{ fontSize: 12, color: "var(--text2)", marginBottom: 14 }}>Enter a new name for <strong>"{renameModal.oldName}"</strong>.</div>
            <input className="form-input" placeholder="New folder name" value={renameInput} autoFocus
              onChange={(e) => setRenameInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleRenameFolder(renameModal.oldName, renameInput); }} />
            <div style={{ display: "flex", gap: 10, marginTop: 16, justifyContent: "flex-end" }}>
              <button className="btn btn-outline btn-sm" onClick={() => { setRenameModal(null); setRenameInput(""); }}>Cancel</button>
              <button className="btn btn-primary btn-sm" onClick={() => handleRenameFolder(renameModal.oldName, renameInput)}>Rename</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete folder confirm modal */}
      {deleteFolderConfirm && (
        <div style={{ position: "fixed", inset: 0, zIndex: 900, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div className="card" style={{ padding: 28, maxWidth: 380, width: "90%", textAlign: "center" }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>🗑️</div>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 8, color: "var(--text1)" }}>Delete Folder?</div>
            <div style={{ color: "var(--text2)", fontSize: 13, marginBottom: 20 }}>
              All photos inside <strong>"{deleteFolderConfirm}"</strong> will be permanently deleted.
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
              <button className="btn btn-outline btn-sm" onClick={() => setDeleteFolderConfirm(null)}>Cancel</button>
              <button className="btn btn-sm" style={{ background: "#dc2626", color: "#fff", border: "none" }} onClick={() => handleDeleteFolder(deleteFolderConfirm)}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* Custom folders section */}
      {filteredCustomFolders.length > 0 && (
        <>
          <div style={{ fontWeight: 700, fontSize: 13, color: "var(--text2)", marginBottom: 8, marginTop: 4, textTransform: "uppercase", letterSpacing: 1 }}>
            <i className="fa-solid fa-folder-open" style={{ marginRight: 6, color: "var(--accent)" }} /> Custom Folders
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 14, marginBottom: 24 }}>
            {filteredCustomFolders.map((name) => {
              const photoCount = photoMap[name]?.length || 0;
              const thumb = thumbMap[name];
              return (
                <div key={name} className="card folder-card" onClick={() => { setSelectedCustomFolder(name); setViewMode("custom_folder"); }}
                  style={{ padding: 0, cursor: "pointer", overflow: "hidden", border: "1px solid var(--accent)", position: "relative" }}>
                  {/* Action buttons */}
                  {canManage && (
                    <div style={{ position: "absolute", top: 6, right: 6, zIndex: 2, display: "flex", gap: 4 }}
                      onClick={(e) => e.stopPropagation()}>
                      <button title="Rename" onClick={() => { setRenameInput(name); setRenameModal({ oldName: name }); }}
                        style={{ background: "rgba(0,0,0,0.55)", border: "none", color: "#fff", borderRadius: 5, padding: "4px 7px", cursor: "pointer", fontSize: 11 }}>
                        <i className="fa-solid fa-pen" />
                      </button>
                      <button title="Delete folder" onClick={() => setDeleteFolderConfirm(name)}
                        style={{ background: "rgba(220,38,38,0.75)", border: "none", color: "#fff", borderRadius: 5, padding: "4px 7px", cursor: "pointer", fontSize: 11 }}>
                        <i className="fa-solid fa-trash" />
                      </button>
                    </div>
                  )}
                  <div style={{ height: 130, background: "var(--bg3)", position: "relative", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {thumb ? (
                      <img src={thumb} alt={name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    ) : (
                      <i className="fa-solid fa-folder-open" style={{ fontSize: 22, color: "var(--accent)", opacity: 0.5 }} />
                    )}
                    {photoCount > 0 && (
                      <div style={{ position: "absolute", bottom: 6, right: 6, background: "rgba(0,0,0,0.75)", color: "#fff", fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 10, display: "flex", alignItems: "center", gap: 4 }}>
                        <i className="fa-solid fa-images" style={{ fontSize: 8 }} /> {photoCount}
                      </div>
                    )}
                  </div>
                  <div style={{ padding: "10px 12px 12px", textAlign: "center" }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text1)", marginBottom: 6, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{name}</div>
                    <div style={{ fontSize: 10, color: "var(--text2)", display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
                      <i className="fa-solid fa-folder-open" style={{ color: "var(--accent)" }} /> Click to open
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ fontWeight: 700, fontSize: 13, color: "var(--text2)", marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>
            <i className="fa-solid fa-users" style={{ marginRight: 6 }} /> Student Folders
          </div>
        </>
      )}

      {loading ? (
        <div className="card" style={{ textAlign: "center", padding: 60, color: "var(--text2)" }}>
          <i className="fa-solid fa-spinner fa-spin" style={{ fontSize: 24, marginBottom: 12, display: "block" }} />
          Loading gallery...
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 14 }}>
          {filteredStudents.map((s) => {
            const hasPhoto = !!thumbMap[s.id];
            const photoCount = photoMap[s.id]?.length || 0;
            const cls = db.classes.find((c) => c.id === s.classId);
            return (
              <div
                key={s.id}
                className="card folder-card"
                onClick={() => openStudent(s.id)}
                style={{ padding: 0, cursor: "pointer", overflow: "hidden", border: "1px solid var(--border)" }}
              >
                <div
                  style={{
                    height: 130,
                    background: "var(--bg3)",
                    position: "relative",
                    overflow: "hidden",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {hasPhoto ? (
                    <>
                      <img
                        src={thumbMap[s.id]}
                        alt={s.name}
                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                      />
                      <div
                        style={{
                          position: "absolute",
                          top: 0,
                          left: 0,
                          right: 0,
                          height: 3,
                          background: "linear-gradient(90deg, var(--accent), #818cf8)",
                        }}
                      />
                      {photoCount > 0 && (
                        <div
                          style={{
                            position: "absolute",
                            bottom: 6,
                            right: 6,
                            background: "rgba(0,0,0,0.75)",
                            color: "#fff",
                            fontSize: 10,
                            fontWeight: 700,
                            padding: "2px 7px",
                            borderRadius: 10,
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                          }}
                        >
                          <i className="fa-solid fa-images" style={{ fontSize: 8 }} /> {photoCount}
                        </div>
                      )}
                    </>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                      <div
                        style={{
                          width: 60,
                          height: 60,
                          borderRadius: "50%",
                          background: "linear-gradient(135deg, #374151, #6b7280)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 24,
                          fontWeight: 700,
                          color: "#fff",
                        }}
                      >
                        {s.name[0]}
                      </div>
                      <span style={{ fontSize: 10, color: "var(--text2)" }}>Empty folder</span>
                    </div>
                  )}
                </div>
                <div style={{ padding: "10px 12px 12px", textAlign: "center" }}>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      color: "var(--text1)",
                      marginBottom: 2,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {s.name}
                  </div>
                  <div style={{ fontSize: 10, color: "var(--text2)", marginBottom: 6 }}>{s.studentId}</div>
                  {cls && (
                    <div
                      style={{
                        fontSize: 10,
                        color: "var(--accent)",
                        fontWeight: 600,
                        background: "rgba(99,102,241,0.12)",
                        borderRadius: 6,
                        padding: "2px 7px",
                        display: "inline-block",
                      }}
                    >
                      {cls.name}
                    </div>
                  )}
                  <div
                    style={{
                      marginTop: 8,
                      fontSize: 10,
                      color: "var(--text2)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 4,
                    }}
                  >
                    <i className="fa-solid fa-folder-open" style={{ color: "var(--accent)" }} /> Click to open
                  </div>
                </div>
              </div>
            );
          })}

          {filteredStudents.length === 0 && (
            <div style={{ gridColumn: "1/-1", textAlign: "center", padding: 60, color: "var(--text2)" }}>
              <div style={{ fontSize: 40, marginBottom: 10 }}>🔍</div>
              No students found.
            </div>
          )}
        </div>
      )}
    </>
  );
}
