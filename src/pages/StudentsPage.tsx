import { useState } from "react";
import { useApp } from "@/context/AppContext";
import { calcModuleMark, grade, gradeColor } from "@/data/db";
import { supabase } from "@/integrations/supabase/client";

const SECTIONS = {
  personal: "Personal Details",
  contact: "Contact & Identity",
  guardian: "Guardian / Next of Kin",
  academic: "Academic",
  marks: "Marks",
};

export default function StudentsPage() {
  const { db, currentUser, toast, showModal, closeModal, reloadDb } = useApp();
  const [search, setSearch] = useState("");
  const [classFilter, setClassFilter] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [showMissingOnly, setShowMissingOnly] = useState(false);
  const [quickDates, setQuickDates] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const role = currentUser?.role;

  if (role === "student") return <StudentProfileFallback />;

  let students = db.students;
  if (role === "lecturer") {
    const myClasses = db.classes.filter((c) => c.lecturer === currentUser?.name).map((c) => c.id);
    students = students.filter((s) => myClasses.includes(s.classId));
  }
  if (role === "hod") {
    const hodDept = db.departments.find((d) => d.hod === currentUser?.name);
    if (hodDept) {
      const deptClassIds = [...new Set(
        db.modules.filter((m) => m.dept === hodDept.id).flatMap((m) => m.classes)
      )];
      students = students.filter((s) => deptClassIds.includes(s.classId));
    }
  }

  const missingEnrolment = students.filter((s) => !s.enrolmentDate);

  const filtered = students.filter((s) => {
    const matchSearch =
      !search ||
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.studentId.toLowerCase().includes(search.toLowerCase());
    const matchClass = !classFilter || db.classes.find((c) => c.id === s.classId)?.name === classFilter;
    const matchMissing = !showMissingOnly || !s.enrolmentDate;
    return matchSearch && matchClass && matchMissing;
  });

  const selectedStudent = selected ? db.students.find((s) => s.id === selected) : null;

  // ── Edit modal ──────────────────────────────────────────────────────────────
  const showEdit = (s: (typeof db.students)[0]) => {
    let name = s.name,
      sid = s.studentId,
      dob = s.dob,
      gender = s.gender,
      nationality = (s as any).nationality || "",
      nationalId = s.nationalId || "",
      mobile = s.mobile,
      email = s.email || "",
      guardian = s.guardian || "",
      guardianEmail = s.guardianEmail || "",
      guardianMobile = s.guardianMobile || "",
      classId = s.classId || "",
      status = s.status || "active",
      enrolmentDate = (s as any).enrolmentDate || "";

    showModal(
      "Edit Student — " + s.name,
      <div>
        <FSec title="Personal Details">
          <div className="form-row cols2">
            <FG label="Full Name *">
              <input className="form-input" defaultValue={name} onChange={(e) => (name = e.target.value)} />
            </FG>
            <FG label="Student ID">
              <input className="form-input" defaultValue={sid} onChange={(e) => (sid = e.target.value)} />
            </FG>
          </div>
          <div className="form-row cols2">
            <FG label="Date of Birth">
              <input className="form-input" type="date" defaultValue={dob} onChange={(e) => (dob = e.target.value)} />
            </FG>
            <FG label="Gender">
              <select className="form-select" defaultValue={gender} onChange={(e) => (gender = e.target.value)}>
                <option>Female</option>
                <option>Male</option>
                <option>Other</option>
              </select>
            </FG>
          </div>
          <div className="form-row cols2">
            <FG label="Nationality">
              <input
                className="form-input"
                defaultValue={nationality}
                onChange={(e) => (nationality = e.target.value)}
              />
            </FG>
            <FG label="National ID / Passport">
              <input className="form-input" defaultValue={nationalId} onChange={(e) => (nationalId = e.target.value)} />
            </FG>
          </div>
        </FSec>

        <FSec title="Contact Information">
          <div className="form-row cols2">
            <FG label="Mobile">
              <input className="form-input" defaultValue={mobile} onChange={(e) => (mobile = e.target.value)} />
            </FG>
            <FG label="Email">
              <input
                className="form-input"
                type="email"
                defaultValue={email}
                onChange={(e) => (email = e.target.value)}
              />
            </FG>
          </div>
        </FSec>

        <FSec title="Guardian / Next of Kin">
          <FG label="Guardian Name">
            <input className="form-input" defaultValue={guardian} onChange={(e) => (guardian = e.target.value)} />
          </FG>
          <div className="form-row cols2">
            <FG label="Guardian Mobile">
              <input
                className="form-input"
                defaultValue={guardianMobile}
                onChange={(e) => (guardianMobile = e.target.value)}
              />
            </FG>
            <FG label="Guardian Email">
              <input
                className="form-input"
                type="email"
                defaultValue={guardianEmail}
                onChange={(e) => (guardianEmail = e.target.value)}
              />
            </FG>
          </div>
        </FSec>

        <FSec title="Academic">
          <div className="form-row cols2">
            <FG label="Class">
              <select className="form-select" defaultValue={classId} onChange={(e) => (classId = e.target.value)}>
                <option value="">— Unassigned —</option>
                {db.classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </FG>
            <FG label="Status">
              <select className="form-select" defaultValue={status} onChange={(e) => (status = e.target.value)}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="graduated">Graduated</option>
                <option value="suspended">Suspended</option>
              </select>
            </FG>
          </div>
          <div className="form-row cols2">
            <FG label="Enrolment Date">
              <input
                className={`form-input ${!(s as any).enrolmentDate ? "input-highlight" : ""}`}
                type="date"
                defaultValue={enrolmentDate}
                onChange={(e) => (enrolmentDate = e.target.value)}
                style={
                  !(s as any).enrolmentDate
                    ? { borderColor: "var(--accent)", boxShadow: "0 0 0 2px rgba(99,102,241,0.2)" }
                    : {}
                }
              />
              {!(s as any).enrolmentDate && (
                <div style={{ fontSize: 11, color: "var(--accent)", marginTop: 3 }}>
                  <i className="fa-solid fa-circle-info" /> Not set — please add enrolment date
                </div>
              )}
            </FG>
            <FG label="Date of Completion">
              <input
                className="form-input"
                type="date"
                defaultValue={(s as any).completionDate || ""}
                disabled
                style={{ opacity: 0.6, cursor: "not-allowed" }}
              />
              <div style={{ fontSize: 11, color: "var(--text2)", marginTop: 3 }}>
                <i className="fa-solid fa-lock" /> Auto-set when status is set to Graduated
              </div>
            </FG>
          </div>
        </FSec>

        <button
          className="btn btn-primary"
          style={{ width: "100%", marginTop: 8 }}
          onClick={async () => {
            if (!name.trim()) {
              toast("Name is required", "error");
              return;
            }
            const cls = db.classes.find((c) => c.id === classId);
            // Auto-set completion date when marking as graduated
            const wasGraduated = s.status === "graduated";
            const nowGraduated = status === "graduated";
            const completionDate = nowGraduated
              ? (s as any).completionDate || (!wasGraduated ? new Date().toISOString().split("T")[0] : undefined)
              : null;
            const { error } = await supabase
              .from("students")
              .update({
                name,
                student_id: sid,
                dob: dob || null,
                gender,
                nationality,
                national_id: nationalId,
                mobile,
                email,
                guardian,
                guardian_email: guardianEmail,
                guardian_mobile: guardianMobile,
                class_id: classId || null,
                programme: cls?.programme || s.programme,
                year: cls?.year || s.year,
                semester: cls?.semester || s.semester,
                status,
                enrolment_date: enrolmentDate || null,
                completion_date: completionDate,
              })
              .eq("id", s.id);
            if (error) {
              toast(error.message, "error");
              return;
            }
            if (nowGraduated && !wasGraduated)
              toast(`${name} marked as graduated. Completion date set to today.`, "success");
            else toast("Student updated!", "success");
            closeModal();
            reloadDb();
          }}
        >
          Save Changes
        </button>
      </div>,
    );
  };

  // ── Add student modal ───────────────────────────────────────────────────────
  const showAddStudent = () => {
    let name = "",
      sid = "",
      dob = "",
      gender = "Female",
      nationality = "Motswana",
      nationalId = "",
      mobile = "",
      email = "",
      classId = db.classes[0]?.id || "",
      guard = "",
      guardEmail = "",
      guardMobile = "",
      enrolmentDate = "";

    showModal(
      "Add New Student",
      <div>
        <FSec title="Personal Details">
          <div className="form-row cols2">
            <FG label="Full Name *">
              <input className="form-input" placeholder="Full name" onChange={(e) => (name = e.target.value)} />
            </FG>
            <FG label="Student ID">
              <input className="form-input" placeholder="BCI2026D-XX" onChange={(e) => (sid = e.target.value)} />
            </FG>
          </div>
          <div className="form-row cols2">
            <FG label="Date of Birth">
              <input className="form-input" type="date" onChange={(e) => (dob = e.target.value)} />
            </FG>
            <FG label="Gender">
              <select className="form-select" onChange={(e) => (gender = e.target.value)}>
                <option>Female</option>
                <option>Male</option>
                <option>Other</option>
              </select>
            </FG>
          </div>
          <div className="form-row cols2">
            <FG label="Nationality">
              <input className="form-input" defaultValue="Motswana" onChange={(e) => (nationality = e.target.value)} />
            </FG>
            <FG label="National ID / Passport">
              <input className="form-input" onChange={(e) => (nationalId = e.target.value)} />
            </FG>
          </div>
        </FSec>
        <FSec title="Contact Information">
          <div className="form-row cols2">
            <FG label="Mobile">
              <input className="form-input" onChange={(e) => (mobile = e.target.value)} />
            </FG>
            <FG label="Email">
              <input className="form-input" type="email" onChange={(e) => (email = e.target.value)} />
            </FG>
          </div>
        </FSec>
        <FSec title="Guardian / Next of Kin">
          <FG label="Guardian Name">
            <input className="form-input" onChange={(e) => (guard = e.target.value)} />
          </FG>
          <div className="form-row cols2">
            <FG label="Guardian Mobile">
              <input className="form-input" onChange={(e) => (guardMobile = e.target.value)} />
            </FG>
            <FG label="Guardian Email">
              <input className="form-input" type="email" onChange={(e) => (guardEmail = e.target.value)} />
            </FG>
          </div>
        </FSec>
        <FSec title="Academic">
          <FG label="Enrolment Date">
            <input className="form-input" type="date" onChange={(e) => (enrolmentDate = e.target.value)} />
          </FG>
          <FG label="Class">
            <select className="form-select" onChange={(e) => (classId = e.target.value)}>
              <option value="">— Assign later —</option>
              {db.classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </FG>
        </FSec>
        <button
          className="btn btn-primary"
          style={{ marginTop: 12, width: "100%" }}
          onClick={async () => {
            if (!name) { toast("Name is required", "error"); return; }
            const cls = db.classes.find((c) => c.id === classId);
            const { error } = await supabase.from("students").insert({
              id: "s" + Date.now(),
              student_id: sid || "BCI2026-NEW",
              name,
              gender,
              dob: dob || null,
              mobile,
              email,
              national_id: nationalId,
              nationality,
              class_id: classId || null,
              guardian: guard,
              guardian_email: guardEmail,
              guardian_mobile: guardMobile,
              programme: cls?.programme || "",
              year: cls?.year || 1,
              semester: cls?.semester || 1,
              status: "active",
              enrolment_date: enrolmentDate,
            });
            if (error) {
              toast(error.message, "error");
              return;
            }
            closeModal();
            toast("Student added!", "success");
            reloadDb();
          }}
        >
          Save Student
        </button>
      </div>,
    );
  };

  return (
    <div style={{ display: "flex", gap: 16, height: "calc(100vh - 120px)", overflow: "hidden" }}>
      {/* ── LEFT: Table ── */}
      <div
        style={{
          flex: selected ? "0 0 520px" : "1",
          display: "flex",
          flexDirection: "column",
          gap: 12,
          overflow: "hidden",
        }}
      >
        <div className="page-header" style={{ margin: 0, padding: 0 }}>
          <div>
            <div className="page-title">Students</div>
            <div className="page-sub">{filtered.length} students</div>
          </div>
          {role === "admin" && (
            <button className="btn btn-primary btn-sm" onClick={showAddStudent}>
              <i className="fa-solid fa-user-plus" /> Add Student
            </button>
          )}
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <input
            className="search-input"
            style={{ flex: 1 }}
            placeholder="Search by name or ID…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select className="filter-select" value={classFilter} onChange={(e) => setClassFilter(e.target.value)}>
            <option value="">All Classes</option>
            {db.classes.map((c) => (
              <option key={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        {/* Missing enrolment date banner */}
        {role === "admin" && missingEnrolment.length > 0 && (
          <div
            style={{
              background: "rgba(245,158,11,0.12)",
              border: "1px solid rgba(245,158,11,0.4)",
              borderRadius: 8,
              padding: "10px 14px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <i className="fa-solid fa-triangle-exclamation" style={{ color: "#f59e0b" }} />
              <span style={{ fontSize: 13, color: "var(--text1)", fontWeight: 600 }}>
                {missingEnrolment.length} student{missingEnrolment.length > 1 ? "s" : ""} missing enrolment date
              </span>
            </div>
            <button
              className="btn btn-sm"
              style={{
                background: showMissingOnly ? "#f59e0b" : "transparent",
                color: showMissingOnly ? "#fff" : "#f59e0b",
                border: "1px solid #f59e0b",
                fontWeight: 600,
                fontSize: 12,
              }}
              onClick={() => setShowMissingOnly((v) => !v)}
            >
              {showMissingOnly ? "Show All" : "Show Missing Only"}
            </button>
          </div>
        )}

        <div style={{ flex: 1, overflowY: "auto" }}>
          <div className="card" style={{ padding: 0 }}>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Student ID</th>
                    <th>Class</th>
                    <th>Programme</th>
                    <th>Status</th>
                    {role === "admin" && <th>Enrolment Date</th>}
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((s) => {
                    const cls = db.classes.find((c) => c.id === s.classId);
                    const prog = db.config.programmes.find((p) => p.id === s.programme);
                    const isSelected = selected === s.id;
                    return (
                      <tr key={s.id} style={{ background: isSelected ? "var(--bg2)" : undefined }}>
                        <td className="td-name">
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <div
                              className="avatar"
                              style={{
                                background: s.gender === "Female" ? "#8250df" : "#1f6feb",
                                width: 28,
                                height: 28,
                                fontSize: 11,
                              }}
                            >
                              {s.name[0]}
                            </div>
                            {s.name}
                          </div>
                        </td>
                        <td style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11 }}>{s.studentId}</td>
                        <td>{cls?.name || <span style={{ color: "#f59e0b" }}>Unassigned</span>}</td>
                        <td>{prog?.type ? `${prog.type} Yr${s.year}` : "—"}</td>
                        <td>
                          <span
                            className={`badge ${s.status === "active" ? "badge-active" : s.status === "graduated" ? "badge-pass" : "badge-fail"}`}
                          >
                            {s.status || "active"}
                          </span>
                        </td>
                        {role === "admin" && (
                          <td>
                            {s.enrolmentDate ? (
                              <span style={{ fontSize: 12, color: "var(--text2)" }}>
                                {new Date(s.enrolmentDate).toLocaleDateString("en-GB", {
                                  day: "numeric",
                                  month: "short",
                                  year: "numeric",
                                })}
                              </span>
                            ) : (
                              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                <input
                                  type="date"
                                  style={{
                                    fontSize: 11,
                                    padding: "2px 6px",
                                    borderRadius: 4,
                                    border: "1px solid #f59e0b",
                                    background: "rgba(245,158,11,0.08)",
                                    color: "var(--text1)",
                                    width: 130,
                                  }}
                                  value={quickDates[s.id] || ""}
                                  onChange={(e) => setQuickDates((prev) => ({ ...prev, [s.id]: e.target.value }))}
                                />
                                <button
                                  className="btn btn-sm"
                                  disabled={!quickDates[s.id] || savingId === s.id}
                                  style={{
                                    padding: "2px 8px",
                                    fontSize: 11,
                                    background: "#f59e0b",
                                    color: "#fff",
                                    border: "none",
                                    borderRadius: 4,
                                    cursor: !quickDates[s.id] ? "not-allowed" : "pointer",
                                    opacity: !quickDates[s.id] ? 0.5 : 1,
                                  }}
                                  onClick={async () => {
                                    if (!quickDates[s.id]) return;
                                    setSavingId(s.id);
                                    const { error } = await supabase
                                      .from("students")
                                      .update({ enrolment_date: quickDates[s.id] })
                                      .eq("id", s.id);
                                    setSavingId(null);
                                    if (error) {
                                      toast(error.message, "error");
                                      return;
                                    }
                                    toast(`Enrolment date saved for ${s.name}`, "success");
                                    reloadDb();
                                  }}
                                >
                                  {savingId === s.id ? (
                                    <i className="fa-solid fa-spinner fa-spin" />
                                  ) : (
                                    <i className="fa-solid fa-check" />
                                  )}
                                </button>
                              </div>
                            )}
                          </td>
                        )}
                        <td>
                          <div style={{ display: "flex", gap: 4 }}>
                            <button
                              className="btn btn-outline btn-sm"
                              onClick={() => {
                                setSelected(s.id);
                                setEditMode(false);
                              }}
                            >
                              View
                            </button>
                            {role === "admin" && (
                              <button className="btn btn-outline btn-sm" onClick={() => showEdit(s)}>
                                Edit
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {/* ── RIGHT: Profile panel ── */}
      {selectedStudent && (
        <StudentProfilePanel
          student={selectedStudent}
          db={db}
          role={role || ""}
          onClose={() => setSelected(null)}
          onEdit={() => showEdit(selectedStudent)}
        />
      )}
    </div>
  );
}

// ── Student Profile Panel ────────────────────────────────────────────────────
function StudentProfilePanel({ student: s, db, role, onClose, onEdit }: any) {
  const cls = db.classes.find((c: any) => c.id === s.classId);
  const prog = db.config.programmes.find((p: any) => p.id === s.programme);
  const marks = db.marks.filter((m: any) => m.studentId === s.studentId);

  return (
    <div
      style={{
        flex: 1,
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        overflow: "auto",
        padding: 24,
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
        <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
          <div
            className="avatar"
            style={{ background: s.gender === "Female" ? "#8250df" : "#1f6feb", width: 52, height: 52, fontSize: 20 }}
          >
            {s.name[0]}
          </div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{s.name}</div>
            <div style={{ fontSize: 12, color: "var(--text2)", marginTop: 2 }}>{s.studentId}</div>
            <span
              className={`badge ${s.status === "active" ? "badge-active" : "badge-fail"}`}
              style={{ marginTop: 4, display: "inline-block" }}
            >
              {s.status || "active"}
            </span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {role === "admin" && (
            <button className="btn btn-outline btn-sm" onClick={onEdit}>
              <i className="fa-solid fa-pen" /> Edit
            </button>
          )}
          <button
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "var(--text2)" }}
            onClick={onClose}
          >
            ×
          </button>
        </div>
      </div>

      <ProfileSection title="Personal Details">
        <ProfileRow label="Full Name" value={s.name} />
        <ProfileRow label="Date of Birth" value={s.dob || "—"} />
        <ProfileRow label="Gender" value={s.gender || "—"} />
        <ProfileRow label="Nationality" value={(s as any).nationality || "—"} />
        <ProfileRow label="National ID" value={s.nationalId || "—"} />
      </ProfileSection>

      <ProfileSection title="Contact Information">
        <ProfileRow label="Mobile" value={s.mobile || "—"} />
        <ProfileRow label="Email" value={s.email || "—"} />
      </ProfileSection>

      <ProfileSection title="Guardian / Next of Kin">
        <ProfileRow label="Guardian Name" value={s.guardian || "—"} />
        <ProfileRow label="Guardian Mobile" value={s.guardianMobile || "—"} />
        <ProfileRow label="Guardian Email" value={s.guardianEmail || "—"} />
      </ProfileSection>

      <ProfileSection title="Academic">
        <ProfileRow label="Programme" value={prog?.name || "—"} />
        <ProfileRow label="Class" value={cls?.name || "Unassigned"} />
        <ProfileRow label="Year" value={`Year ${s.year}`} />
        <ProfileRow label="Semester" value={`Semester ${s.semester}`} />
      </ProfileSection>

      {marks.length > 0 && (
        <div style={{ marginTop: 4 }}>
          <div
            style={{
              fontWeight: 700,
              fontSize: 11,
              color: "var(--text2)",
              textTransform: "uppercase",
              letterSpacing: 0.5,
              borderBottom: "1px solid var(--border)",
              paddingBottom: 4,
              marginBottom: 10,
            }}
          >
            Marks
          </div>
          <table style={{ width: "100%" }}>
            <thead>
              <tr>
                <th>Module</th>
                <th>Total %</th>
                <th>Grade</th>
              </tr>
            </thead>
            <tbody>
              {marks.map((m: any) => {
                const mod = db.modules.find((mo: any) => mo.id === m.moduleId);
                const mm = calcModuleMark(m);
                const g = grade(mm);
                return (
                  <tr key={m.moduleId}>
                    <td style={{ fontSize: 12 }}>{mod?.name || "—"}</td>
                    <td style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11 }}>{mm}%</td>
                    <td>
                      <span className={`badge ${gradeColor(g)}`}>{g}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function ProfileSection({ title, children }: any) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div
        style={{
          fontWeight: 700,
          fontSize: 11,
          color: "var(--text2)",
          textTransform: "uppercase",
          letterSpacing: 0.5,
          borderBottom: "1px solid var(--border)",
          paddingBottom: 4,
          marginBottom: 10,
        }}
      >
        {title}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 16px" }}>{children}</div>
    </div>
  );
}
function ProfileRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ fontSize: 13 }}>
      <div style={{ color: "var(--text2)", fontSize: 11 }}>{label}</div>
      <div style={{ fontWeight: 500, marginTop: 1 }}>{value}</div>
    </div>
  );
}
function FSec({ title, children }: any) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div
        style={{
          fontWeight: 700,
          fontSize: 12,
          color: "#002060",
          borderBottom: "2px solid #C9A227",
          paddingBottom: 4,
          marginBottom: 12,
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}
function FG({ label, children }: any) {
  return (
    <div className="form-group">
      <label>{label}</label>
      {children}
    </div>
  );
}

function StudentProfileFallback() {
  const { currentUser } = useApp();
  return (
    <div className="card">
      <div className="page-title">My Profile</div>
      <p style={{ marginTop: 10 }}>{currentUser?.name}</p>
    </div>
  );
}
