import { useState, useEffect, useCallback, type ReactNode } from "react";
import { useApp } from "@/context/AppContext";
import { supabase } from "@/integrations/supabase/client";

interface Application {
  id: string;
  status: string;
  submitted_at: string;
  first_choice_programme: string;
  second_choice_programme?: string;
  applicant_id: string;
  sponsor_type?: string;
  sponsor_doc_url?: string;
  rejection_reason?: string;
  // joined
  applicant_name: string;
  applicant_email: string;
  applicant_mobile: string;
  applicant_dob: string;
  applicant_gender: string;
  applicant_nationality: string;
  applicant_national_id: string;
  applicant_guardian_name: string;
  applicant_guardian_mobile: string;
  applicant_guardian_email: string;
  applicant_id_doc: string;
  applicant_qual_doc: string;
  applicant_user_id: string;
  first_prog_name: string;
  second_prog_name: string;
}

const STATUS_COLOR: Record<string, string> = {
  submitted: "#1d4ed8",
  under_review: "#b45309",
  accepted: "#15803d",
  rejected: "#dc2626",
  awaiting_enrollment: "#7c3aed",
  enrolled: "#15803d",
};
const STATUS_BG: Record<string, string> = {
  submitted: "#eff6ff",
  under_review: "#fffbeb",
  accepted: "#f0fdf4",
  rejected: "#fef2f2",
  awaiting_enrollment: "#f5f3ff",
  enrolled: "#f0fdf4",
};

export default function AdmissionsPage() {
  const { db, toast, showModal, closeModal, reloadDb } = useApp();
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Application | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: appls } = await supabase.from("applications").select("*").order("submitted_at", { ascending: false });
    if (!appls || appls.length === 0) {
      setApplications([]);
      setLoading(false);
      return;
    }

    // Get all applicant + programme data
    const applicantIds = [...new Set(appls.map((a: any) => a.applicant_id))];
    const progIds = [
      ...new Set(
        [
          ...appls.map((a: any) => a.first_choice_programme),
          ...appls.map((a: any) => a.second_choice_programme),
        ].filter(Boolean),
      ),
    ];

    const [{ data: applicants }, { data: progs }] = await Promise.all([
      supabase.from("applicants").select("*").in("id", applicantIds),
      supabase.from("programmes").select("id,name").in("id", progIds),
    ]);

    const appMap: Record<string, any> = {};
    (applicants || []).forEach((a: any) => {
      appMap[a.id] = a;
    });
    const progMap: Record<string, string> = {};
    (progs || []).forEach((p: any) => {
      progMap[p.id] = p.name;
    });

    const merged: Application[] = appls.map((a: any) => {
      const ap = appMap[a.applicant_id] || {};
      return {
        ...a,
        applicant_name: ap.name || "—",
        applicant_email: ap.email || "—",
        applicant_mobile: ap.mobile || "—",
        applicant_dob: ap.dob || "—",
        applicant_gender: ap.gender || "—",
        applicant_nationality: ap.nationality || "—",
        applicant_national_id: ap.national_id || "—",
        applicant_guardian_name: ap.guardian_name || "—",
        applicant_guardian_mobile: ap.guardian_mobile || "—",
        applicant_guardian_email: ap.guardian_email || "—",
        applicant_id_doc: ap.id_document_url || "",
        applicant_qual_doc: ap.qualification_url || "",
        applicant_user_id: ap.user_id || "",
        first_prog_name: progMap[a.first_choice_programme] || a.first_choice_programme || "—",
        second_prog_name: a.second_choice_programme ? progMap[a.second_choice_programme] || "—" : "—",
      };
    });
    setApplications(merged);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const statusCounts: Record<string, number> = { all: applications.length };
  applications.forEach((a) => {
    statusCounts[a.status] = (statusCounts[a.status] || 0) + 1;
  });

  const filtered = applications.filter((a) => {
    const matchStatus = filter === "all" || a.status === filter;
    const matchSearch =
      !search ||
      a.applicant_name.toLowerCase().includes(search.toLowerCase()) ||
      a.applicant_email.toLowerCase().includes(search.toLowerCase());
    return matchStatus && matchSearch;
  });

  // ── Open detail — mark as under_review ──
  const handleOpen = async (a: Application) => {
    setSelected(a);
    if (a.status === "submitted") {
      await supabase
        .from("applications")
        .update({ status: "under_review", reviewed_at: new Date().toISOString() })
        .eq("id", a.id);
      setSelected({ ...a, status: "under_review" });
      setApplications((prev) => prev.map((x) => (x.id === a.id ? { ...x, status: "under_review" } : x)));
    }
  };

  // ── Accept ──
  const handleAccept = (a: Application) => {
    let reason = "";
    showModal(
      "Accept Application — " + a.applicant_name,
      <div>
        <div
          style={{
            background: "#f0fdf4",
            border: "1px solid #86efac",
            borderRadius: 8,
            padding: "10px 14px",
            marginBottom: 16,
            fontSize: 12,
          }}
        >
          <strong style={{ color: "#15803d" }}>✓ Accepting this application</strong>
          <div style={{ color: "#15803d", marginTop: 2 }}>
            An offer letter will be generated and the applicant will be notified.
          </div>
        </div>
        <div className="form-group">
          <label>Notes for applicant (optional)</label>
          <textarea
            className="form-input"
            rows={3}
            placeholder="Any message to include in the offer letter…"
            onChange={(e) => (reason = e.target.value)}
            style={{ resize: "vertical" }}
          />
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button
            className="btn btn-primary"
            style={{ flex: 1 }}
            onClick={async () => {
              await supabase
                .from("applications")
                .update({ status: "accepted", decided_at: new Date().toISOString() })
                .eq("id", a.id);
              await supabase
                .from("notifications")
                .insert({
                  id: "notif_" + Date.now(),
                  title: "Application Accepted",
                  body: `${a.applicant_name}'s application has been accepted.`,
                  date: new Date().toISOString().split("T")[0],
                  priority: "normal",
                  author: "Admissions",
                });
              toast("Application accepted!", "success");
              closeModal();
              load();
              setSelected((prev) => (prev?.id === a.id ? { ...prev, status: "accepted" } : prev));
            }}
          >
            <i className="fa-solid fa-check" style={{ marginRight: 6 }} /> Confirm Accept
          </button>
          <button className="btn btn-outline" onClick={closeModal}>
            Cancel
          </button>
        </div>
      </div>,
    );
  };

  // ── Reject ──
  const handleReject = (a: Application) => {
    let reason = "";
    showModal(
      "Reject Application — " + a.applicant_name,
      <div>
        <div
          style={{
            background: "#fef2f2",
            border: "1px solid #fca5a5",
            borderRadius: 8,
            padding: "10px 14px",
            marginBottom: 16,
            fontSize: 12,
          }}
        >
          <strong style={{ color: "#dc2626" }}>Rejecting this application</strong>
        </div>
        <div className="form-group">
          <label>Reason for rejection *</label>
          <textarea
            className="form-input"
            rows={3}
            placeholder="Reason shown to the applicant in the rejection letter…"
            onChange={(e) => (reason = e.target.value)}
            style={{ resize: "vertical" }}
          />
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button
            className="btn btn-outline"
            style={{ flex: 1, color: "var(--danger)", borderColor: "var(--danger)" }}
            onClick={async () => {
              if (!reason.trim()) {
                toast("Please provide a reason.", "error");
                return;
              }
              await supabase
                .from("applications")
                .update({ status: "rejected", rejection_reason: reason, decided_at: new Date().toISOString() })
                .eq("id", a.id);
              toast("Application rejected", "success");
              closeModal();
              load();
              setSelected((prev) =>
                prev?.id === a.id ? { ...prev, status: "rejected", rejection_reason: reason } : prev,
              );
            }}
          >
            <i className="fa-solid fa-times" style={{ marginRight: 6 }} /> Confirm Reject
          </button>
          <button className="btn btn-outline" onClick={closeModal}>
            Cancel
          </button>
        </div>
      </div>,
    );
  };

  // ── Enroll ──
  const handleEnroll = (a: Application) => {
    let sid = "BCI" + new Date().getFullYear() + "-" + Math.floor(1000 + Math.random() * 9000);
    let password = "BoswaStudent2026!";

    showModal(
      "Enroll Student — " + a.applicant_name,
      <div>
        <div
          style={{
            background: "#f0fdf4",
            border: "1px solid #86efac",
            borderRadius: 8,
            padding: "10px 14px",
            marginBottom: 16,
            fontSize: 12,
          }}
        >
          <strong style={{ color: "#15803d" }}>Enrolling applicant as a student</strong>
          <div style={{ color: "#15803d", marginTop: 2 }}>
            This will upgrade their account to a student role. Admin will assign a class later.
          </div>
        </div>
        <div className="form-row cols2">
          <div className="form-group">
            <label>Student ID</label>
            <input
              className="form-input"
              defaultValue={sid}
              onChange={(e) => { sid = e.target.value; }}
            />
          </div>
          <div className="form-group">
            <label>Student Password</label>
            <input
              className="form-input"
              defaultValue={password}
              onChange={(e) => { password = e.target.value; }}
            />
          </div>
        </div>
        <div style={{ fontSize: 11, color: "#888", marginBottom: 14 }}>
          Programme: <strong>{a.first_prog_name}</strong> · Email: <strong>{a.applicant_email}</strong>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            className="btn btn-primary"
            style={{ flex: 1 }}
            onClick={async () => {
              await doEnroll(a, sid, password, toast, closeModal, load, reloadDb);
            }}
          >
            <i className="fa-solid fa-user-graduate" style={{ marginRight: 6 }} /> Enroll Student
          </button>
          <button className="btn btn-outline" onClick={closeModal}>
            Cancel
          </button>
        </div>
      </div>,
    );
  };

  // ── Letter Settings ──
  const handleLetterSettings = () => {
    const cfg = (db as any).config || {};
    let signatoryName = cfg.offerLetterSignatory || "";
    let signatoryTitle = cfg.offerLetterSignatoryTitle || "";
    let sigPreviewUrl = cfg.offerLetterSignatureUrl || "";
    // Welcome letter signatory
    let wlSignatoryName  = cfg.welcomeLetterSignatory      || "";
    let wlSignatoryTitle = cfg.welcomeLetterSignatoryTitle || "";
    let wlSigPreviewUrl  = cfg.welcomeLetterSignatureUrl   || "";
    // Welcome letter event dates
    let wlUniformOpen  = cfg.wlUniformOpen  || "";
    let wlUniformClose = cfg.wlUniformClose || "";
    let wlRegStart     = cfg.wlRegStart     || "";
    let wlRegEnd       = cfg.wlRegEnd       || "";
    let wlInduction    = cfg.wlInduction    || "";
    let wlClassesStart = cfg.wlClassesStart || "";

    const doUpload = async (file: File, storageKey: string, onDone: (url: string) => void) => {
      const ext = file.name.split(".").pop();
      const path = `signatures/${storageKey}.${ext}`;
      const { error: upErr } = await supabase.storage.from("applicant-docs").upload(path, file, { upsert: true });
      if (upErr) { toast(upErr.message, "error"); return; }
      const { data: urlData } = supabase.storage.from("applicant-docs").getPublicUrl(path);
      onDone(urlData.publicUrl + "?t=" + Date.now());
    };

    const SectionLabel = ({ children }: { children: string }) => (
      <div style={{ fontWeight: 700, fontSize: 12, color: "#002060", borderBottom: "2px solid #C9A227", paddingBottom: 4, marginBottom: 12, marginTop: 20 }}>
        {children}
      </div>
    );

    const LetterSettingsForm = () => {
      const [offerPreview, setOfferPreview] = useState(sigPreviewUrl);
      const [offerUploading, setOfferUploading] = useState(false);
      const [wlPreview, setWlPreview] = useState(wlSigPreviewUrl);
      const [wlUploading, setWlUploading] = useState(false);

      return (
        <div style={{ maxHeight: "70vh", overflowY: "auto", paddingRight: 4 }}>

          {/* ── Offer Letter Signatory ── */}
          <SectionLabel>Offer Letter — Signatory</SectionLabel>
          <div className="form-row cols2">
            <div className="form-group">
              <label>Signatory Name</label>
              <input className="form-input" defaultValue={signatoryName} placeholder="Ms Claudette Latifa Ziteyo" onChange={(e) => (signatoryName = e.target.value)} />
            </div>
            <div className="form-group">
              <label>Signatory Title</label>
              <input className="form-input" defaultValue={signatoryTitle} placeholder="School Administration Manager" onChange={(e) => (signatoryTitle = e.target.value)} />
            </div>
          </div>
          <div className="form-group">
            <label>Offer Letter Signature Image</label>
            {offerPreview && (
              <div style={{ marginBottom: 8, padding: 8, background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 6 }}>
                <img src={offerPreview} alt="Signature" style={{ maxHeight: 70, maxWidth: 260 }} />
              </div>
            )}
            <input type="file" accept="image/*" className="form-input" disabled={offerUploading}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setOfferUploading(true);
                await doUpload(file, "offer_letter_signature", (url) => { sigPreviewUrl = url; setOfferPreview(url); });
                setOfferUploading(false);
              }}
            />
            {offerUploading && <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>Uploading…</div>}
            <div style={{ fontSize: 11, color: "#aaa", marginTop: 4 }}>PNG or JPG with transparent background recommended</div>
          </div>

          {/* ── Welcome Letter Signatory ── */}
          <SectionLabel>Welcome Letter — Signatory</SectionLabel>
          <div className="form-row cols2">
            <div className="form-group">
              <label>Signatory Name</label>
              <input className="form-input" defaultValue={wlSignatoryName} placeholder="Mr. Boisi Dibuile" onChange={(e) => (wlSignatoryName = e.target.value)} />
            </div>
            <div className="form-group">
              <label>Signatory Title</label>
              <input className="form-input" defaultValue={wlSignatoryTitle} placeholder="Deputy Principal & Head of Academics" onChange={(e) => (wlSignatoryTitle = e.target.value)} />
            </div>
          </div>
          <div className="form-group">
            <label>Welcome Letter Signature Image</label>
            {wlPreview && (
              <div style={{ marginBottom: 8, padding: 8, background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 6 }}>
                <img src={wlPreview} alt="Signature" style={{ maxHeight: 70, maxWidth: 260 }} />
              </div>
            )}
            <input type="file" accept="image/*" className="form-input" disabled={wlUploading}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setWlUploading(true);
                await doUpload(file, "welcome_letter_signature", (url) => { wlSigPreviewUrl = url; setWlPreview(url); });
                setWlUploading(false);
              }}
            />
            {wlUploading && <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>Uploading…</div>}
            <div style={{ fontSize: 11, color: "#aaa", marginTop: 4 }}>PNG or JPG with transparent background recommended</div>
          </div>

          {/* ── Welcome Letter Dates ── */}
          <SectionLabel>Welcome Letter — Event Dates</SectionLabel>
          <div className="form-row cols2">
            <div className="form-group">
              <label>Uniform Fitting Opens</label>
              <input type="date" className="form-input" defaultValue={wlUniformOpen} onChange={(e) => (wlUniformOpen = e.target.value)} />
            </div>
            <div className="form-group">
              <label>Uniform Fitting Closes</label>
              <input type="date" className="form-input" defaultValue={wlUniformClose} onChange={(e) => (wlUniformClose = e.target.value)} />
            </div>
          </div>
          <div className="form-row cols2">
            <div className="form-group">
              <label>Registration Starts</label>
              <input type="date" className="form-input" defaultValue={wlRegStart} onChange={(e) => (wlRegStart = e.target.value)} />
            </div>
            <div className="form-group">
              <label>Registration Ends</label>
              <input type="date" className="form-input" defaultValue={wlRegEnd} onChange={(e) => (wlRegEnd = e.target.value)} />
            </div>
          </div>
          <div className="form-row cols2">
            <div className="form-group">
              <label>Induction Date</label>
              <input type="date" className="form-input" defaultValue={wlInduction} onChange={(e) => (wlInduction = e.target.value)} />
            </div>
            <div className="form-group">
              <label>Classes Start</label>
              <input type="date" className="form-input" defaultValue={wlClassesStart} onChange={(e) => (wlClassesStart = e.target.value)} />
            </div>
          </div>

          <button
            className="btn btn-primary"
            style={{ marginTop: 16, width: "100%" }}
            onClick={async () => {
              const { error } = await supabase
                .from("school_config")
                .update({
                  offer_letter_signatory: signatoryName || null,
                  offer_letter_signatory_title: signatoryTitle || null,
                  offer_letter_signature_url: sigPreviewUrl || null,
                  welcome_letter_signatory: wlSignatoryName || null,
                  welcome_letter_signatory_title: wlSignatoryTitle || null,
                  welcome_letter_signature_url: wlSigPreviewUrl || null,
                  wl_uniform_open: wlUniformOpen || null,
                  wl_uniform_close: wlUniformClose || null,
                  wl_reg_start: wlRegStart || null,
                  wl_reg_end: wlRegEnd || null,
                  wl_induction: wlInduction || null,
                  wl_classes_start: wlClassesStart || null,
                } as any)
                .eq("id", 1);
              // Validate event date order
              if (wlRegStart && wlRegEnd && wlRegStart > wlRegEnd) {
                toast("Registration start date must be before end date", "error"); return;
              }
              if (wlUniformOpen && wlUniformClose && wlUniformOpen > wlUniformClose) {
                toast("Uniform fitting open date must be before close date", "error"); return;
              }
              if (error) { toast(error.message, "error"); return; }
              toast("Letter settings saved!", "success");
              closeModal();
              reloadDb();
            }}
          >
            Save All Settings
          </button>
        </div>
      );
    };

    showModal("Letter Settings", <LetterSettingsForm />);
  };

  const FILTERS = ["all", "submitted", "under_review", "accepted", "rejected", "awaiting_enrollment", "enrolled"];

  return (
    <div style={{ display: "flex", gap: 16, height: "calc(100vh - 120px)", overflow: "hidden" }}>
      {/* ── LEFT: List ── */}
      <div
        style={{
          flex: selected ? "0 0 400px" : "1",
          display: "flex",
          flexDirection: "column",
          gap: 12,
          overflow: "hidden",
        }}
      >
        <div className="page-header" style={{ margin: 0, padding: 0 }}>
          <div>
            <div className="page-title">Admissions</div>
            <div className="page-sub">
              {statusCounts["submitted"] || 0} pending review · {statusCounts["awaiting_enrollment"] || 0} awaiting
              enrollment
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-outline btn-sm" onClick={handleLetterSettings}>
              <i className="fa-solid fa-signature" /> Letter Settings
            </button>
            <a href="/apply" target="_blank" className="btn btn-outline btn-sm">
              <i className="fa-solid fa-arrow-up-right-from-square" /> Public Form
            </a>
          </div>
        </div>

        {/* Filter tabs — scrollable */}
        <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 4 }}>
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                padding: "5px 10px",
                fontSize: 11,
                borderRadius: 6,
                border: "none",
                cursor: "pointer",
                whiteSpace: "nowrap",
                fontWeight: filter === f ? 700 : 400,
                background: filter === f ? "var(--accent)" : "var(--bg2)",
                color: filter === f ? "#fff" : "var(--text1)",
              }}
            >
              {f === "all" ? "All" : f.replace("_", " ").replace(/\b\w/g, (c) => c.toUpperCase())} (
              {statusCounts[f] || 0})
            </button>
          ))}
        </div>

        <input
          className="search-input"
          placeholder="Search by name or email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
          {loading && <div style={{ textAlign: "center", padding: 40, color: "#888" }}>Loading…</div>}
          {!loading && filtered.length === 0 && (
            <div style={{ textAlign: "center", padding: 40, color: "#888", fontSize: 13 }}>No applications found</div>
          )}
          {filtered.map((a) => {
            const isSelected = selected?.id === a.id;
            const col = STATUS_COLOR[a.status] || "#888";
            const bg = STATUS_BG[a.status] || "#fff";
            return (
              <div
                key={a.id}
                onClick={() => handleOpen(a)}
                style={{
                  background: isSelected ? bg : "var(--card)",
                  border: `1px solid ${isSelected ? col + "66" : "var(--border)"}`,
                  borderLeft: `3px solid ${col}`,
                  borderRadius: 8,
                  padding: "12px 14px",
                  cursor: "pointer",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{a.applicant_name}</div>
                    <div style={{ fontSize: 12, color: "var(--text2)", marginTop: 2 }}>{a.first_prog_name}</div>
                    <div style={{ fontSize: 11, color: "var(--text2)", marginTop: 2 }}>{a.applicant_email}</div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                    <span
                      style={{
                        background: bg,
                        color: col,
                        border: `1px solid ${col}44`,
                        borderRadius: 4,
                        padding: "2px 8px",
                        fontSize: 10,
                        fontWeight: 700,
                      }}
                    >
                      {a.status.replace("_", " ").toUpperCase()}
                    </span>
                    <span style={{ fontSize: 10, color: "var(--text2)" }}>{a.submitted_at?.split("T")[0]}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── RIGHT: Detail ── */}
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
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
            <div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{selected.applicant_name}</div>
              <div style={{ fontSize: 12, color: "var(--text2)", marginTop: 2 }}>
                Applied {selected.submitted_at?.split("T")[0]}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <StatusBadge status={selected.status} />
              <button
                className="btn btn-danger btn-sm"
                onClick={async () => {
                  if (!confirm(`Delete application for "${selected.applicant_name}"? This cannot be undone.`)) return;
                  await supabase.from("applications").delete().eq("id", selected.id);
                  await supabase.from("applicants").delete().eq("id", selected.applicant_id);
                  if (selected.applicant_user_id) {
                    await supabase.from("user_roles").delete().eq("user_id", selected.applicant_user_id);
                    await supabase.from("profiles").delete().eq("user_id", selected.applicant_user_id);
                  }
                  toast("Applicant deleted", "success");
                  setSelected(null);
                  load();
                }}
              >
                <i className="fa-solid fa-trash" /> Delete
              </button>
              <button
                style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "var(--text2)" }}
                onClick={() => setSelected(null)}
              >
                ×
              </button>
            </div>
          </div>

          <DS title="Programme Choices">
            <DR label="1st Choice" value={selected.first_prog_name} />
            <DR label="2nd Choice" value={selected.second_prog_name || "—"} />
          </DS>
          <DS title="Personal Details">
            <DR label="Full Name" value={selected.applicant_name} />
            <DR label="Date of Birth" value={selected.applicant_dob} />
            <DR label="Gender" value={selected.applicant_gender} />
            <DR label="Nationality" value={selected.applicant_nationality} />
            <DR label="National ID" value={selected.applicant_national_id} />
          </DS>
          <DS title="Contact Information">
            <DR label="Mobile" value={selected.applicant_mobile} />
            <DR label="Email" value={selected.applicant_email} />
          </DS>
          <DS title="Guardian / Next of Kin">
            <DR label="Name" value={selected.applicant_guardian_name} />
            <DR label="Mobile" value={selected.applicant_guardian_mobile} />
            <DR label="Email" value={selected.applicant_guardian_email} />
          </DS>

          {/* Documents */}
          {(selected.applicant_id_doc || selected.applicant_qual_doc) && (
            <DS title="Uploaded Documents">
              {selected.applicant_id_doc && <DocBtn label="ID / Passport" path={selected.applicant_id_doc} />}
              {selected.applicant_qual_doc && <DocBtn label="Qualification" path={selected.applicant_qual_doc} />}
            </DS>
          )}

          {/* Sponsorship */}
          {selected.sponsor_type && (
            <DS title="Sponsorship">
              <DR label="Sponsor Type" value={selected.sponsor_type} />
              {selected.sponsor_doc_url && <DocBtn label="Sponsor Document" path={selected.sponsor_doc_url} />}
            </DS>
          )}

          {/* Rejection reason */}
          {selected.status === "rejected" && selected.rejection_reason && (
            <div
              style={{
                background: "#fef2f2",
                border: "1px solid #fca5a5",
                borderRadius: 8,
                padding: "10px 14px",
                fontSize: 13,
                color: "#dc2626",
                marginBottom: 16,
              }}
            >
              <strong>Rejection Reason:</strong> {selected.rejection_reason}
            </div>
          )}

          {/* Action buttons */}
          {(selected.status === "submitted" || selected.status === "under_review") && (
            <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => handleAccept(selected)}>
                <i className="fa-solid fa-check" style={{ marginRight: 6 }} /> Accept
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
          {selected.status === "awaiting_enrollment" && (
            <div style={{ marginTop: 20 }}>
              <div
                style={{
                  background: "#f5f3ff",
                  border: "1px solid #c4b5fd",
                  borderRadius: 8,
                  padding: "10px 14px",
                  fontSize: 12,
                  color: "#7c3aed",
                  marginBottom: 12,
                }}
              >
                Sponsorship documents have been submitted. Review them above, then enroll the student.
              </div>
              <button className="btn btn-primary" style={{ width: "100%" }} onClick={() => handleEnroll(selected)}>
                <i className="fa-solid fa-user-graduate" style={{ marginRight: 6 }} /> Enroll Student
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ENROLL
// ─────────────────────────────────────────────────────────────────────────────
async function doEnroll(
  a: Application,
  studentId: string,
  password: string,
  toast: any,
  closeModal: any,
  load: any,
  reloadDb: any,
) {
  const sId = "s" + Date.now();

  // 1 — Create student record
  const { error: stuErr } = await supabase.from("students").insert({
    id: sId,
    student_id: studentId,
    name: a.applicant_name,
    gender: a.applicant_gender || "",
    dob: a.applicant_dob !== "—" ? a.applicant_dob : null,
    mobile: a.applicant_mobile || "",
    email: a.applicant_email || "",
    national_id: a.applicant_national_id || "",
    guardian: a.applicant_guardian_name || "",
    guardian_email: a.applicant_guardian_email || "",
    guardian_mobile: a.applicant_guardian_mobile || "",
    class_id: null,
    programme: a.first_choice_programme || null,
    nationality: a.applicant_nationality || "",
    year: 1,
    semester: 1,
    status: "active",
    enrolment_date: new Date().toISOString().split("T")[0],
  });
  if (stuErr) {
    toast("Failed to create student: " + stuErr.message, "error");
    return;
  }

  // 2 — Upgrade user role from applicant → student
  if (a.applicant_user_id) {
    await supabase.from("user_roles").update({ role: "student" }).eq("user_id", a.applicant_user_id);
    await supabase
      .from("profiles")
      .update({ student_ref: sId, student_id: studentId })
      .eq("user_id", a.applicant_user_id);
  }

  // 3 — Mark application enrolled
  await supabase
    .from("applications")
    .update({ status: "enrolled", enrolled_at: new Date().toISOString() })
    .eq("id", a.id);

  toast("✓ Student enrolled successfully! Class assignment can be done from the Students page.", "success");
  closeModal();
  load();
  reloadDb();
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const col = STATUS_COLOR[status] || "#888";
  const bg = STATUS_BG[status] || "#f4f4f4";
  return (
    <span
      style={{
        background: bg,
        color: col,
        border: `1px solid ${col}44`,
        borderRadius: 4,
        padding: "3px 10px",
        fontSize: 11,
        fontWeight: 700,
      }}
    >
      {status.replace("_", " ").toUpperCase()}
    </span>
  );
}

function DS({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div
        style={{
          fontWeight: 700,
          fontSize: 11,
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
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 16px" }}>{children}</div>
    </div>
  );
}
function DR({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ fontSize: 13 }}>
      <div style={{ color: "var(--text2)", fontSize: 11 }}>{label}</div>
      <div style={{ fontWeight: 500, marginTop: 1 }}>{value}</div>
    </div>
  );
}
function DocBtn({ label, path }: { label: string; path: string }) {
  const handleView = async () => {
    const { data } = await supabase.storage.from("applicant-docs").createSignedUrl(path, 60);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
  };
  return (
    <div style={{ gridColumn: "1/-1" }}>
      <button className="btn btn-outline btn-sm" onClick={handleView}>
        <i className="fa-solid fa-file" style={{ marginRight: 6 }} /> View {label}
      </button>
    </div>
  );
}
