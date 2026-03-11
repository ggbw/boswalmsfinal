import { useState, useEffect, useMemo } from "react";
import { useApp } from "@/context/AppContext";
import { supabase } from "@/integrations/supabase/client";

export default function PhotoGalleryPage() {
  const { db, currentUser, toast } = useApp();
  const role = currentUser?.role;
  const [search, setSearch] = useState("");
  const [classFilter, setClassFilter] = useState("");
  const [photoMap, setPhotoMap] = useState<Record<string, string[]>>({});
  const [thumbMap, setThumbMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: files } = await supabase.storage.from("student-photos").list("", { limit: 2000 });
      if (!files) {
        setLoading(false);
        return;
      }

      const folders = files.filter((f) => f.id && !f.name.includes("."));
      const allPhotos: Record<string, string[]> = {};
      const thumbs: Record<string, string> = {};

      for (const folder of folders) {
        const { data: inner } = await supabase.storage.from("student-photos").list(folder.name, { limit: 100 });
        if (!inner) continue;

        const photoFiles = inner.filter((f) => f.name.endsWith(".webp") && !f.name.startsWith("thumb_"));
        const thumbFiles = inner.filter((f) => f.name.startsWith("thumb_"));

        if (photoFiles.length > 0) {
          allPhotos[folder.name] = photoFiles.map((f) => {
            const { data } = supabase.storage.from("student-photos").getPublicUrl(`${folder.name}/${f.name}`);
            return data.publicUrl;
          });

          if (thumbFiles.length > 0) {
            const { data } = supabase.storage
              .from("student-photos")
              .getPublicUrl(`${folder.name}/${thumbFiles[0].name}`);
            thumbs[folder.name] = data.publicUrl;
          } else {
            thumbs[folder.name] = allPhotos[folder.name][0];
          }
        }
      }
      setPhotoMap(allPhotos);
      setThumbMap(thumbs);
      setLoading(false);
    })();
  }, []);

  // Lecturer: scope to only their classes
  const allowedClassIds = useMemo(() => {
    if (role !== "lecturer") return null; // null = all
    return db.classes.filter((c) => c.lecturer === currentUser?.name).map((c) => c.id);
  }, [role, db.classes, currentUser]);

  const visibleClasses = allowedClassIds ? db.classes.filter((c) => allowedClassIds.includes(c.id)) : db.classes;

  const filtered = useMemo(() => {
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

  const [selectedStudent, setSelectedStudent] = useState<string | null>(null);

  const viewStudentPhotos = (studentId: string) => {
    setSelectedStudent(selectedStudent === studentId ? null : studentId);
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
      toast("Failed to download photo", "error");
    }
  };

  const handleDownloadAll = async (photos: string[], studentName: string) => {
    for (let i = 0; i < photos.length; i++) {
      await handleDownloadPhoto(photos[i], studentName, i);
    }
    toast(`Downloaded ${photos.length} photo(s)`, "success");
  };

  return (
    <>
      <div className="page-header">
        <div className="page-title">Student Photo Gallery</div>
      </div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="form-row cols2">
          <div className="form-group">
            <label>Search</label>
            <input
              className="form-input"
              placeholder="Search by name or ID..."
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

      {loading ? (
        <div className="card" style={{ textAlign: "center", padding: 40, color: "var(--text2)" }}>
          Loading photos...
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 16 }}>
          {filtered.map((s) => {
            const hasPhoto = !!thumbMap[s.id];
            const photoCount = photoMap[s.id]?.length || 0;
            const cls = db.classes.find((c) => c.id === s.classId);
            const isSelected = selectedStudent === s.id;
            return (
              <div
                key={s.id}
                className="card"
                style={{
                  padding: 12,
                  textAlign: "center",
                  cursor: "pointer",
                  border: isSelected ? "2px solid var(--accent)" : undefined,
                }}
                onClick={() => viewStudentPhotos(s.id)}
              >
                <div
                  style={{
                    width: 100,
                    height: 100,
                    borderRadius: 12,
                    margin: "0 auto 8px",
                    overflow: "hidden",
                    background: "var(--bg3)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    position: "relative",
                  }}
                >
                  {hasPhoto ? (
                    <>
                      <img
                        src={thumbMap[s.id]}
                        alt={s.name}
                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                      />
                      {photoCount > 1 && (
                        <span
                          style={{
                            position: "absolute",
                            bottom: 4,
                            right: 4,
                            background: "rgba(0,0,0,0.7)",
                            color: "#fff",
                            fontSize: 10,
                            padding: "2px 6px",
                            borderRadius: 8,
                            fontWeight: 600,
                          }}
                        >
                          {photoCount}
                        </span>
                      )}
                    </>
                  ) : (
                    <span style={{ fontSize: 32, fontWeight: 700, color: "var(--text2)" }}>{s.name[0]}</span>
                  )}
                </div>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text1)" }}>{s.name}</div>
                <div style={{ fontSize: 10, color: "var(--text2)" }}>{s.studentId}</div>
                {cls && <div style={{ fontSize: 10, color: "var(--text2)" }}>{cls.name}</div>}
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div style={{ gridColumn: "1/-1", textAlign: "center", padding: 40, color: "var(--text2)" }}>
              No students found.
            </div>
          )}
        </div>
      )}

      {selectedStudent &&
        (() => {
          const student = db.students.find((s) => s.id === selectedStudent);
          if (!student) return null;
          const photos = photoMap[selectedStudent] || [];
          const cls = db.classes.find((c) => c.id === student.classId);
          return (
            <div className="card" style={{ marginTop: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <div>
                  <div className="card-title" style={{ margin: 0 }}>
                    {student.name} — Photos ({photos.length})
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text2)" }}>
                    {student.studentId} • {cls?.name}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  {photos.length > 0 && (
                    <button className="btn btn-primary btn-sm" onClick={() => handleDownloadAll(photos, student.name)}>
                      <i className="fa-solid fa-download" /> Download All
                    </button>
                  )}
                  <button className="btn btn-outline btn-sm" onClick={() => setSelectedStudent(null)}>
                    <i className="fa-solid fa-times" /> Close
                  </button>
                </div>
              </div>
              {photos.length === 0 ? (
                <div style={{ textAlign: "center", padding: 30, color: "var(--text2)" }}>
                  No photos uploaded by this student.
                </div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
                  {photos.map((url, i) => (
                    <div
                      key={i}
                      style={{
                        borderRadius: 8,
                        overflow: "hidden",
                        background: "var(--bg3)",
                        aspectRatio: "1",
                        position: "relative",
                      }}
                    >
                      <img
                        src={url + "?t=" + Date.now()}
                        alt={`${student.name} photo ${i + 1}`}
                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                      />
                      <button
                        onClick={() => handleDownloadPhoto(url, student.name, i)}
                        style={{
                          position: "absolute",
                          bottom: 8,
                          right: 8,
                          background: "rgba(0,0,0,0.7)",
                          color: "#fff",
                          border: "none",
                          borderRadius: 6,
                          padding: "6px 10px",
                          cursor: "pointer",
                          fontSize: 12,
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                        }}
                      >
                        <i className="fa-solid fa-download" /> Download
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })()}
    </>
  );
}
