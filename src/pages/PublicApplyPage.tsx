import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import logoImg from "@/assets/logo.jpg";

interface Programme {
  id: string;
  name: string;
  type: string;
  years: number;
  semesters: number;
  level?: number;
}
interface Module {
  id: string;
  name: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────
export default function PublicApplyPage() {
  const [step, setStep] = useState<"list" | "form" | "success">("list");
  const [programmes, setProgrammes] = useState<Programme[]>([]);
  const [modMap, setModMap] = useState<Record<string, Module[]>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [firstChoice, setFirstChoice] = useState<Programme | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [{ data: progs }, { data: classes }, { data: mcs }, { data: mods }] = await Promise.all([
        supabase.from("programmes").select("*"),
        supabase.from("classes").select("id,programme"),
        supabase.from("module_classes").select("module_id,class_id"),
        supabase.from("modules").select("id,name"),
      ]);
      setProgrammes(progs || []);
      const clsProg: Record<string, string> = {};
      (classes || []).forEach((c: any) => {
        clsProg[c.id] = c.programme;
      });
      const modName: Record<string, string> = {};
      (mods || []).forEach((m: any) => {
        modName[m.id] = m.name;
      });
      const pm: Record<string, Module[]> = {};
      const seen: Record<string, Set<string>> = {};
      (mcs || []).forEach((mc: any) => {
        const pid = clsProg[mc.class_id];
        if (!pid) return;
        if (!pm[pid]) {
          pm[pid] = [];
          seen[pid] = new Set();
        }
        if (!seen[pid].has(mc.module_id) && modName[mc.module_id]) {
          seen[pid].add(mc.module_id);
          pm[pid].push({ id: mc.module_id, name: modName[mc.module_id] });
        }
      });
      setModMap(pm);
      setLoading(false);
    })();
  }, []);

  if (step === "success") return <SuccessScreen />;
  if (step === "form" && firstChoice)
    return (
      <RegistrationForm
        firstChoice={firstChoice}
        allProgrammes={programmes}
        onBack={() => setStep("list")}
        onSuccess={() => setStep("success")}
      />
    );

  // ── Programme Listing ───────────────────────────────────────────────────────
  return (
    <PageShell>
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "32px 16px" }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <h1 style={{ color: "#002060", fontSize: 26, fontWeight: 800, margin: "0 0 8px" }}>Available Programmes</h1>
          <p style={{ color: "#555", fontSize: 14 }}>Browse our programmes and the modules they contain, then apply.</p>
        </div>

        {loading ? (
          <div style={{ textAlign: "center", padding: 60, color: "#888" }}>Loading programmes…</div>
        ) : (
          programmes.map((p) => {
            const isOpen = expandedId === p.id;
            const mods = modMap[p.id] || [];
            return (
              <div
                key={p.id}
                style={{
                  background: "#fff",
                  borderRadius: 10,
                  border: "1px solid #e2e8f0",
                  marginBottom: 14,
                  overflow: "hidden",
                  boxShadow: "0 1px 4px rgba(0,0,0,0.05)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "18px 22px",
                    cursor: "pointer",
                  }}
                  onClick={() => setExpandedId(isOpen ? null : p.id)}
                >
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 16, color: "#002060" }}>{p.name}</div>
                    <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                      <Chip col="#002060">{p.type}</Chip>
                      {p.level && <Chip col="#C9A227">Level {p.level}</Chip>}
                      <Chip col="#4b5563">
                        {p.years} {p.years === 1 ? "Year" : "Years"}
                      </Chip>
                      <Chip col="#4b5563">{mods.length} Modules</Chip>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <button
                      className="btn btn-primary btn-sm"
                      style={{ fontSize: 12 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setFirstChoice(p);
                        setStep("form");
                      }}
                    >
                      Apply Now →
                    </button>
                    <span style={{ color: "#888", fontSize: 16 }}>{isOpen ? "▲" : "▼"}</span>
                  </div>
                </div>
                {isOpen && (
                  <div style={{ borderTop: "1px solid #e2e8f0", padding: "16px 22px", background: "#f8fafc" }}>
                    <div
                      style={{
                        fontWeight: 600,
                        fontSize: 12,
                        color: "#002060",
                        marginBottom: 10,
                        textTransform: "uppercase",
                        letterSpacing: 0.5,
                      }}
                    >
                      Modules
                    </div>
                    {mods.length === 0 ? (
                      <div style={{ color: "#888", fontSize: 13 }}>No modules listed yet.</div>
                    ) : (
                      <div
                        style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))", gap: 8 }}
                      >
                        {mods.map((m, i) => (
                          <div
                            key={m.id}
                            style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#374151" }}
                          >
                            <span
                              style={{
                                background: "#002060",
                                color: "#fff",
                                borderRadius: "50%",
                                width: 20,
                                height: 20,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontSize: 10,
                                flexShrink: 0,
                              }}
                            >
                              {i + 1}
                            </span>
                            {m.name}
                          </div>
                        ))}
                      </div>
                    )}
                    <button
                      className="btn btn-primary"
                      style={{ marginTop: 16, fontSize: 13 }}
                      onClick={() => {
                        setFirstChoice(p);
                        setStep("form");
                      }}
                    >
                      Apply for {p.name} →
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
        <div style={{ textAlign: "center", marginTop: 24, fontSize: 12, color: "#888" }}>
          Already have an account?{" "}
          <a href="/" style={{ color: "#002060", fontWeight: 600 }}>
            Sign In
          </a>
        </div>
      </div>
    </PageShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// REGISTRATION + APPLICATION FORM
// ─────────────────────────────────────────────────────────────────────────────
function RegistrationForm({
  firstChoice,
  allProgrammes,
  onBack,
  onSuccess,
}: {
  firstChoice: Programme;
  allProgrammes: Programme[];
  onBack: () => void;
  onSuccess: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Personal
  const [name, setName] = useState("");
  const [dob, setDob] = useState("");
  const [gender, setGender] = useState("");
  const [nationality, setNationality] = useState("Motswana");
  const [nationalId, setNationalId] = useState("");
  const [mobile, setMobile] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  // Guardian
  const [guardName, setGuardName] = useState("");
  const [guardMobile, setGuardMobile] = useState("");
  const [guardEmail, setGuardEmail] = useState("");
  // Programme
  const [secondChoice, setSecondChoice] = useState("");
  // Documents
  const [idFile, setIdFile] = useState<File | null>(null);
  const [qualFile, setQualFile] = useState<File | null>(null);
  // Declaration
  const [agreed, setAgreed] = useState(false);

  const idRef = useRef<HTMLInputElement>(null);
  const qualRef = useRef<HTMLInputElement>(null);

  const handleSubmit = async () => {
    setError("");
    if (!name.trim()) {
      setError("Full name is required.");
      return;
    }
    if (!email.trim()) {
      setError("Email address is required.");
      return;
    }
    if (!mobile.trim()) {
      setError("Mobile number is required.");
      return;
    }
    if (!password) {
      setError("Password is required.");
      return;
    }
    if (password !== confirmPwd) {
      setError("Passwords do not match.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (!agreed) {
      setError("You must agree to the declaration before submitting.");
      return;
    }

    setSubmitting(true);
    try {
      // 1 — Create auth account
      const { data: authData, error: authErr } = await supabase.auth.signUp({ email: email.trim(), password });
      if (authErr) {
        setError(authErr.message);
        setSubmitting(false);
        return;
      }
      const userId = authData.user?.id;
      if (!userId) {
        setError("Account creation failed. Please try again.");
        setSubmitting(false);
        return;
      }

      // 2 — Upload documents (optional)
      let idUrl = "",
        qualUrl = "";
      if (idFile) {
        const { data: up } = await supabase.storage.from("applicant-docs").upload(`${userId}/id_${Date.now()}`, idFile);
        if (up) idUrl = up.path;
      }
      if (qualFile) {
        const { data: up } = await supabase.storage
          .from("applicant-docs")
          .upload(`${userId}/qual_${Date.now()}`, qualFile);
        if (up) qualUrl = up.path;
      }

      // 3 — Create applicant profile
      const applicantId = "app_" + Date.now();
      await supabase.from("applicants").insert({
        id: applicantId,
        user_id: userId,
        name: name.trim(),
        email: email.trim(),
        dob: dob || null,
        gender,
        nationality,
        national_id: nationalId,
        mobile: mobile.trim(),
        guardian_name: guardName,
        guardian_mobile: guardMobile,
        guardian_email: guardEmail,
        id_document_url: idUrl,
        qualification_url: qualUrl,
      });

      // 4 — Create application record
      await supabase.from("applications").insert({
        id: "appl_" + Date.now(),
        applicant_id: applicantId,
        first_choice_programme: firstChoice.id,
        second_choice_programme: secondChoice || null,
        status: "submitted",
        submitted_at: new Date().toISOString(),
      });

      // 5 — Set role as applicant
      await supabase.from("user_roles").insert([{ user_id: userId, role: "applicant" as any }]);
      await supabase.from("profiles").insert([{ user_id: userId, name: name.trim(), email: email.trim() }]);

      onSuccess();
    } catch (e: any) {
      setError(e.message || "An unexpected error occurred.");
    }
    setSubmitting(false);
  };

  const otherProgrammes = allProgrammes.filter((p) => p.id !== firstChoice.id);

  return (
    <PageShell>
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "28px 16px" }}>
        <button
          onClick={onBack}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "#002060",
            fontSize: 13,
            fontWeight: 600,
            marginBottom: 16,
            padding: 0,
          }}
        >
          ← Back to Programmes
        </button>

        {/* Programme badge */}
        <div style={{ background: "#002060", borderRadius: "10px 10px 0 0", padding: "18px 24px" }}>
          <div
            style={{ color: "#C9A227", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}
          >
            Applying for
          </div>
          <div style={{ color: "#fff", fontSize: 18, fontWeight: 800, marginTop: 2 }}>{firstChoice.name}</div>
          <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
            <Chip col="#C9A227">{firstChoice.type}</Chip>
            {firstChoice.level && <Chip col="#C9A227">Level {firstChoice.level}</Chip>}
          </div>
        </div>

        <div
          style={{
            background: "#fff",
            borderRadius: "0 0 10px 10px",
            padding: "28px 28px 32px",
            boxShadow: "0 4px 20px rgba(0,0,0,0.07)",
          }}
        >
          {error && (
            <div
              style={{
                background: "#fef2f2",
                border: "1px solid #fca5a5",
                borderRadius: 8,
                padding: "10px 14px",
                color: "#dc2626",
                fontSize: 13,
                marginBottom: 16,
              }}
            >
              {error}
            </div>
          )}

          {/* ── Account ── */}
          <FSec title="Create Your Account">
            <div className="form-row cols2">
              <FG label="Email Address *">
                <input
                  className="form-input"
                  type="email"
                  placeholder="your@email.com"
                  onChange={(e) => setEmail(e.target.value)}
                />
              </FG>
              <FG label="Mobile Number *">
                <input
                  className="form-input"
                  placeholder="+267 7X XXX XXX"
                  onChange={(e) => setMobile(e.target.value)}
                />
              </FG>
            </div>
            <div className="form-row cols2">
              <FG label="Password *">
                <input
                  className="form-input"
                  type="password"
                  placeholder="Min 8 characters"
                  onChange={(e) => setPassword(e.target.value)}
                />
              </FG>
              <FG label="Confirm Password *">
                <input
                  className="form-input"
                  type="password"
                  placeholder="Repeat password"
                  onChange={(e) => setConfirmPwd(e.target.value)}
                />
              </FG>
            </div>
          </FSec>

          {/* ── Personal ── */}
          <FSec title="Personal Details">
            <div className="form-row cols2">
              <FG label="Full Name *">
                <input
                  className="form-input"
                  placeholder="Full name as per ID"
                  onChange={(e) => setName(e.target.value)}
                />
              </FG>
              <FG label="Date of Birth">
                <input className="form-input" type="date" onChange={(e) => setDob(e.target.value)} />
              </FG>
            </div>
            <div className="form-row cols2">
              <FG label="Gender">
                <select className="form-select" onChange={(e) => setGender(e.target.value)}>
                  <option value="">— Select —</option>
                  <option>Male</option>
                  <option>Female</option>
                  <option>Other</option>
                </select>
              </FG>
              <FG label="Nationality">
                <input
                  className="form-input"
                  defaultValue="Motswana"
                  onChange={(e) => setNationality(e.target.value)}
                />
              </FG>
            </div>
            <FG label="National ID / Passport Number">
              <input
                className="form-input"
                placeholder="ID or passport number"
                onChange={(e) => setNationalId(e.target.value)}
              />
            </FG>
          </FSec>

          {/* ── Guardian ── */}
          <FSec title="Guardian / Next of Kin">
            <FG label="Guardian Full Name">
              <input
                className="form-input"
                placeholder="Guardian's full name"
                onChange={(e) => setGuardName(e.target.value)}
              />
            </FG>
            <div className="form-row cols2">
              <FG label="Guardian Mobile">
                <input
                  className="form-input"
                  placeholder="+267 7X XXX XXX"
                  onChange={(e) => setGuardMobile(e.target.value)}
                />
              </FG>
              <FG label="Guardian Email">
                <input
                  className="form-input"
                  type="email"
                  placeholder="optional"
                  onChange={(e) => setGuardEmail(e.target.value)}
                />
              </FG>
            </div>
          </FSec>

          {/* ── Programme choices ── */}
          <FSec title="Programme Choices">
            <FG label="First Choice (pre-selected)">
              <input
                className="form-input"
                value={firstChoice.name}
                disabled
                style={{ background: "#f3f4f6", color: "#374151" }}
              />
            </FG>
            <FG label="Second Choice (optional)">
              <select className="form-select" onChange={(e) => setSecondChoice(e.target.value)}>
                <option value="">— Select a second choice —</option>
                {otherProgrammes.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.type})
                  </option>
                ))}
              </select>
            </FG>
          </FSec>

          {/* ── Documents ── */}
          <FSec title="Supporting Documents">
            <div
              style={{
                background: "#f8fafc",
                border: "1px solid #e2e8f0",
                borderRadius: 8,
                padding: "12px 16px",
                fontSize: 12,
                color: "#555",
                marginBottom: 12,
              }}
            >
              Please upload certified copies. Accepted formats: PDF, JPG, PNG (max 5MB each).
            </div>
            <div className="form-row cols2">
              <FG label="Certified Copy of ID / Passport">
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => idRef.current?.click()}>
                    <i className="fa-solid fa-upload" style={{ marginRight: 4 }} />
                    {idFile ? idFile.name : "Choose File"}
                  </button>
                  <input
                    ref={idRef}
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png"
                    style={{ display: "none" }}
                    onChange={(e) => setIdFile(e.target.files?.[0] || null)}
                  />
                  {idFile && <span style={{ fontSize: 11, color: "#16a34a" }}>✓ Selected</span>}
                </div>
              </FG>
              <FG label="Certified Copy of Highest Qualification">
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => qualRef.current?.click()}>
                    <i className="fa-solid fa-upload" style={{ marginRight: 4 }} />
                    {qualFile ? qualFile.name : "Choose File"}
                  </button>
                  <input
                    ref={qualRef}
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png"
                    style={{ display: "none" }}
                    onChange={(e) => setQualFile(e.target.files?.[0] || null)}
                  />
                  {qualFile && <span style={{ fontSize: 11, color: "#16a34a" }}>✓ Selected</span>}
                </div>
              </FG>
            </div>
          </FSec>

          {/* ── Declaration ── */}
          <Declaration applicantName={name} agreed={agreed} onToggle={() => setAgreed((a) => !a)} />

          <button
            className="btn btn-primary"
            style={{ width: "100%", marginTop: 20, padding: "13px 0", fontSize: 15, fontWeight: 700 }}
            onClick={handleSubmit}
            disabled={submitting || !agreed}
          >
            {submitting ? "Submitting…" : "Submit Application"}
          </button>
          <p style={{ fontSize: 11, color: "#999", textAlign: "center", marginTop: 8 }}>
            By submitting you confirm all information is accurate. You will be able to log in to track your application.
          </p>
        </div>
      </div>
    </PageShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DECLARATION
// ─────────────────────────────────────────────────────────────────────────────
const DECLARATION_BULLETS = [
  "I will abide by the Institute's rules.",
  "I am able to read and write English.",
  "I hold myself responsible for the payment of all fees and charges due to Bosswa each year. any arrears and interest on arrears as defined in this year's fee booklet; and any costs of recovery, including attorney-and-client scale fees and/or collection commission. If I do not inform Bosswa in writing of withdrawal from studies or a course by the prescribed date(s) I will be liable for full fees even if I do not make use of Bosswa facilities.",
  "Payment plans are available, and the total amount payable must be settled before the end of the academic year. If I am unable to pay my monthly installment, I understand that I can and will be removed from my classes and will only be allowed back once arrears have been settled.",
  "The onus/responsibility of settling course fees is the sole responsibility of government sponsored students, and their course fees are to be settled in full before commencement of said studies.",
  "I waive all claims against Bosswa, its staff and directors for: any damage or loss suffered while I am, or as a consequence of my being, a Bosswa student and/or arising out of loss or destruction of, or damage to any property belonging to me or any other person.",
  "I have not been expelled, rusticated or excluded from any other Institute.",
  "The information given on this form is complete and accurate. If I fail to disclose or falsely declare information (for example, non-disclosure of previous tertiary studies), this could lead to disciplinary action and/or the cancellation of my application and/or registration at Bosswa.",
  "Agree to allow Bosswa Culinary Institute of Botswana to debit my bank account monthly the above-mentioned amount on the first (1st) of each calendar month for the agreed term.",
];

function Declaration({
  applicantName,
  agreed,
  onToggle,
}: {
  applicantName: string;
  agreed: boolean;
  onToggle: () => void;
}) {
  return (
    <div style={{ border: "1px solid #d1d5db", borderRadius: 8, overflow: "hidden", marginTop: 8 }}>
      <div style={{ background: "#002060", padding: "10px 16px" }}>
        <div style={{ color: "#fff", fontWeight: 700, fontSize: 14 }}>Declaration</div>
        <div style={{ color: "#C9A227", fontSize: 11, marginTop: 2 }}>Please read carefully before submitting</div>
      </div>
      <div style={{ padding: "16px 18px", background: "#fafafa" }}>
        <p style={{ fontSize: 13, color: "#374151", marginBottom: 12 }}>
          Without prejudice to the terms of my application for admission, I make the following declarations:
        </p>
        <ul style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 8 }}>
          {DECLARATION_BULLETS.map((b, i) => (
            <li key={i} style={{ fontSize: 12, color: "#4b5563", lineHeight: 1.6 }}>
              {b}
            </li>
          ))}
        </ul>
        <div
          style={{
            marginTop: 20,
            padding: "14px 16px",
            background: "#fff",
            border: "1px dashed #d1d5db",
            borderRadius: 6,
            fontSize: 13,
            color: "#374151",
            lineHeight: 1.8,
          }}
        >
          I,{" "}
          <span
            style={{
              borderBottom: "1px solid #002060",
              minWidth: 200,
              display: "inline-block",
              padding: "0 4px",
              color: applicantName ? "#002060" : "#9ca3af",
              fontWeight: applicantName ? 700 : 400,
            }}
          >
            {applicantName || "____________________________"}
          </span>
          , hereby formally declare the above and apply for studies at Bosswa Culinary Institute of Botswana.
        </div>
        <label style={{ display: "flex", alignItems: "flex-start", gap: 10, marginTop: 14, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={agreed}
            onChange={onToggle}
            style={{ marginTop: 2, width: 16, height: 16, flexShrink: 0, accentColor: "#002060" }}
          />
          <span style={{ fontSize: 13, color: "#374151", lineHeight: 1.5 }}>
            I have read and understood the declaration above and confirm that all information provided is accurate and
            complete.
          </span>
        </label>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SUCCESS
// ─────────────────────────────────────────────────────────────────────────────
function SuccessScreen() {
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
          padding: 48,
          maxWidth: 500,
          textAlign: "center",
          boxShadow: "0 4px 24px rgba(0,0,0,0.08)",
        }}
      >
        <div
          style={{
            width: 72,
            height: 72,
            background: "#dcfce7",
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto 20px",
            fontSize: 32,
          }}
        >
          ✓
        </div>
        <h2 style={{ color: "#002060", marginBottom: 10, fontSize: 22 }}>Application Submitted!</h2>
        <p style={{ color: "#555", lineHeight: 1.7, fontSize: 14 }}>
          Your application has been received. You can log in at any time to track the status of your application.
        </p>
        <div
          style={{
            marginTop: 20,
            padding: "12px 16px",
            background: "#f8faff",
            borderRadius: 8,
            border: "1px solid #dde3f0",
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 700, color: "#002060" }}>Boswa Culinary Institute of Botswana</div>
          <div style={{ fontSize: 11, color: "#999", marginTop: 2 }}>www.boswa.ac.bw</div>
        </div>
        <a href="/" style={{ display: "inline-block", marginTop: 20, fontSize: 13, color: "#002060", fontWeight: 600 }}>
          Sign In to Track Your Application →
        </a>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SHARED LAYOUT / HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", background: "#f0f4f8" }}>
      <div style={{ background: "#002060", padding: "14px 32px", display: "flex", alignItems: "center", gap: 16 }}>
        <img src={logoImg} alt="Boswa" style={{ height: 44 }} />
        <div>
          <div style={{ color: "#fff", fontWeight: 800, fontSize: 15 }}>Boswa Culinary Institute of Botswana</div>
          <div style={{ color: "#C9A227", fontSize: 11 }}>Student Admissions</div>
        </div>
        <div style={{ marginLeft: "auto" }}>
          <a href="/" style={{ color: "#C9A227", fontSize: 12, fontWeight: 600 }}>
            Already have an account? Sign In →
          </a>
        </div>
      </div>
      {children}
    </div>
  );
}

function Chip({ children, col }: { children: React.ReactNode; col: string }) {
  return (
    <span
      style={{
        background: col + "18",
        color: col,
        border: `1px solid ${col}44`,
        borderRadius: 4,
        padding: "2px 8px",
        fontSize: 11,
        fontWeight: 600,
      }}
    >
      {children}
    </span>
  );
}
function FSec({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <div
        style={{
          fontWeight: 700,
          fontSize: 13,
          color: "#002060",
          borderBottom: "2px solid #C9A227",
          paddingBottom: 5,
          marginBottom: 14,
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}
function FG({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="form-group">
      <label>{label}</label>
      {children}
    </div>
  );
}
