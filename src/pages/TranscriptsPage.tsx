import { useState, useEffect } from "react";
import { useApp } from "@/context/AppContext";
import { calcModuleMark } from "@/data/db";
import { supabase } from "@/integrations/supabase/client";
import { categorizeModuleAssessments, computeStudentModuleMark } from "@/lib/moduleMark";
import { letterGrade, gradePoint, GRADE_SCALE } from "@/lib/grading";

// Roles permitted to edit the transcript signatory ("admin and above").
const CAN_EDIT_ISSUER = ["admin", "super_admin"];

// ── Grading ───────────────────────────────────────────────────────────────────
// The letter-grade scale, grade points and displayed scale live in
// "@/lib/grading" so the transcript and the class report share one definition.

// Credit-weighted GPA: Σ(gradePoint × credits) / Σ(credits). Superseded
// (earlier retake) attempts are excluded — only the latest attempt counts.
function computeGPA(mods: PassedModule[]): string {
  const counted = mods.filter((m) => !m.superseded);
  const totalCredits = counted.reduce((s, m) => s + m.credits, 0);
  if (!totalCredits) return "—";
  const weighted = counted.reduce((s, m) => s + gradePoint(m.grade) * m.credits, 0);
  return (weighted / totalCredits).toFixed(2);
}

function formatDate(dateStr?: string): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

function todayStr(): string {
  return new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

interface PassedModule {
  moduleId: string;
  name: string;
  code: string;
  mark: number;
  grade: string;
  credits: number;
  // Study year/semester (1–3 / 1–2) the module sits in within the curriculum —
  // used for grouping/display on the transcript.
  year: number;
  semester: number;
  // The calendar period the mark was recorded in. Identifies the attempt so the
  // latest retake can be picked; NOT used for display.
  attemptYear?: number;
  attemptSem?: number;
  superseded?: boolean;
}

// When a module was taken more than once (a retake), only the latest attempt
// (highest calendar year, then semester) counts toward GPA/credits; earlier
// attempts are flagged "superseded" so they still display but don't count.
function flagSuperseded(mods: PassedModule[]): PassedModule[] {
  const latestRank: Record<string, number> = {};
  mods.forEach((m) => {
    const r = (m.attemptYear ?? m.year) * 100 + (m.attemptSem ?? m.semester);
    if (latestRank[m.moduleId] === undefined || r > latestRank[m.moduleId]) latestRank[m.moduleId] = r;
  });
  return mods.map((m) => ({ ...m, superseded: (m.attemptYear ?? m.year) * 100 + (m.attemptSem ?? m.semester) < latestRank[m.moduleId] }));
}

// School contact details shown on the transcript (kept in sync with the
// acceptance/welcome letters in ApplicantPortal).
const SCHOOL_CONTACT = {
  address: "Plot 2830, Sedie · Maun",
  pobox: "P O Box 661, Maun",
  tel: "+267 686 0262",
  fax: "+267 686 0261",
  email: "info@boswa.ac.bw",
  web: "www.boswa.ac.bw",
};
const SCHOOL_CONTACT_LINE =
  `${SCHOOL_CONTACT.address}  ·  ${SCHOOL_CONTACT.pobox}  ·  ☎ ${SCHOOL_CONTACT.tel}` +
  `  ·  ✉ ${SCHOOL_CONTACT.email}  ·  ${SCHOOL_CONTACT.web}`;

// ── Build a student's transcript modules ─────────────────────────────────────
// Real marks live in `assessment_marks` (one row per exam/assignment). Each
// module's weighted mark is computed the same way the Class Report does, via the
// shared helpers, so the transcript and reports never diverge. Any legacy `marks`
// rows not already covered by assessment data are merged in so historical/retake
// records are never dropped.
async function buildPassedModules(db: any, student: any): Promise<PassedModule[]> {
  const { data } = await supabase
    .from("assessment_marks")
    .select("module_id,class_id,assessment_id,score")
    .eq("student_id", student.studentId);
  const asm = (data || []).map((x: any) => ({
    moduleId: x.module_id,
    classId: x.class_id,
    assessmentId: x.assessment_id,
    score: Number(x.score),
  }));
  const scoreOf = (_studentId: string, assessmentId: string) => {
    const m = asm.find((x: any) => x.assessmentId === assessmentId);
    return m ? m.score : null;
  };

  // A module's "respective semester" comes from the programme CURRICULUM
  // (programme_modules) — the definitive study year/semester slot for that
  // module — so modules group correctly even if the class they were marked in
  // doesn't line up. Falls back to the class, then the mark's own period.
  const currOf = (moduleId: string) =>
    (db.programmeModules || []).find(
      (pm: any) => pm.programmeId === student.programme && pm.moduleId === moduleId,
    );

  const result: PassedModule[] = [];
  const seenPairs = new Set<string>();
  // Track (module · attempt year · attempt semester) so legacy rows don't
  // duplicate an attempt already represented by assessment marks.
  const periodKeys = new Set<string>();

  asm.forEach((x: any) => {
    const pairKey = `${x.moduleId}|${x.classId}`;
    if (seenPairs.has(pairKey)) return;
    seenPairs.add(pairKey);

    const mod = db.modules.find((mo: any) => mo.id === x.moduleId);
    const cls = db.classes.find((c: any) => c.id === x.classId);
    const classExams = db.exams.filter((e: any) => e.classId === x.classId && e.moduleId === x.moduleId);
    const classAssignments = db.assignments.filter((a: any) => a.classId === x.classId && a.moduleId === x.moduleId);
    const cat = categorizeModuleAssessments(classExams, classAssignments);
    const { moduleMark } = computeStudentModuleMark({
      studentId: student.studentId,
      hasPractical: mod?.hasPractical !== false,
      cat,
      scoreOf,
    });
    const mark = Math.round(moduleMark);
    const curr = currOf(x.moduleId);
    // Display/grouping period from the curriculum; attempt period from the class
    // (used only to identify/order retakes — unchanged from prior behaviour).
    const year = curr?.year ?? cls?.year ?? 0;
    const semester = curr?.semester ?? cls?.semester ?? 0;
    const attemptYear = cls?.year ?? year;
    const attemptSem = cls?.semester ?? semester;
    periodKeys.add(`${x.moduleId}|${attemptYear}|${attemptSem}`);
    result.push({
      moduleId: x.moduleId,
      name: mod?.name || "(module no longer listed)",
      code: mod?.code || x.moduleId,
      mark,
      grade: letterGrade(mark),
      credits: 10,
      year,
      semester,
      attemptYear,
      attemptSem,
    });
  });

  // Preserve legacy `marks` rows not already covered by assessment data. Their
  // display period comes from the curriculum (then class, then the mark row),
  // while the attempt period stays class/mark-based so retakes group as before.
  db.marks
    .filter((m: any) => m.studentId === student.studentId)
    .forEach((m: any) => {
      const cls = db.classes.find((c: any) => c.id === m.classId);
      const curr = currOf(m.moduleId);
      const year = curr?.year ?? cls?.year ?? m.year;
      const semester = curr?.semester ?? cls?.semester ?? m.semester;
      const attemptYear = cls?.year ?? m.year;
      const attemptSem = cls?.semester ?? m.semester;
      if (periodKeys.has(`${m.moduleId}|${attemptYear}|${attemptSem}`)) return;
      const mod = db.modules.find((mo: any) => mo.id === m.moduleId);
      const mark = calcModuleMark(m, mod?.hasPractical !== false);
      result.push({
        moduleId: m.moduleId,
        name: mod?.name || "(module no longer listed)",
        code: mod?.code || m.moduleId,
        mark,
        grade: letterGrade(mark),
        credits: 10,
        year,
        semester,
        attemptYear,
        attemptSem,
      });
    });

  // Order by academic year, then semester, then module code so the transcript
  // sections — and the modules within each — read in a stable, natural order.
  return flagSuperseded(result).sort(
    (a, b) => a.year - b.year || a.semester - b.semester || a.code.localeCompare(b.code),
  );
}
// ── Print transcript in a new window ─────────────────────────────────────────
function printTranscript(
  student: any,
  prog: any,
  passedModules: PassedModule[],
  transcriptMeta?: { issuer?: string; title?: string },
) {
  const studyYears = prog?.startYear ? `${prog.startYear}–${prog.startYear + (prog.years || 3)}` : "—";

  const totalCredits = passedModules.filter((m) => !m.superseded).reduce((s, m) => s + m.credits, 0);
  const cumulativeGpa = computeGPA(passedModules);

  const semGroups: Record<string, PassedModule[]> = {};
  passedModules.forEach((m) => {
    const k = `Year ${m.year} · Semester ${m.semester}`;
    if (!semGroups[k]) semGroups[k] = [];
    semGroups[k].push(m);
  });

  // Build the logo URL (absolute so it works in a new window)
  const logoUrl = window.location.origin + "/transcript_logo.png";
  const watermarkUrl = window.location.origin + "/transcript_watermark.svg";
  const footerUrl = window.location.origin + "/transcript_footer.png";

  const semSections = Object.keys(semGroups)
    .map((semKey) => {
      const semGpa = computeGPA(semGroups[semKey]);
      const semCredits = semGroups[semKey].filter((m) => !m.superseded).reduce((s, m) => s + m.credits, 0);
      const rows = semGroups[semKey]
        .map(
          (m, i) => `
      <tr style="background:${i % 2 === 0 ? "#D9D9D9" : "#fff"};${m.superseded ? "color:#999;text-decoration:line-through" : ""}">
        <td style="padding:5px 10px">${m.name}${m.superseded ? ' <span style="font-size:9px;font-style:italic;text-decoration:none">(superseded by retake)</span>' : ""}</td>
        <td style="padding:5px 10px;text-align:center;font-family:monospace;font-size:11px">${m.code}</td>
        <td style="padding:5px 10px;text-align:center;font-weight:700">${m.mark}%</td>
        <td style="padding:5px 10px;text-align:center;font-weight:700">${m.grade}</td>
        <td style="padding:5px 10px;text-align:center">${m.superseded ? "—" : m.credits}</td>
      </tr>`,
        )
        .join("");

      return `
      <div style="margin-bottom:18px">
        <div style="background:#1F3864;color:#fff;padding:6px 12px;font-weight:700;font-size:12px;border-radius:4px 4px 0 0">
          ${semKey}
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead>
            <tr style="background:#002060;color:#fff">
              <th style="padding:6px 10px;text-align:left">Module Names</th>
              <th style="padding:6px 10px;text-align:center">Module Code</th>
              <th style="padding:6px 10px;text-align:center">Marks %</th>
              <th style="padding:6px 10px;text-align:center">Grade</th>
              <th style="padding:6px 10px;text-align:center">Credits</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        <div style="font-size:12px;font-weight:700;display:flex;gap:20px;padding:6px 10px;background:#f4f4f4;border:1px solid #ddd;border-radius:0 0 4px 4px">
          <span>Semester GPA = ${semGpa}</span>
          <span>Credit Hours = ${semCredits * 10} hrs</span>
          <span>Credit Points = ${semCredits} Cr</span>
        </div>
      </div>`;
    })
    .join("");

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8"/>
  <title>Transcript — ${student.name}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Arial, sans-serif; font-size: 12px; color: #000; background: #fff; padding: 20px 30px; }
    @page { size: A4; margin: 15mm 15mm 20mm 15mm; }
    @media print {
      body { padding: 0; }
      .no-print { display: none !important; }
      .watermark { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
    table { border-collapse: collapse; }
    /* Centered B-monogram watermark. Overlaid ABOVE content (z-index high) and
       fixed so it shows through the opaque table/panel backgrounds and repeats
       on every printed page. pointer-events:none keeps it non-interactive. */
    .watermark {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      height: 78%;
      max-height: 660px;
      opacity: 0.14;
      z-index: 9999;
      pointer-events: none;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    body > *:not(.watermark) { position: relative; z-index: 1; }
  </style>
</head>
<body>
  <!-- Watermark -->
  <img class="watermark" src="${watermarkUrl}" onerror="this.style.display='none'" />

  <!-- Header (logo lockup) -->
  <div style="text-align:center;padding:6px 0 10px;border-bottom:2px solid #C9A227;margin-bottom:6px">
    <img src="${logoUrl}" style="height:110px;object-fit:contain" onerror="this.style.display='none'" />
    <div style="font-size:12px;color:#777;margin-top:8px;font-style:italic;letter-spacing:0.5px">Official Academic Transcript</div>
  </div>

  <!-- Address / contact line -->
  <div style="text-align:center;font-size:10px;color:#555;margin-bottom:14px">${SCHOOL_CONTACT_LINE}</div>

  <!-- Student info -->
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 32px;margin-bottom:14px;background:#f9f9f9;padding:12px;border-radius:6px;font-size:12px;border-bottom:2px solid #C9A227">
    <div><strong style="color:#002060">Student Name:</strong> ${student.name}</div>
    <div><strong style="color:#002060">Date of Admission:</strong> ${student.enrolmentDate ? formatDate(student.enrolmentDate) : "—"}</div>
    <div><strong style="color:#002060">Student Number:</strong> ${student.studentId}</div>
    <div><strong style="color:#002060">Date of Completion:</strong> ${student.completionDate ? formatDate(student.completionDate) : "—"}</div>
    <div><strong style="color:#002060">ID/Passport No.:</strong> ${student.nationalId || "—"}</div>
    <div><strong style="color:#002060">Program of Study:</strong> ${prog?.name || "—"}</div>
    <div><strong style="color:#002060">Gender:</strong> ${student.gender || "—"}</div>
    <div><strong style="color:#002060">Level:</strong> ${prog?.level ? `Level ${prog.level}` : "—"}</div>
    <div><strong style="color:#002060">Nationality:</strong> ${student.nationality || "—"}</div>
    <div><strong style="color:#002060">Issue Date:</strong> ${todayStr()}</div>
  </div>

  <!-- Modules -->
  ${
    passedModules.length === 0
      ? `<div style="text-align:center;padding:20px;color:#666">No modules on record yet.</div>`
      : semSections
  }

  <!-- Overall summary -->
  ${
    passedModules.length === 0
      ? ""
      : `<div style="display:flex;gap:24px;justify-content:flex-end;align-items:center;background:#002060;color:#fff;padding:8px 16px;border-radius:4px;margin-bottom:14px;font-size:13px;font-weight:700">
          <span>Total Credit Points = ${totalCredits} Cr</span>
          <span>Total Credit Hours = ${totalCredits * 10} hrs</span>
          <span style="font-size:14px">Cumulative GPA = ${cumulativeGpa}</span>
        </div>`
  }

  <!-- Certification -->
  <p style="font-size:12px;color:#555;font-style:italic;margin:14px 0 8px">
    I do hereby self-certify and affirm that this is the official transcript and record of
    <strong>${student.name}</strong> in the academic studies of ${studyYears}.
  </p>
  <div style="font-size:12px;margin-bottom:16px;line-height:1.8">
    <div><strong>Issued By:</strong> ${transcriptMeta?.issuer || "Boisi Dibuile"}</div>
    <div><strong>Position:</strong> ${transcriptMeta?.title || "Deputy Principal"}</div>
    <div><strong>Date:</strong> ${todayStr()}</div>
  </div>

  <!-- Grading scale -->
  <div style="border-top:1px solid #ccc;padding-top:10px;margin-bottom:14px">
    <div style="font-size:11px;font-weight:700;color:#002060;margin-bottom:6px">Grading Scale</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap">
      ${GRADE_SCALE.map(
        ([r, d]) =>
          `<div style="font-size:10px;background:#f0f0f0;border:1px solid #ddd;border-radius:4px;padding:3px 10px"><strong>${r}</strong> — ${d}</div>`,
      ).join("")}
    </div>
  </div>

  <!-- Footer image -->
  <div style="text-align:center;margin-top:20px">
    <img src="${footerUrl}" style="width:100%;max-width:700px;object-fit:contain" onerror="this.style.display='none'" />
  </div>

  <!-- Print button (hidden when printing) -->
  <div class="no-print" style="text-align:center;margin-top:20px">
    <button onclick="window.print()" style="background:#002060;color:#fff;border:none;padding:10px 28px;font-size:14px;border-radius:6px;cursor:pointer;font-family:Arial">
      🖨️ Print / Save as PDF
    </button>
  </div>

  <script>
    // Auto-trigger print dialog after images load
    window.onload = function() { window.print(); };
  </script>
</body>
</html>`;

  const win = window.open("", "_blank", "width=900,height=700");
  if (!win) {
    alert("Pop-up blocked. Please allow pop-ups for this site to print transcripts.");
    return;
  }
  win.document.write(html);
  win.document.close();
}

// ── Pages ──────────────────────────────────────────────────────────────────────

// ── Transcript signatory editor (Issued By / Position) ───────────────────────
// Global setting applied to every transcript, edited from the page header by
// admin & above.
function IssuerSettingsForm() {
  const { db, toast, closeModal, reloadDb } = useApp();
  const [issuerName, setIssuerName] = useState(db.config.transcriptIssuer || "");
  const [issuerTitle, setIssuerTitle] = useState(db.config.transcriptIssuerTitle || "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const configId = (db.config as any)?.id;
    if (!configId) {
      toast("Config record not found", "error");
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from("school_config")
      .update({
        transcript_issuer: issuerName.trim() || null,
        transcript_issuer_title: issuerTitle.trim() || null,
      } as any)
      .eq("id", configId);
    setSaving(false);
    if (error) {
      toast(error.message, "error");
      return;
    }
    toast("Transcript signatory saved!", "success");
    closeModal();
    reloadDb();
  };

  return (
    <div>
      <div className="form-group">
        <label>Issued By</label>
        <input
          className="form-input"
          value={issuerName}
          placeholder="Boisi Dibuile"
          onChange={(e) => setIssuerName(e.target.value)}
        />
      </div>
      <div className="form-group">
        <label>Position</label>
        <input
          className="form-input"
          value={issuerTitle}
          placeholder="Deputy Principal"
          onChange={(e) => setIssuerTitle(e.target.value)}
        />
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button className="btn btn-primary" disabled={saving} onClick={save}>
          {saving ? "Saving…" : "Save"}
        </button>
        <button className="btn btn-outline" disabled={saving} onClick={closeModal}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export default function TranscriptsPage() {
  const { db, currentUser, showModal } = useApp();
  const [search, setSearch] = useState("");
  const role = currentUser?.role;
  const canEditIssuer = CAN_EDIT_ISSUER.includes(role || "");

  if (role === "student") {
    const stu = db.students.find((s) => s.studentId === currentUser?.studentId);
    if (!stu)
      return (
        <div className="card" style={{ textAlign: "center", padding: 40 }}>
          Student record not found.
        </div>
      );
    return <TranscriptView stu={stu} />;
  }

  const filtered = db.students.filter((s) => !search || s.name.toLowerCase().includes(search.toLowerCase()) || s.studentId.toLowerCase().includes(search.toLowerCase()));

  return (
    <>
      <div className="page-header" style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div className="page-title">Student Transcripts</div>
        {canEditIssuer && (
          <button
            className="btn btn-outline btn-sm"
            onClick={() => showModal("Transcript Signatory — Issued By / Position", <IssuerSettingsForm />)}
          >
            <i className="fa-solid fa-pen" style={{ marginRight: 6 }} />
            Issued By / Position
          </button>
        )}
      </div>
      <div className="card">
        <div className="search-bar">
          <input
            className="search-input"
            placeholder="Search student…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Student</th>
                <th>Student ID</th>
                <th>Class</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => {
                const cls = db.classes.find((c) => c.id === s.classId);
                return (
                  <tr key={s.id}>
                    <td className="td-name">{s.name}</td>
                    <td style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11 }}>{s.studentId}</td>
                    <td>{cls?.name}</td>
                    <td style={{ display: "flex", gap: 6 }}>
                      <button
                        className="btn btn-outline btn-sm"
                        onClick={() => showModal("Transcript — " + s.name, <TranscriptView stu={s} />, "large")}
                      >
                        <i className="fa-solid fa-eye" /> View
                      </button>
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={async () => {
                          const prog = db.config.programmes.find((p: any) => p.id === s.programme);
                          const passed = await buildPassedModules(db, s);
                          printTranscript(s, prog, passed, {
                            issuer: db.config.transcriptIssuer,
                            title: db.config.transcriptIssuerTitle,
                          });
                        }}
                      >
                        <i className="fa-solid fa-print" /> Print
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

// ── TranscriptView ─────────────────────────────────────────────────────────────
export function TranscriptView({ stu }: { stu: any }) {
  const { db } = useApp();

  const prog = db.config.programmes.find((p: any) => p.id === stu.programme);
  const [passedModules, setPassedModules] = useState<PassedModule[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    buildPassedModules(db, stu).then((mods) => {
      if (!active) return;
      setPassedModules(mods);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [db, stu]);

  const totalCredits = passedModules.filter((m) => !m.superseded).reduce((s, m) => s + m.credits, 0);
  const cumulativeGpa = computeGPA(passedModules);

  const semGroups: Record<string, PassedModule[]> = {};
  passedModules.forEach((m) => {
    const k = `Year ${m.year} · Semester ${m.semester}`;
    if (!semGroups[k]) semGroups[k] = [];
    semGroups[k].push(m);
  });

  const studyYears = prog?.startYear ? `${prog.startYear}–${prog.startYear + (prog.years || 3)}` : "—";

  const handlePrint = () =>
    printTranscript(stu, prog, passedModules, {
      issuer: db.config.transcriptIssuer,
      title: db.config.transcriptIssuerTitle,
    });

  // ── On-screen preview ──────────────────────────────────────────────────────
  return (
    <div className="card" style={{ fontFamily: "Arial, sans-serif", position: "relative", overflow: "hidden" }}>
      {/* Watermark — B monogram outline, overlaid above content (matches print) */}
      <img
        src="/transcript_watermark.svg"
        alt=""
        aria-hidden="true"
        onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          height: "78%",
          maxHeight: 660,
          opacity: 0.14,
          pointerEvents: "none",
          zIndex: 5,
        }}
      />
      <div style={{ position: "relative", zIndex: 1 }}>
      {/* Header (logo lockup) */}
      <div style={{ textAlign: "center", padding: "6px 0 10px", borderBottom: "2px solid #C9A227" }}>
        <img
          src="/transcript_logo.png"
          alt="Boswa Culinary Institute of Botswana"
          onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
          style={{ height: 110, objectFit: "contain" }}
        />
        <div style={{ fontSize: 13, color: "#777", marginTop: 8, fontStyle: "italic", letterSpacing: 0.5 }}>
          Official Academic Transcript
        </div>
      </div>

      {/* Address / contact line */}
      <div style={{ textAlign: "center", fontSize: 10, color: "#555", marginTop: 6 }}>
        {SCHOOL_CONTACT_LINE}
      </div>

      {/* Student info grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "4px 32px",
          margin: "14px 0",
          background: "#f9f9f9",
          padding: 12,
          borderRadius: 6,
          fontSize: 12,
          borderBottom: "2px solid #C9A227",
        }}
      >
        {(
          [
            ["Student Name", stu.name],
            ["Date of Admission", stu.enrolmentDate ? formatDate(stu.enrolmentDate) : "—"],
            ["Student Number", stu.studentId],
            ["Date of Completion", stu.completionDate ? formatDate(stu.completionDate) : "—"],
            ["ID/Passport No.", stu.nationalId || "—"],
            ["Program of Study", prog?.name || "—"],
            ["Gender", stu.gender || "—"],
            ["Level", prog?.level ? `Level ${prog.level}` : "—"],
            ["Nationality", stu.nationality || "—"],
            ["Issue Date", todayStr()],
          ] as [string, string][]
        ).map(([label, value]) => (
          <div key={label}>
            <strong style={{ color: "#002060" }}>{label}:</strong> {value}
          </div>
        ))}
      </div>

      {/* Modules by semester */}
      {loading ? (
        <div style={{ textAlign: "center", padding: 20, color: "var(--text2)", fontSize: 12 }}>
          Loading marks…
        </div>
      ) : passedModules.length === 0 ? (
        <div style={{ textAlign: "center", padding: 20, color: "var(--text2)", fontSize: 12 }}>
          No modules on record yet.
        </div>
      ) : (
        Object.keys(semGroups)
          .map((semKey) => (
            <div key={semKey} style={{ marginBottom: 16 }}>
              <div
                style={{
                  background: "#1F3864",
                  color: "#fff",
                  padding: "6px 12px",
                  fontWeight: 700,
                  fontSize: 12,
                  borderRadius: "4px 4px 0 0",
                }}
              >
                {semKey}
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "#002060", color: "#fff" }}>
                    {["Module Names", "Module Code", "Marks %", "Grade", "Credits"].map((h) => (
                      <th
                        key={h}
                        style={{
                          padding: "6px 10px",
                          textAlign: h === "Module Names" ? "left" : "center",
                          fontWeight: 700,
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {semGroups[semKey].map((m, i) => (
                    <tr
                      key={i}
                      style={{
                        background: i % 2 === 0 ? "#D9D9D9" : "#fff",
                        borderBottom: "1px solid #ccc",
                        color: m.superseded ? "#999" : undefined,
                        textDecoration: m.superseded ? "line-through" : undefined,
                      }}
                    >
                      <td style={{ padding: "5px 10px" }}>
                        {m.name}
                        {m.superseded && (
                          <span style={{ fontSize: 9, fontStyle: "italic", textDecoration: "none", marginLeft: 4 }}>
                            (superseded by retake)
                          </span>
                        )}
                      </td>
                      <td style={{ padding: "5px 10px", textAlign: "center", fontFamily: "monospace", fontSize: 11 }}>
                        {m.code}
                      </td>
                      <td style={{ padding: "5px 10px", textAlign: "center", fontWeight: 700 }}>{m.mark}%</td>
                      <td style={{ padding: "5px 10px", textAlign: "center", fontWeight: 700 }}>{m.grade}</td>
                      <td style={{ padding: "5px 10px", textAlign: "center" }}>{m.superseded ? "—" : m.credits}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  display: "flex",
                  gap: 20,
                  padding: "6px 10px",
                  background: "#f4f4f4",
                  border: "1px solid #ddd",
                  borderRadius: "0 0 4px 4px",
                }}
              >
                <span>Semester GPA = {computeGPA(semGroups[semKey])}</span>
                <span>Credit Hours = {semGroups[semKey].filter((m) => !m.superseded).reduce((s, m) => s + m.credits, 0) * 10} hrs</span>
                <span>Credit Points = {semGroups[semKey].filter((m) => !m.superseded).reduce((s, m) => s + m.credits, 0)} Cr</span>
              </div>
            </div>
          ))
      )}

      {/* Overall summary */}
      {passedModules.length > 0 && (
        <div
          style={{
            display: "flex",
            gap: 24,
            justifyContent: "flex-end",
            alignItems: "center",
            background: "#002060",
            color: "#fff",
            padding: "8px 16px",
            borderRadius: 4,
            marginBottom: 14,
            fontSize: 13,
            fontWeight: 700,
          }}
        >
          <span>Total Credit Points = {totalCredits} Cr</span>
          <span>Total Credit Hours = {totalCredits * 10} hrs</span>
          <span style={{ fontSize: 14 }}>Cumulative GPA = {cumulativeGpa}</span>
        </div>
      )}

      {/* Certification */}
      <p style={{ fontSize: 12, color: "#555", fontStyle: "italic", margin: "14px 0 8px" }}>
        I do hereby self-certify and affirm that this is the official transcript and record of{" "}
        <strong>{stu.name}</strong> in the academic studies of {studyYears}.
      </p>
      <div style={{ fontSize: 12, marginBottom: 14, lineHeight: 1.8 }}>
        <div>
          <strong>Issued By:</strong> {db.config.transcriptIssuer || "Boisi Dibuile"}
        </div>
        <div>
          <strong>Position:</strong> {db.config.transcriptIssuerTitle || "Deputy Principal"}
        </div>
        <div>
          <strong>Date:</strong> {todayStr()}
        </div>
      </div>

      {/* Grading key */}
      <div style={{ borderTop: "1px solid #ccc", paddingTop: 10, marginBottom: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#002060", marginBottom: 6 }}>Grading Scale</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {GRADE_SCALE.map(([r, d]) => (
            <div
              key={r}
              style={{
                fontSize: 10,
                background: "#f0f0f0",
                border: "1px solid #ddd",
                borderRadius: 4,
                padding: "3px 10px",
              }}
            >
              <strong>{r}</strong> — {d}
            </div>
          ))}
        </div>
      </div>

      {/* Print button */}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button className="btn btn-primary" onClick={handlePrint}>
          <i className="fa-solid fa-print" style={{ marginRight: 6 }} />
          Print / Save as PDF
        </button>
      </div>
      </div>
    </div>
  );
}
