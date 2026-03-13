import { useState, useEffect } from "react";
import { useApp } from "@/context/AppContext";
import { supabase } from "@/integrations/supabase/client";

// ── PUBLIC APPLICATION FORM ───────────────────────────────────────────────────
export function PublicApplicationForm() {
  const [programmes, setProgrammes] = useState<any[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Form fields
  const [form, setForm] = useState({
    name: "",
    dob: "",
    gender: "",
    nationality: "Motswana",
    nationalId: "",
    mobile: "",
    email: "",
    guardianName: "",
    guardianMobile: "",
    guardianEmail: "",
    programme: "",
    message: "",
  });

  useEffect(() => {
    supabase
      .from("programmes")
      .select("*")
      .then(({ data }) => setProgrammes(data || []));
  }, []);

  const set = (field: string, val: string) => setForm((f) => ({ ...f, [field]: val }));

  const handleSubmit = async () => {
    if (!form.name || !form.mobile || !form.programme) {
      alert("Please fill in Name, Mobile and Programme at minimum.");
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.from("admission_enquiries").insert({
      id: "ae_" + Date.now(),
      name: form.name,
      dob: form.dob || null,
      gender: form.gender,
      nationality: form.nationality,
      national_id: form.nationalId,
      mobile: form.mobile,
      email: form.email,
      guardian_name: form.guardianName,
      guardian_mobile: form.guardianMobile,
      guardian_email: form.guardianEmail,
      programme: form.programme,
      message: form.message,
      status: "pending",
      date: new Date().toISOString().split("T")[0],
    });
    setSubmitting(false);
    if (error) {
      alert("Submission failed: " + error.message);
      return;
    }
    setSubmitted(true);
  };

  if (submitted)
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "#f0f4f8",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <div
          style={{
            background: "#fff",
            borderRadius: 12,
            padding: 40,
            maxWidth: 480,
            textAlign: "center",
            boxShadow: "0 4px 24px rgba(0,0,0,0.08)",
          }}
        >
          <div
            style={{
              width: 64,
              height: 64,
              background: "#dcfce7",
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 16px",
              fontSize: 28,
            }}
          >
            ✓
          </div>
          <h2 style={{ color: "#002060", marginBottom: 8 }}>Application Submitted!</h2>
          <p style={{ color: "#555", lineHeight: 1.6 }}>
            Thank you, <strong>{form.name}</strong>. Your application for{" "}
            <strong>{programmes.find((p) => p.id === form.programme)?.name || form.programme}</strong> has been
            received.
          </p>
          <p style={{ color: "#888", fontSize: 13, marginTop: 12 }}>
            We will contact you at <strong>{form.mobile}</strong>
            {form.email ? ` or ${form.email}` : ""} once your application has been reviewed.
          </p>
          <div
            style={{
              marginTop: 24,
              padding: "12px 16px",
              background: "#f8faff",
              borderRadius: 8,
              border: "1px solid #dde3f0",
            }}
          >
            <div style={{ fontSize: 12, color: "#666" }}>Boswa Culinary Institute of Botswana</div>
            <div style={{ fontSize: 11, color: "#999" }}>www.boswa.ac.bw</div>
          </div>
        </div>
      </div>
    );

  return (
    <div style={{ minHeight: "100vh", background: "#f0f4f8", padding: "32px 16px" }}>
      <div style={{ maxWidth: 680, margin: "0 auto" }}>
        {/* Header */}
        <div
          style={{ background: "#002060", borderRadius: "12px 12px 0 0", padding: "24px 32px", textAlign: "center" }}
        >
          <div style={{ fontSize: 20, fontWeight: 800, color: "#fff", letterSpacing: 0.5 }}>
            BOSWA CULINARY INSTITUTE OF BOTSWANA
          </div>
          <div style={{ fontSize: 13, color: "#C9A227", marginTop: 4 }}>Student Admission Application Form</div>
        </div>

        <div
          style={{
            background: "#fff",
            borderRadius: "0 0 12px 12px",
            padding: "28px 32px",
            boxShadow: "0 4px 24px rgba(0,0,0,0.07)",
          }}
        >
          {/* Personal Details */}
          <SectionTitle>Personal Details</SectionTitle>
          <div className="form-row cols2">
            <div className="form-group">
              <label>Full Name *</label>
              <input
                className="form-input"
                placeholder="Full name as per ID"
                onChange={(e) => set("name", e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>Date of Birth</label>
              <input className="form-input" type="date" onChange={(e) => set("dob", e.target.value)} />
            </div>
          </div>
          <div className="form-row cols2">
            <div className="form-group">
              <label>Gender</label>
              <select className="form-select" onChange={(e) => set("gender", e.target.value)}>
                <option value="">— Select —</option>
                <option>Male</option>
                <option>Female</option>
                <option>Other</option>
              </select>
            </div>
            <div className="form-group">
              <label>Nationality</label>
              <input
                className="form-input"
                defaultValue="Motswana"
                onChange={(e) => set("nationality", e.target.value)}
              />
            </div>
          </div>
          <div className="form-group">
            <label>National ID / Passport Number</label>
            <input
              className="form-input"
              placeholder="ID or passport number"
              onChange={(e) => set("nationalId", e.target.value)}
            />
          </div>

          {/* Contact Info */}
          <SectionTitle>Contact Information</SectionTitle>
          <div className="form-row cols2">
            <div className="form-group">
              <label>Mobile Number *</label>
              <input
                className="form-input"
                placeholder="+267 7X XXX XXX"
                onChange={(e) => set("mobile", e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>Email Address</label>
              <input
                className="form-input"
                type="email"
                placeholder="optional"
                onChange={(e) => set("email", e.target.value)}
              />
            </div>
          </div>

          {/* Guardian Details */}
          <SectionTitle>Guardian / Next of Kin</SectionTitle>
          <div className="form-group">
            <label>Guardian Full Name</label>
            <input
              className="form-input"
              placeholder="Guardian's full name"
              onChange={(e) => set("guardianName", e.target.value)}
            />
          </div>
          <div className="form-row cols2">
            <div className="form-group">
              <label>Guardian Mobile</label>
              <input
                className="form-input"
                placeholder="+267 7X XXX XXX"
                onChange={(e) => set("guardianMobile", e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>Guardian Email</label>
              <input
                className="form-input"
                type="email"
                placeholder="optional"
                onChange={(e) => set("guardianEmail", e.target.value)}
              />
            </div>
          </div>

          {/* Programme */}
          <SectionTitle>Programme Choice</SectionTitle>
          <div className="form-group">
            <label>Programme Applying For *</label>
            <select className="form-select" onChange={(e) => set("programme", e.target.value)}>
              <option value="">— Select a programme —</option>
              {programmes.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.type})
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>Additional Message (optional)</label>
            <textarea
              className="form-input"
              rows={3}
              placeholder="Any additional information you'd like us to know…"
              onChange={(e) => set("message", e.target.value)}
              style={{ resize: "vertical" }}
            />
          </div>

          <button
            className="btn btn-primary"
            style={{ width: "100%", marginTop: 8, padding: "12px 0", fontSize: 14 }}
            onClick={handleSubmit}
            disabled={submitting}
          >
            {submitting ? "Submitting…" : "Submit Application"}
          </button>
          <p style={{ fontSize: 11, color: "#999", textAlign: "center", marginTop: 8 }}>
            By submitting this form you confirm that the information provided is accurate and correct.
          </p>
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontWeight: 700,
        fontSize: 13,
        color: "#002060",
        borderBottom: "2px solid #C9A227",
        paddingBottom: 4,
        marginTop: 20,
        marginBottom: 12,
      }}
    >
      {children}
    </div>
  );
}

// ── ADMIN ADMISSIONS PAGE ─────────────────────────────────────────────────────
export default function AdmissionsPage() {
  const { db, toast, showModal, closeModal, reloadDb } = useApp();
  const [filter, setFilter] = useState<"all" | "pending" | "approved" | "rejected">("pending");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<any>(null);

  const enquiries = db.admissionEnquiries || [];
  const filtered = enquiries.filter((a) => {
    const matchStatus = filter === "all" || a.status === filter;
    const matchSearch =
      !search || a.name.toLowerCase().includes(search.toLowerCase()) || (a.mobile || "").includes(search);
    return matchStatus && matchSearch;
  });

  const counts = {
    all: enquiries.length,
    pending: enquiries.filter((a) => a.status === "pending").length,
    approved: enquiries.filter((a) => a.status === "approved").length,
    rejected: enquiries.filter((a) => a.status === "rejected").length,
  };

  const handleView = (a: any) => setSelected(a);

  const handleApprove = (a: any) => {
    // Pre-fill with applicant's data
    let password = "BoswaStudent2026!";
    const studentId = "BCI" + new Date().getFullYear() + "-" + Math.floor(1000 + Math.random() * 9000);

    const progName = db.config.programmes.find((p: any) => p.id === a.programme)?.name || a.programme || "";

    showModal(
      "Approve Application — " + a.name,
      <div>
        <div
          style={{
            background: "#dcfce7",
            border: "1px solid #86efac",
            borderRadius: 8,
            padding: "10px 14px",
            marginBottom: 16,
            fontSize: 12,
          }}
        >
          <strong style={{ color: "#166534" }}>✓ Approving application</strong>
          <div style={{ color: "#166534", marginTop: 2 }}>
            This will create a student record and login account for {a.name}. Class assignment can be done later from
            the Students page.
          </div>
        </div>

        {/* Student ID + password */}
        <div className="form-row cols2">
          <div className="form-group">
            <label>Student ID</label>
            <input
              className="form-input"
              defaultValue={studentId}
              onChange={(e) => {
                (window as any)._approveStudentId = e.target.value;
              }}
            />
          </div>
          <div className="form-group">
            <label>Login Password</label>
            <input
              className="form-input"
              defaultValue={password}
              onChange={(e) => {
                password = e.target.value;
              }}
            />
          </div>
        </div>

        <div style={{ fontSize: 11, color: "#888", marginBottom: 14 }}>
          Programme: <strong>{progName}</strong> · Email: <strong>{a.email || "(none)"}</strong>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button
            className="btn btn-primary"
            style={{ flex: 1 }}
            onClick={async () => {
              const sid = (window as any)._approveStudentId || studentId;
              await doApprove(a, sid, password, toast, closeModal, reloadDb);
            }}
          >
            <i className="fa-solid fa-user-check" style={{ marginRight: 6 }} />
            Approve & Create Account
          </button>
          <button className="btn btn-outline" onClick={closeModal}>
            Cancel
          </button>
        </div>
      </div>,
    );
    (window as any)._approveStudentId = studentId;
  };

  const handleReject = async (a: any) => {
    if (!confirm(`Reject application from ${a.name}?`)) return;
    const { error } = await supabase.from("admission_enquiries").update({ status: "rejected" }).eq("id", a.id);
    if (error) {
      toast(error.message, "error");
      return;
    }
    toast("Application rejected", "success");
    setSelected(null);
    reloadDb();
  };

  const statusBadge = (s: string) => {
    if (s === "approved") return <span className="badge badge-pass">Approved</span>;
    if (s === "rejected") return <span className="badge badge-fail">Rejected</span>;
    return <span className="badge badge-pending">Pending</span>;
  };

  return (
    <div style={{ display: "flex", gap: 16, height: "calc(100vh - 120px)", overflow: "hidden" }}>
      {/* ── LEFT PANEL: List ── */}
      <div
        style={{
          flex: selected ? "0 0 420px" : "1",
          display: "flex",
          flexDirection: "column",
          gap: 12,
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div className="page-header" style={{ margin: 0, padding: 0 }}>
          <div>
            <div className="page-title">Admissions</div>
            <div className="page-sub">{counts.pending} pending review</div>
          </div>
          <a href="/apply" target="_blank" className="btn btn-outline btn-sm">
            <i className="fa-solid fa-arrow-up-right-from-square" /> Public Form
          </a>
        </div>

        {/* Filter tabs */}
        <div style={{ display: "flex", gap: 6 }}>
          {(["pending", "all", "approved", "rejected"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                padding: "5px 12px",
                fontSize: 12,
                borderRadius: 6,
                border: "none",
                cursor: "pointer",
                fontWeight: filter === f ? 700 : 400,
                background: filter === f ? "var(--accent)" : "var(--bg2)",
                color: filter === f ? "#fff" : "var(--text1)",
              }}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)} ({counts[f]})
            </button>
          ))}
        </div>

        {/* Search */}
        <input
          className="search-input"
          placeholder="Search by name or mobile…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        {/* List */}
        <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
          {filtered.length === 0 && (
            <div style={{ textAlign: "center", padding: 40, color: "var(--text2)", fontSize: 13 }}>
              No {filter === "all" ? "" : filter} applications
            </div>
          )}
          {filtered.map((a) => {
            const prog = db.config.programmes.find((p: any) => p.id === a.programme);
            const isSelected = selected?.id === a.id;
            return (
              <div
                key={a.id}
                onClick={() => handleView(a)}
                style={{
                  background: isSelected ? "#eff6ff" : "var(--card)",
                  border: `1px solid ${isSelected ? "#93c5fd" : "var(--border)"}`,
                  borderRadius: 8,
                  padding: "12px 14px",
                  cursor: "pointer",
                  transition: "all 0.15s",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{a.name}</div>
                    <div style={{ fontSize: 12, color: "var(--text2)", marginTop: 2 }}>
                      {prog?.name || a.programme || "—"}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text2)", marginTop: 2 }}>
                      {a.mobile || "—"}
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                    {statusBadge(a.status)}
                    <span style={{ fontSize: 10, color: "var(--text2)" }}>{a.date}</span>
                  </div>
                </div>
                {a.status === "pending" && (
                  <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                    <button
                      className="btn btn-primary btn-sm"
                      style={{ flex: 1, fontSize: 11 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleApprove(a);
                      }}
                    >
                      <i className="fa-solid fa-check" /> Approve
                    </button>
                    <button
                      className="btn btn-outline btn-sm"
                      style={{ fontSize: 11, color: "var(--danger)" }}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleReject(a);
                      }}
                    >
                      <i className="fa-solid fa-times" /> Reject
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── RIGHT PANEL: Detail view ── */}
      {selected && (
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
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
            <div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{selected.name}</div>
              <div style={{ fontSize: 12, color: "var(--text2)", marginTop: 2 }}>Applied {selected.date}</div>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {statusBadge(selected.status)}
              <button
                style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "var(--text2)" }}
                onClick={() => setSelected(null)}
              >
                ×
              </button>
            </div>
          </div>

          <DetailSection title="Personal Details">
            <DetailRow label="Full Name" value={selected.name} />
            <DetailRow label="Date of Birth" value={selected.dob || "—"} />
            <DetailRow label="Gender" value={selected.gender || "—"} />
            <DetailRow label="Nationality" value={(selected as any).nationality || "—"} />
            <DetailRow
              label="National ID"
              value={(selected as any).nationalId || (selected as any).national_id || "—"}
            />
          </DetailSection>

          <DetailSection title="Contact Information">
            <DetailRow label="Mobile" value={selected.mobile || "—"} />
            <DetailRow label="Email" value={selected.email || "—"} />
          </DetailSection>

          <DetailSection title="Guardian / Next of Kin">
            <DetailRow
              label="Guardian Name"
              value={(selected as any).guardianName || (selected as any).guardian_name || "—"}
            />
            <DetailRow
              label="Guardian Mobile"
              value={(selected as any).guardianMobile || (selected as any).guardian_mobile || "—"}
            />
            <DetailRow
              label="Guardian Email"
              value={(selected as any).guardianEmail || (selected as any).guardian_email || "—"}
            />
          </DetailSection>

          <DetailSection title="Programme">
            <DetailRow
              label="Programme"
              value={
                db.config.programmes.find((p: any) => p.id === selected.programme)?.name || selected.programme || "—"
              }
            />
            {(selected as any).message && <DetailRow label="Message" value={(selected as any).message} />}
          </DetailSection>

          {selected.status === "pending" && (
            <div style={{ display: "flex", gap: 10, marginTop: 24 }}>
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => handleApprove(selected)}>
                <i className="fa-solid fa-user-check" style={{ marginRight: 6 }} /> Approve & Create Account
              </button>
              <button
                className="btn btn-outline"
                style={{ color: "var(--danger)" }}
                onClick={() => handleReject(selected)}
              >
                <i className="fa-solid fa-times" style={{ marginRight: 6 }} /> Reject
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── HELPERS ────────────────────────────────────────────────────────────────────
function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div
        style={{
          fontWeight: 700,
          fontSize: 12,
          color: "#002060",
          textTransform: "uppercase",
          letterSpacing: 0.5,
          borderBottom: "1px solid var(--border)",
          paddingBottom: 4,
          marginBottom: 10,
        }}
      >
        {title}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 16px" }}>{children}</div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ fontSize: 13 }}>
      <span style={{ color: "var(--text2)", fontSize: 11 }}>{label}</span>
      <div style={{ fontWeight: 500, marginTop: 1 }}>{value}</div>
    </div>
  );
}

async function doApprove(a: any, studentId: string, password: string, toast: any, closeModal: any, reloadDb: any) {
  // 1. Create student record (no class assigned — admin will assign later)
  const sId = "s" + Date.now();
  const { error: stuErr } = await supabase.from("students").insert({
    id: sId,
    student_id: studentId,
    name: a.name,
    gender: a.gender || "",
    dob: a.dob || null,
    mobile: a.mobile || "",
    email: a.email || "",
    national_id: a.national_id || a.nationalId || "",
    guardian: a.guardian_name || a.guardianName || "",
    guardian_email: a.guardian_email || a.guardianEmail || "",
    guardian_mobile: a.guardian_mobile || a.guardianMobile || "",
    class_id: null,
    programme: a.programme || "",
    year: 1,
    semester: 1,
    status: "active",
  });

  if (stuErr) {
    toast("Failed to create student: " + stuErr.message, "error");
    return;
  }

  // 2. Create login account (if email provided)
  if (a.email) {
    const { data, error: userErr } = await supabase.functions.invoke("create-user", {
      body: {
        email: a.email,
        password,
        name: a.name,
        role: "student",
        dept: "",
        student_ref: sId,
        student_id: studentId,
      },
    });
    if (userErr || data?.error) {
      toast(`Student record created but login account failed: ${data?.error || userErr?.message}`, "error");
    } else {
      toast(`✓ Account created — Email: ${a.email}  Password: ${password}`, "success");
    }
  } else {
    toast(`✓ Student record created (no email — login account skipped)`, "success");
  }

  // 3. Mark application as approved
  await supabase.from("admission_enquiries").update({ status: "approved" }).eq("id", a.id);

  closeModal();
  reloadDb();
}
