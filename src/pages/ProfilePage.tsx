import { useState, useEffect, useRef } from "react";
import { useApp } from "@/context/AppContext";
import { supabase } from "@/integrations/supabase/client";
import { compressImage, createThumbnail } from "@/lib/imageCompression";

export default function ProfilePage() {
  const { currentUser, db, toast, showModal, closeModal, reloadDb } = useApp();
  const [changingPwd, setChangingPwd] = useState(false);
  const [currentPwd, setCurrentPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [photos, setPhotos] = useState<{ name: string; url: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const u = currentUser;

  const studentRecord =
    u?.role === "student"
      ? db.students.find((s) => s.studentId === u.studentId)
      : null;

  useEffect(() => {
    if (!studentRecord) return;
    loadPhotos(studentRecord.id);
  }, [studentRecord?.id]);

  const loadPhotos = async (studentId: string) => {
    const { data: files } = await supabase.storage.from("student-photos").list(studentId, { limit: 100 });
    if (!files || files.length === 0) {
      setPhotos([]);
      return;
    }
    const photoFiles = files.filter((f) => f.name.endsWith(".webp") && !f.name.startsWith("thumb_"));
    const urls = photoFiles.map((f) => {
      const { data } = supabase.storage.from("student-photos").getPublicUrl(`${studentId}/${f.name}`);
      return { name: f.name, url: data.publicUrl + "?t=" + Date.now() };
    });
    setPhotos(urls);
  };

  if (!u) return null;

  const handleChangePassword = async () => {
    if (!newPwd || newPwd.length < 6) {
      toast("Password must be at least 6 characters", "error");
      return;
    }
    if (newPwd !== confirmPwd) {
      toast("Passwords do not match", "error");
      return;
    }
    const { error } = await supabase.auth.updateUser({ password: newPwd });
    if (error) {
      toast(error.message, "error");
    } else {
      toast("Password changed successfully!", "success");
      setChangingPwd(false);
      setCurrentPwd("");
      setNewPwd("");
      setConfirmPwd("");
    }
  };

  const handleEditProfile = () => {
    let name = u.name,
      email = u.email || "",
      dept = u.dept || "";
    showModal(
      "Edit Profile",
      <div>
        <div className="form-group">
          <label>Full Name</label>
          <input className="form-input" defaultValue={name} onChange={(e) => (name = e.target.value)} />
        </div>
        <div className="form-group">
          <label>Email</label>
          <input className="form-input" type="email" defaultValue={email} onChange={(e) => (email = e.target.value)} />
        </div>
        {u.role !== "student" && (
          <div className="form-group">
            <label>Department</label>
            <select className="form-select" defaultValue={dept} onChange={(e) => (dept = e.target.value)}>
              <option value="">— Select —</option>
              {db.departments.map((d) => (
                <option key={d.id} value={d.name}>{d.name}</option>
              ))}
            </select>
          </div>
        )}
        <button
          className="btn btn-primary"
          style={{ marginTop: 12 }}
          onClick={async () => {
            const { error } = await supabase.from("profiles").update({ name, email, dept }).eq("user_id", u.id);
            if (error) {
              toast(error.message, "error");
            } else {
              toast("Profile updated!", "success");
              closeModal();
              reloadDb();
            }
          }}
        >
          Save Changes
        </button>
      </div>,
    );
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || !studentRecord) return;
    setUploading(true);
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (!file.type.startsWith("image/")) {
          toast(`${file.name} is not an image`, "error");
          continue;
        }
        const timestamp = Date.now() + "_" + i;
        const photoName = `photo_${timestamp}.webp`;
        const thumbName = `thumb_${timestamp}.webp`;
        const [compressed, thumb] = await Promise.all([compressImage(file), createThumbnail(file)]);
        const path = `${studentRecord.id}/${photoName}`;
        const thumbPath = `${studentRecord.id}/${thumbName}`;
        const [r1, r2] = await Promise.all([
          supabase.storage.from("student-photos").upload(path, compressed, { contentType: "image/webp", upsert: true }),
          supabase.storage.from("student-photos").upload(thumbPath, thumb, { contentType: "image/webp", upsert: true }),
        ]);
        if (r1.error) throw r1.error;
        if (r2.error) throw r2.error;
      }
      toast(`${files.length} photo(s) uploaded successfully!`, "success");
      await loadPhotos(studentRecord.id);
    } catch (err: any) {
      toast(err.message || "Upload failed", "error");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const handleDeletePhoto = async (photoName: string) => {
    if (!studentRecord) return;
    const thumbName = photoName.replace("photo_", "thumb_");
    await Promise.all([
      supabase.storage.from("student-photos").remove([`${studentRecord.id}/${photoName}`]),
      supabase.storage.from("student-photos").remove([`${studentRecord.id}/${thumbName}`]),
    ]);
    toast("Photo deleted", "success");
    await loadPhotos(studentRecord.id);
  };

  if (u.role === "student") {
    const stu = studentRecord;
    if (!stu)
      return (
        <div className="card" style={{ textAlign: "center", padding: 40, color: "var(--text2)" }}>
          Student record not found.
        </div>
      );
    const cls = db.classes.find((c) => c.id === stu.classId);
    const prog = db.config.programmes.find((p) => p.id === stu.programme);

    const handleEditStudentProfile = () => {
      let mobile = stu.mobile,
        guardian = stu.guardian,
        guardianEmail = stu.guardianEmail || "",
        guardianMobile = stu.guardianMobile || "",
        email = stu.email || "",
        nationalId = stu.nationalId || "";
      showModal(
        "Edit My Profile",
        <div>
          <div className="form-row cols2">
            <div className="form-group">
              <label>Mobile</label>
              <input className="form-input" defaultValue={mobile} onChange={(e) => (mobile = e.target.value)} />
            </div>
            <div className="form-group">
              <label>Email</label>
              <input
                className="form-input"
                type="email"
                defaultValue={email}
                onChange={(e) => (email = e.target.value)}
              />
            </div>
          </div>
          <div className="form-row cols2">
            <div className="form-group">
              <label>National ID</label>
              <input className="form-input" defaultValue={nationalId} onChange={(e) => (nationalId = e.target.value)} />
            </div>
            <div className="form-group">
              <label>Guardian Name</label>
              <input className="form-input" defaultValue={guardian} onChange={(e) => (guardian = e.target.value)} />
            </div>
          </div>
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text2)", marginTop: 8, marginBottom: 4 }}>
            Guardian Contact
          </div>
          <div className="form-row cols2">
            <div className="form-group">
              <label>Guardian Email</label>
              <input
                className="form-input"
                type="email"
                defaultValue={guardianEmail}
                onChange={(e) => (guardianEmail = e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>Guardian Mobile</label>
              <input
                className="form-input"
                defaultValue={guardianMobile}
                onChange={(e) => (guardianMobile = e.target.value)}
              />
            </div>
          </div>
          <button
            className="btn btn-primary"
            style={{ marginTop: 12 }}
            onClick={async () => {
              const { error } = await supabase
                .from("students")
                .update({
                  mobile,
                  guardian,
                  guardian_email: guardianEmail,
                  guardian_mobile: guardianMobile,
                  email,
                  national_id: nationalId,
                })
                .eq("id", stu.id);
              if (error) {
                toast(error.message, "error");
              } else {
                toast("Profile updated!", "success");
                closeModal();
                reloadDb();
              }
            }}
          >
            Save Changes
          </button>
        </div>,
      );
    };

    return (
      <>
        <div className="page-header">
          <div className="page-title">My Profile</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-outline btn-sm" onClick={handleEditStudentProfile}>
              <i className="fa-solid fa-pen" /> Edit Profile
            </button>
            <button className="btn btn-outline btn-sm" onClick={() => setChangingPwd(!changingPwd)}>
              <i className="fa-solid fa-key" /> Change Password
            </button>
          </div>
        </div>
        {changingPwd && (
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-title">Change Password</div>
            <div className="form-row cols2">
              <div className="form-group">
                <label>New Password</label>
                <input
                  className="form-input"
                  type="password"
                  value={newPwd}
                  onChange={(e) => setNewPwd(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>Confirm Password</label>
                <input
                  className="form-input"
                  type="password"
                  value={confirmPwd}
                  onChange={(e) => setConfirmPwd(e.target.value)}
                />
              </div>
            </div>
            <button className="btn btn-primary btn-sm" onClick={handleChangePassword}>
              Update Password
            </button>
          </div>
        )}
        <div className="two-col">
          <div className="card">
            <div style={{ textAlign: "center", marginBottom: 20 }}>
              <div
                style={{
                  width: 100,
                  height: 100,
                  borderRadius: 16,
                  overflow: "hidden",
                  background: "linear-gradient(135deg,#d4920a,#f0b429)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 28,
                  fontWeight: 700,
                  color: "#fff",
                  margin: "0 auto 8px",
                }}
              >
                {photos.length > 0 ? (
                  <img
                    src={photos[0].url}
                    alt={stu.name}
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                ) : (
                  stu.name[0]
                )}
              </div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{stu.name}</div>
              <span className="badge badge-pass">STUDENT</span>
            </div>
            <div className="info-row">
              <span className="info-label">Student ID</span>
              <span className="info-val">{stu.studentId}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Gender</span>
              <span className="info-val">{stu.gender}</span>
            </div>
            <div className="info-row">
              <span className="info-label">DOB</span>
              <span className="info-val">{stu.dob}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Mobile</span>
              <span className="info-val">{stu.mobile || "—"}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Email</span>
              <span className="info-val">{stu.email || "—"}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Guardian</span>
              <span className="info-val">{stu.guardian || "—"}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Guardian Email</span>
              <span className="info-val">{stu.guardianEmail || "—"}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Guardian Mobile</span>
              <span className="info-val">{stu.guardianMobile || "—"}</span>
            </div>
          </div>
          <div className="card">
            <div className="card-title">Academic Info</div>
            <div className="info-row">
              <span className="info-label">Programme</span>
              <span className="info-val">{prog?.name}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Class</span>
              <span className="info-val">{cls?.name}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Year</span>
              <span className="info-val">Year {stu.year}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Semester</span>
              <span className="info-val">Semester {stu.semester}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Status</span>
              <span className="info-val">
                <span className="badge badge-active">Active</span>
              </span>
            </div>
          </div>
        </div>

        {/* Photo Gallery Section */}
        <div className="card" style={{ marginTop: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div className="card-title" style={{ margin: 0 }}>
              My Photos
            </div>
            <div>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                multiple
                style={{ display: "none" }}
                onChange={handlePhotoUpload}
              />
              <button className="btn btn-primary btn-sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
                <i className="fa-solid fa-upload" /> {uploading ? "Uploading..." : "Upload Photos"}
              </button>
            </div>
          </div>
          {photos.length === 0 ? (
            <div style={{ textAlign: "center", padding: 30, color: "var(--text2)" }}>
              No photos uploaded yet. Click "Upload Photos" to add your photos.
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 12 }}>
              {photos.map((p) => (
                <div
                  key={p.name}
                  style={{
                    position: "relative",
                    borderRadius: 8,
                    overflow: "hidden",
                    background: "var(--bg3)",
                    aspectRatio: "1",
                  }}
                >
                  <img src={p.url} alt="Student photo" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  <button
                    onClick={() => handleDeletePhoto(p.name)}
                    style={{
                      position: "absolute",
                      top: 4,
                      right: 4,
                      background: "rgba(0,0,0,0.6)",
                      color: "#fff",
                      border: "none",
                      borderRadius: 4,
                      width: 24,
                      height: 24,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 12,
                    }}
                  >
                    <i className="fa-solid fa-trash" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </>
    );
  }

  return (
    <>
      <div className="page-header">
        <div className="page-title">My Profile</div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-outline btn-sm" onClick={handleEditProfile}>
            <i className="fa-solid fa-pen" /> Edit Profile
          </button>
          <button className="btn btn-outline btn-sm" onClick={() => setChangingPwd(!changingPwd)}>
            <i className="fa-solid fa-key" /> Change Password
          </button>
        </div>
      </div>
      {changingPwd && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-title">Change Password</div>
          <div className="form-row cols2">
            <div className="form-group">
              <label>New Password</label>
              <input
                className="form-input"
                type="password"
                value={newPwd}
                onChange={(e) => setNewPwd(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>Confirm Password</label>
              <input
                className="form-input"
                type="password"
                value={confirmPwd}
                onChange={(e) => setConfirmPwd(e.target.value)}
              />
            </div>
          </div>
          <button className="btn btn-primary btn-sm" onClick={handleChangePassword}>
            Update Password
          </button>
        </div>
      )}
      <div className="two-col">
        <div className="card">
          <div style={{ textAlign: "center", marginBottom: 20 }}>
            <div
              style={{
                width: 72,
                height: 72,
                borderRadius: 16,
                background: "linear-gradient(135deg,#d4920a,#f0b429)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 28,
                fontWeight: 700,
                color: "#fff",
                margin: "0 auto 12px",
              }}
            >
              {u.name[0]}
            </div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{u.name}</div>
            <span className="badge badge-pass">{u.role.toUpperCase()}</span>
          </div>
          <div className="info-row">
            <span className="info-label">Username</span>
            <span className="info-val">{u.username}</span>
          </div>
          <div className="info-row">
            <span className="info-label">Email</span>
            <span className="info-val">{u.email || "—"}</span>
          </div>
          <div className="info-row">
            <span className="info-label">Role</span>
            <span className="info-val">{u.role.toUpperCase()}</span>
          </div>
          <div className="info-row">
            <span className="info-label">Department</span>
            <span className="info-val">{u.dept || "—"}</span>
          </div>
        </div>
        <div className="card">
          <div className="card-title">Account Settings</div>
          <div className="info-row">
            <span className="info-label">Password Status</span>
            {u.changed ? (
              <span className="badge badge-active">Changed</span>
            ) : (
              <span className="badge badge-pending">Default</span>
            )}
          </div>
          <div className="info-row">
            <span className="info-label">Last Login</span>
            <span className="info-val">Today</span>
          </div>
        </div>
      </div>
    </>
  );
}
