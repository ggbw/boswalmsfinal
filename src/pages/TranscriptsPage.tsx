import { useState, useEffect } from "react";
import { useApp } from "@/context/AppContext";
import { calcModuleMark } from "@/data/db";
import { supabase } from "@/integrations/supabase/client";
import { categorizeModuleAssessments, computeStudentModuleMark } from "@/lib/moduleMark";

// ── Grading ───────────────────────────────────────────────────────────────────
// University letter-grade scale (percentage → letter) with +/- bands.
function letterGrade(pct: number): string {
  if (pct >= 86) return "A";
  if (pct >= 80) return "A-";
  if (pct >= 75) return "B+";
  if (pct >= 70) return "B";
  if (pct >= 65) return "B-";
  if (pct >= 60) return "C+";
  if (pct >= 55) return "C";
  if (pct >= 50) return "C-";
  if (pct >= 40) return "D";
  return "F";
}

// Grade points on a 4.0 scale.
function gradePoint(letter: string): number {
  const m: Record<string, number> = {
    A: 4.0,
    "A-": 3.7,
    "B+": 3.3,
    B: 3.0,
    "B-": 2.7,
    "C+": 2.3,
    C: 2.0,
    "C-": 1.7,
    D: 1.0,
    F: 0.0,
  };
  return m[letter] ?? 0;
}

// Credit-weighted GPA: Σ(gradePoint × credits) / Σ(credits). Superseded
// (earlier retake) attempts are excluded — only the latest attempt counts.
function computeGPA(mods: PassedModule[]): string {
  const counted = mods.filter((m) => !m.superseded);
  const totalCredits = counted.reduce((s, m) => s + m.credits, 0);
  if (!totalCredits) return "—";
  const weighted = counted.reduce((s, m) => s + gradePoint(m.grade) * m.credits, 0);
  return (weighted / totalCredits).toFixed(2);
}

// Grading scale displayed at the foot of the transcript.
const GRADE_SCALE: [string, string][] = [
  ["A", "86–100% · 4.0"],
  ["A-", "80–85% · 3.7"],
  ["B+", "75–79% · 3.3"],
  ["B", "70–74% · 3.0"],
  ["B-", "65–69% · 2.7"],
  ["C+", "60–64% · 2.3"],
  ["C", "55–59% · 2.0"],
  ["C-", "50–54% · 1.7"],
  ["D", "40–49% · 1.0"],
  ["F", "0–39% · 0.0 (Fail)"],
];

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
  year: number;
  semester: number;
  superseded?: boolean;
}

// When a module was taken more than once (a retake), only the latest attempt
// (highest year, then semester) counts toward GPA/credits; earlier attempts are
// flagged "superseded" so they still display but don't count.
function flagSuperseded(mods: PassedModule[]): PassedModule[] {
  const latestRank: Record<string, number> = {};
  mods.forEach((m) => {
    const r = m.year * 100 + m.semester;
    if (latestRank[m.moduleId] === undefined || r > latestRank[m.moduleId]) latestRank[m.moduleId] = r;
  });
  return mods.map((m) => ({ ...m, superseded: m.year * 100 + m.semester < latestRank[m.moduleId] }));
}

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

  const result: PassedModule[] = [];
  const seenPairs = new Set<string>();
  // Track (module · year · semester) so legacy rows don't duplicate a period
  // already represented by assessment marks.
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
    const year = cls?.year ?? 0;
    const semester = cls?.semester ?? 0;
    periodKeys.add(`${x.moduleId}|${year}|${semester}`);
    result.push({
      moduleId: x.moduleId,
      name: mod?.name || "(module no longer listed)",
      code: mod?.code || x.moduleId,
      mark,
      grade: letterGrade(mark),
      credits: 10,
      year,
      semester,
    });
  });

  // Preserve legacy `marks` rows not already covered by assessment data.
  db.marks
    .filter((m: any) => m.studentId === student.studentId)
    .forEach((m: any) => {
      if (periodKeys.has(`${m.moduleId}|${m.year}|${m.semester}`)) return;
      const mod = db.modules.find((mo: any) => mo.id === m.moduleId);
      const mark = calcModuleMark(m, mod?.hasPractical !== false);
      result.push({
        moduleId: m.moduleId,
        name: mod?.name || "(module no longer listed)",
        code: mod?.code || m.moduleId,
        mark,
        grade: letterGrade(mark),
        credits: 10,
        year: m.year,
        semester: m.semester,
      });
    });

  return flagSuperseded(result);
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
  const footerUrl = window.location.origin + "/transcript_footer.png";

  const semSections = Object.keys(semGroups)
    .sort()
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
    }
    table { border-collapse: collapse; }
  </style>
</head>
<body>
  <!-- Header -->
  <div style="text-align:center;margin-bottom:10px">
    <img src="${logoUrl}" style="height:70px;object-fit:contain" onerror="this.style.display='none'" />
  </div>

  <!-- Title band -->
  <div style="background:#002060;padding:12px 20px;text-align:center;border-bottom:3px solid #C9A227;margin-bottom:14px">
    <div style="font-size:15px;font-weight:800;color:#fff;letter-spacing:0.5px">BOSSWA CULINARY INSTITUTE OF BOTSWANA</div>
    <div style="font-size:12px;color:#C9A227;margin-top:4px;font-style:italic">Official Academic Transcript</div>
  </div>

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

export default function TranscriptsPage() {
  const { db, currentUser, showModal } = useApp();
  const [search, setSearch] = useState("");
  const role = currentUser?.role;

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
      <div className="page-header">
        <div className="page-title">Student Transcripts</div>
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
    <div className="card" style={{ fontFamily: "Arial, sans-serif" }}>
      {/* Title band */}
      <div
        style={{
          background: "#002060",
          borderRadius: 6,
          padding: "14px 20px",
          textAlign: "center",
          marginBottom: 0,
          borderBottom: "3px solid #C9A227",
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 800, color: "#fff", letterSpacing: 0.5 }}>
          BOSSWA CULINARY INSTITUTE OF BOTSWANA
        </div>
        <div style={{ fontSize: 13, color: "#C9A227", marginTop: 4, fontStyle: "italic" }}>
          Official Academic Transcript
        </div>
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
          .sort()
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
  );
}
