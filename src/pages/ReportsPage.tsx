import { useState, useEffect, useCallback } from "react";
import { useApp } from "@/context/AppContext";
import { grade, gradeColor } from "@/data/db";
import { supabase } from "@/integrations/supabase/client";

const GRADE_ORDER = ["Distinction", "Merit", "Credit", "Pass", "Fail"] as const;

// Exam type → which section of the report
const THEORY_TYPES = ["Written Exam", "Oral Exam"];
const FINAL_THEORY = "Final Theory Exam";
const RECIPE_TYPE = "Recipe";
const FINAL_PRAC = "Final Practical Exam";
const FINAL_PRAC_THEO = "Final Practical Theory Exam";

function r2(n: number) {
  return Math.round(n * 100) / 100;
}
function avg(nums: number[]) {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}

interface AssessmentMark {
  student_id: string;
  assessment_id: string;
  score: number;
}

export default function ReportsPage() {
  const { db, currentUser } = useApp();
  const role = currentUser?.role;
  const visibleClasses = role === "lecturer" ? db.classes.filter((c) => c.lecturer === currentUser?.name) : db.classes;

  const [view, setView] = useState<"overview" | "detail">("overview");
  const [selClassId, setSelClassId] = useState(visibleClasses[0]?.id || "");
  const [selModuleId, setSelModuleId] = useState("");
  const [yearFilter, setYearFilter] = useState<number | "">("");
  const [semFilter, setSemFilter] = useState<number | "">("");
  const [asmMarks, setAsmMarks] = useState<AssessmentMark[]>([]);
  const [loading, setLoading] = useState(false);

  // Load assessment_marks for selected class+module
  const loadMarks = useCallback(async (classId: string, moduleId: string) => {
    if (!classId || !moduleId) return;
    setLoading(true);
    const { data } = await supabase
      .from("assessment_marks")
      .select("student_id, assessment_id, score")
      .eq("class_id", classId)
      .eq("module_id", moduleId);
    setAsmMarks(
      (data || []).map((x: any) => ({
        student_id: x.student_id,
        assessment_id: x.assessment_id,
        score: Number(x.score),
      })),
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    if (view === "detail" && selClassId) {
      const classModules = db.modules.filter((m) => m.classes.includes(selClassId));
      const mid = selModuleId || classModules[0]?.id || "";
      if (mid) loadMarks(selClassId, mid);
    }
  }, [view, selClassId, selModuleId, loadMarks]);

  const filteredClasses = visibleClasses.filter((c) => {
    if (yearFilter !== "" && c.year !== yearFilter) return false;
    if (semFilter !== "" && c.semester !== semFilter) return false;
    return true;
  });

  // ── DETAIL REPORT ──────────────────────────────────────────────────────────
  const DetailReport = () => {
    const cls = db.classes.find((c) => c.id === selClassId);
    if (!cls) return <Placeholder text="Select a class to view the report." />;

    const classModules = db.modules;
    const moduleId = selModuleId || classModules[0]?.id || "";
    const mod = db.modules.find((m) => m.id === moduleId);
    const students = db.students.filter((s) => s.classId === cls.id);
    const prog = db.config.programmes.find((p) => p.id === cls.programme);

    // Get all exams and assignments for this class+module
    const classExams = db.exams.filter((e) => e.classId === cls.id && e.moduleId === moduleId);
    const classAssignments = db.assignments.filter((a) => a.classId === cls.id && a.moduleId === moduleId);

    // Categorise
    const theoryCWExams = classExams.filter((e) => THEORY_TYPES.includes(e.type || "Written Exam"));
    const finalTheoryExam = classExams.find((e) => e.type === FINAL_THEORY);
    // All exams with "practical" in their type (case-insensitive), excluding the specific final ones
    const practicalCWExams = classExams.filter(
      (e) => (e.type || "").toLowerCase().includes("practical") && e.type !== FINAL_PRAC && e.type !== FINAL_PRAC_THEO,
    );
    const recipeExams = classExams.filter((e) => e.type === RECIPE_TYPE);
    const finalPracExam = classExams.find((e) => e.type === FINAL_PRAC);
    const finalPracTheo = classExams.find((e) => e.type === FINAL_PRAC_THEO);

    // Helper: get score for a student+assessment
    const score = (studentId: string, assessmentId: string) => {
      const m = asmMarks.find((x) => x.student_id === studentId && x.assessment_id === assessmentId);
      return m ? m.score : null;
    };

    // Build rows
    const rows = students.map((s) => {
      // Theory CW: exams + assignments, averaged
      const theoryCWScores = [
        ...theoryCWExams.map((e) => score(s.studentId, e.id)),
        ...classAssignments.map((a) => score(s.studentId, a.id)),
      ].filter((x) => x !== null) as number[];
      const theoryCWAvg = theoryCWScores.length ? avg(theoryCWScores) : null;
      const theory40 = theoryCWAvg !== null ? r2(theoryCWAvg * 0.4) : null;

      // Final theory exam
      const finalTheory = finalTheoryExam ? score(s.studentId, finalTheoryExam.id) : null;
      const final40 = finalTheory !== null ? r2(finalTheory * 0.4) : null;

      // Practical CW (exams with "practical" in type, not finals)
      const practicalCWScores = practicalCWExams
        .map((e) => score(s.studentId, e.id))
        .filter((x) => x !== null) as number[];
      const practicalCWAvg = practicalCWScores.length ? avg(practicalCWScores) : null;

      // Recipes
      const recipeScores = recipeExams.map((e) => score(s.studentId, e.id)).filter((x) => x !== null) as number[];
      const recipeAvg = recipeScores.length ? avg(recipeScores) : null;

      // Combined practical CW (practicalCW + recipes) → 70%
      const allPracCWScores = [...practicalCWScores, ...recipeScores];
      const allPracCWAvg = allPracCWScores.length ? avg(allPracCWScores) : null;
      const pracCW70 = allPracCWAvg !== null ? r2(allPracCWAvg * 0.7) : null;

      // Final practical
      const finalPrac = finalPracExam ? score(s.studentId, finalPracExam.id) : null;
      const finalPrac20 = finalPrac !== null ? r2(finalPrac * 0.2) : null;
      const finalPracT = finalPracTheo ? score(s.studentId, finalPracTheo.id) : null;
      const finalPracT10 = finalPracT !== null ? r2(finalPracT * 0.1) : null;

      // Practical mark
      const pracParts = [pracCW70, finalPrac20, finalPracT10].filter((x) => x !== null) as number[];
      const practicalMark = pracParts.length ? r2(pracParts.reduce((a, b) => a + b, 0)) : null;
      const prac20 = practicalMark !== null ? r2(practicalMark * 0.2) : null;

      // Module mark — always calculated, missing parts treated as 0
      const moduleMark = r2((theory40 ?? 0) + (prac20 ?? 0) + (final40 ?? 0));
      const decision = grade(moduleMark);

      return {
        s,
        theoryCWScores,
        theoryCWAvg,
        theory40,
        finalTheory,
        final40,
        practicalCWScores,
        practicalCWAvg,
        recipeScores,
        recipeAvg,
        allPracCWAvg,
        pracCW70,
        finalPrac,
        finalPrac20,
        finalPracT,
        finalPracT10,
        practicalMark,
        prac20,
        moduleMark,
        decision,
      };
    });

    const classAvg = rows.length ? Math.round(avg(rows.map((r) => r.moduleMark))) : null;
    const gradeCounts: Record<string, number> = { Distinction: 0, Merit: 0, Credit: 0, Pass: 0, Fail: 0 };
    rows.forEach((r) => {
      gradeCounts[r.decision] = (gradeCounts[r.decision] || 0) + 1;
    });
    const passPct = students.length
      ? Math.round(((students.length - (gradeCounts.Fail || 0)) / students.length) * 100)
      : 0;

    const hasTheory = theoryCWExams.length > 0 || classAssignments.length > 0 || finalTheoryExam;
    const hasPractical = practicalCWExams.length > 0 || recipeExams.length > 0 || finalPracExam || finalPracTheo;

    const handleExport = async () => {
      if (!document.getElementById("sheetjs")) {
        await new Promise<void>((res) => {
          const s = document.createElement("script");
          s.id = "sheetjs";
          s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
          s.onload = () => res();
          document.head.appendChild(s);
        });
      }
      const XLSX = (window as any).XLSX;
      const title = `${mod?.name || "Module"} — ${cls.name} · Year ${cls.year} Sem ${cls.semester}`;

      // Theory headers
      const thHeaders = [...theoryCWExams.map((e) => e.name), ...classAssignments.map((a) => a.title)];
      const pracCWHeaders = practicalCWExams.map((e) => e.name);
      const recHeaders = recipeExams.map((e) => e.name);

      const headers = [
        "NO",
        "First Name",
        "Surname",
        "Student No.",
        ...thHeaders,
        ...(thHeaders.length > 0 ? ["CW Avg", "40% CW"] : []),
        ...(finalTheoryExam ? [finalTheoryExam.name, "40% Final Exam"] : []),
        ...(hasPractical
          ? [
              ...pracCWHeaders,
              ...(practicalCWExams.length > 0 ? ["Practical CW Avg"] : []),
              ...recHeaders,
              ...(recipeExams.length > 0 ? ["Recipe Avg"] : []),
              ...((practicalCWExams.length > 0 || recipeExams.length > 0) ? ["70% Practical CW"] : []),
              ...(finalPracExam ? [finalPracExam.name, "20% Final Prac"] : []),
              ...(finalPracTheo ? [finalPracTheo.name, "10% Prac Theory"] : []),
              "Practical Mark",
              "20% Practical",
            ]
          : []),
        "Module Mark",
        "Decision",
      ];

      const dataRows = rows.map((r, i) => {
        const parts = r.s.name.split(" ");
        const fn = parts.slice(0, -1).join(" ") || r.s.name;
        const sn = parts.length > 1 ? parts[parts.length - 1] : "";
        const thScores = [
          ...theoryCWExams.map((e) => score(r.s.studentId, e.id) ?? ""),
          ...classAssignments.map((a) => score(r.s.studentId, a.id) ?? ""),
        ];
        const pracCWScores = practicalCWExams.map((e) => score(r.s.studentId, e.id) ?? "");
        const recScores = recipeExams.map((e) => score(r.s.studentId, e.id) ?? "");
        return [
          i + 1,
          fn,
          sn,
          r.s.studentId,
          ...thScores,
          ...(thScores.length > 0 ? [r.theoryCWAvg ?? "", r.theory40 ?? ""] : []),
          ...(finalTheoryExam ? [r.finalTheory ?? "", r.final40 ?? ""] : []),
          ...(hasPractical
            ? [
                ...pracCWScores,
                ...(practicalCWExams.length > 0 ? [r.practicalCWAvg ?? ""] : []),
                ...recScores,
                ...(recipeExams.length > 0 ? [r.recipeAvg ?? ""] : []),
                ...((practicalCWExams.length > 0 || recipeExams.length > 0) ? [r.pracCW70 ?? 0] : []),
                ...(finalPracExam ? [r.finalPrac ?? "", r.finalPrac20 ?? ""] : []),
                ...(finalPracTheo ? [r.finalPracT ?? "", r.finalPracT10 ?? ""] : []),
                r.practicalMark ?? "",
                r.prac20 ?? "",
              ]
            : []),
          r.moduleMark ?? "",
          r.decision,
        ];
      });

      const wsData = [
        [title],
        [],
        headers,
        ...dataRows,
        [],
        ["", "", "", "CLASS AVERAGE", "", "", "", "", "", classAvg ?? ""],
        [],
        [],
        ["", "", "Grading"],
        ["", "", "0–49%    Fail"],
        ["", "", "50–59%   Pass"],
        ["", "", "60–69%   Credit"],
        ["", "", "70–79%   Merit"],
        ["", "", "80–100%  Distinction"],
      ];

      const ws = XLSX.utils.aoa_to_sheet(wsData);
      ws["!cols"] = Array(headers.length).fill({ wch: 14 });
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, cls.name.substring(0, 31));
      XLSX.writeFile(wb, `${cls.name}_${mod?.name || "Report"}.xlsx`);
    };

    const noData = !loading && asmMarks.length === 0;

    return (
      <div>
        {/* Controls */}
        <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div className="form-group" style={{ margin: 0 }}>
            <label style={{ fontSize: 11, color: "var(--text2)" }}>Class</label>
            <select
              className="form-select"
              value={selClassId}
              onChange={(e) => {
                setSelClassId(e.target.value);
                setSelModuleId("");
              }}
            >
              {visibleClasses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label style={{ fontSize: 11, color: "var(--text2)" }}>Module</label>
            <select
              className="form-select"
              value={moduleId}
              onChange={(e) => {
                setSelModuleId(e.target.value);
                loadMarks(selClassId, e.target.value);
              }}
            >
              {classModules.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
          <button className="btn btn-outline btn-sm" onClick={handleExport}>
            <i className="fa-solid fa-file-excel" style={{ marginRight: 6, color: "#16a34a" }} /> Export Excel
          </button>
        </div>

        {loading && <div style={{ textAlign: "center", padding: 40, color: "var(--text2)" }}>Loading marks…</div>}

        {!loading && (
          <>
            {/* Report header */}
            <div style={{ background: "#002060", color: "#fff", borderRadius: "8px 8px 0 0", padding: "14px 20px" }}>
              <div style={{ fontWeight: 800, fontSize: 15 }}>{mod?.name || "—"}</div>
              <div style={{ fontSize: 12, color: "#C9A227", marginTop: 3 }}>
                {cls.name} · {prog?.name || "—"} · Year {cls.year} · Semester {cls.semester} · {db.config.currentYear}
              </div>
            </div>

            {/* Summary bar */}
            <div
              style={{
                display: "flex",
                background: "var(--bg2)",
                border: "1px solid var(--border)",
                borderTop: "none",
              }}
            >
              {GRADE_ORDER.map((g) => (
                <div
                  key={g}
                  style={{ flex: 1, textAlign: "center", padding: "8px 4px", borderRight: "1px solid var(--border)" }}
                >
                  <div style={{ fontWeight: 700, fontSize: 16 }}>{gradeCounts[g] || 0}</div>
                  <div style={{ fontSize: 10, color: "var(--text2)" }}>{g}</div>
                </div>
              ))}
              <div style={{ flex: 1, textAlign: "center", padding: "8px 4px", borderRight: "1px solid var(--border)" }}>
                <div style={{ fontWeight: 700, fontSize: 16 }}>{students.length}</div>
                <div style={{ fontSize: 10, color: "var(--text2)" }}>Total</div>
              </div>
              <div style={{ flex: 1, textAlign: "center", padding: "8px 4px" }}>
                <div style={{ fontWeight: 700, fontSize: 16, color: passPct >= 50 ? "#16a34a" : "#dc2626" }}>
                  {passPct}%
                </div>
                <div style={{ fontSize: 10, color: "var(--text2)" }}>Pass Rate</div>
              </div>
            </div>

            {noData && (
              <div
                style={{
                  background: "#fffbeb",
                  border: "1px solid #fcd34d",
                  borderTop: "none",
                  padding: "12px 16px",
                  fontSize: 13,
                  color: "#92400e",
                }}
              >
                ⚠ No marks entered yet for this module. Use the Exams and Assignments pages to enter marks.
              </div>
            )}

            {/* ── TABLE 1: Theory ── */}
            {hasTheory && (
              <>
                <TableHeader title="Theory Assessment" color="#1f3864" />
                <div
                  className="table-wrap"
                  style={{ border: "1px solid var(--border)", borderTop: "none", overflowX: "auto" }}
                >
                  <table style={{ fontSize: 12, minWidth: 600 }}>
                    <thead>
                      <tr>
                        <th style={{ width: 30 }}>No</th>
                        <th>Student</th>
                        <th>ID</th>
                        {theoryCWExams.map((e) => (
                          <th
                            key={e.id}
                            style={{ background: "#1f3864", color: "#fff", textAlign: "center", whiteSpace: "nowrap" }}
                          >
                            {e.name}
                          </th>
                        ))}
                        {classAssignments.map((a) => (
                          <th
                            key={a.id}
                            style={{
                              background: "#1f3864",
                              color: "#c8b46a",
                              textAlign: "center",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {a.title}
                          </th>
                        ))}
                        {(theoryCWExams.length > 0 || classAssignments.length > 0) && (
                          <>
                            <th
                              style={{ background: "#002060", color: "#C9A227", textAlign: "center", fontWeight: 700 }}
                            >
                              CW Avg
                            </th>
                            <th
                              style={{ background: "#002060", color: "#C9A227", textAlign: "center", fontWeight: 700 }}
                            >
                              40% CW
                            </th>
                          </>
                        )}
                        {finalTheoryExam && (
                          <>
                            <th
                              style={{
                                background: "#3d0000",
                                color: "#fff",
                                textAlign: "center",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {finalTheoryExam.name}
                            </th>
                            <th style={{ background: "#600000", color: "#fff", textAlign: "center", fontWeight: 700 }}>
                              40% Exam
                            </th>
                          </>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={r.s.id} style={{ background: i % 2 === 0 ? "var(--card)" : "var(--bg2)" }}>
                          <td style={{ textAlign: "center", color: "var(--text2)" }}>{i + 1}</td>
                          <td style={{ fontWeight: 500 }}>{r.s.name}</td>
                          <td style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10 }}>{r.s.studentId}</td>
                          {theoryCWExams.map((e) => (
                            <ScoreCell key={e.id} val={score(r.s.studentId, e.id)} />
                          ))}
                          {classAssignments.map((a) => (
                            <ScoreCell key={a.id} val={score(r.s.studentId, a.id)} />
                          ))}
                          {(theoryCWExams.length > 0 || classAssignments.length > 0) && (
                            <>
                              <td
                                style={{
                                  textAlign: "center",
                                  fontFamily: "'JetBrains Mono',monospace",
                                  background: "#e8f0fe",
                                  fontWeight: 600,
                                }}
                              >
                                {r.theoryCWAvg !== null ? r.theoryCWAvg.toFixed(1) : "—"}
                              </td>
                              <td
                                style={{
                                  textAlign: "center",
                                  fontFamily: "'JetBrains Mono',monospace",
                                  background: "#d0e4ff",
                                  fontWeight: 700,
                                }}
                              >
                                {r.theory40 ?? 0}
                              </td>
                            </>
                          )}
                          {finalTheoryExam && (
                            <>
                              <ScoreCell val={r.finalTheory} />
                              <td
                                style={{
                                  textAlign: "center",
                                  fontFamily: "'JetBrains Mono',monospace",
                                  background: "#fdecea",
                                  fontWeight: 700,
                                }}
                              >
                                {r.final40 ?? 0}
                              </td>
                            </>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {/* ── TABLE 2: Practical ── */}
            {hasPractical && (
              <>
                <TableHeader title="Practical Assessment" color="#7f3f00" />
                <div
                  className="table-wrap"
                  style={{ border: "1px solid var(--border)", borderTop: "none", overflowX: "auto" }}
                >
                  <table style={{ fontSize: 12, minWidth: 600 }}>
                    <thead>
                      <tr>
                        <th style={{ width: 30 }}>No</th>
                        <th>Student</th>
                        <th>ID</th>
                        {practicalCWExams.map((e) => (
                          <th
                            key={e.id}
                            style={{ background: "#7f3f00", color: "#fff", textAlign: "center", whiteSpace: "nowrap" }}
                          >
                            {e.name}
                          </th>
                        ))}
                        {practicalCWExams.length > 0 && (
                          <th style={{ background: "#5a2d00", color: "#ffd580", textAlign: "center", fontWeight: 700 }}>
                            Practical CW Avg
                          </th>
                        )}
                        {recipeExams.map((e) => (
                          <th
                            key={e.id}
                            style={{ background: "#6b3800", color: "#fff", textAlign: "center", whiteSpace: "nowrap" }}
                          >
                            {e.name}
                          </th>
                        ))}
                        {recipeExams.length > 0 && (
                          <th style={{ background: "#5a2d00", color: "#ffd580", textAlign: "center", fontWeight: 700 }}>
                            Recipe Avg
                          </th>
                        )}
                        {(practicalCWExams.length > 0 || recipeExams.length > 0) && (
                          <th
                            style={{ background: "#3d1f00", color: "#ffd580", textAlign: "center", fontWeight: 700 }}
                          >
                            70% Practical CW
                          </th>
                        )}
                        {finalPracExam && (
                          <>
                            <th
                              style={{
                                background: "#1a3a1a",
                                color: "#fff",
                                textAlign: "center",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {finalPracExam.name}
                            </th>
                            <th
                              style={{ background: "#1a3a1a", color: "#90ee90", textAlign: "center", fontWeight: 700 }}
                            >
                              20% Final Prac
                            </th>
                          </>
                        )}
                        {finalPracTheo && (
                          <>
                            <th
                              style={{
                                background: "#1a1a3a",
                                color: "#fff",
                                textAlign: "center",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {finalPracTheo.name}
                            </th>
                            <th
                              style={{ background: "#1a1a3a", color: "#add8e6", textAlign: "center", fontWeight: 700 }}
                            >
                              10% Prac Theory
                            </th>
                          </>
                        )}
                        <th style={{ background: "#002060", color: "#C9A227", textAlign: "center", fontWeight: 800 }}>
                          Practical Mark
                        </th>
                        <th style={{ background: "#002060", color: "#C9A227", textAlign: "center", fontWeight: 800 }}>
                          20% Practical
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={r.s.id} style={{ background: i % 2 === 0 ? "var(--card)" : "var(--bg2)" }}>
                          <td style={{ textAlign: "center", color: "var(--text2)" }}>{i + 1}</td>
                          <td style={{ fontWeight: 500 }}>{r.s.name}</td>
                          <td style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10 }}>{r.s.studentId}</td>
                          {practicalCWExams.map((e) => (
                            <ScoreCell key={e.id} val={score(r.s.studentId, e.id)} />
                          ))}
                          {practicalCWExams.length > 0 && (
                            <td
                              style={{
                                textAlign: "center",
                                fontFamily: "'JetBrains Mono',monospace",
                                background: "#fef9e7",
                                fontWeight: 600,
                              }}
                            >
                              {r.practicalCWAvg !== null ? r.practicalCWAvg.toFixed(1) : "—"}
                            </td>
                          )}
                          {recipeExams.map((e) => (
                            <ScoreCell key={e.id} val={score(r.s.studentId, e.id)} />
                          ))}
                          {recipeExams.length > 0 && (
                            <td
                              style={{
                                textAlign: "center",
                                fontFamily: "'JetBrains Mono',monospace",
                                background: "#fef3e7",
                                fontWeight: 600,
                              }}
                            >
                              {r.recipeAvg !== null ? r.recipeAvg.toFixed(1) : "—"}
                            </td>
                          )}
                          {(practicalCWExams.length > 0 || recipeExams.length > 0) && (
                            <td
                              style={{
                                textAlign: "center",
                                fontFamily: "'JetBrains Mono',monospace",
                                background: "#fdecd0",
                                fontWeight: 700,
                              }}
                            >
                              {r.pracCW70 ?? 0}
                            </td>
                          )}
                          {finalPracExam && (
                            <>
                              <ScoreCell val={r.finalPrac} />
                              <td
                                style={{
                                  textAlign: "center",
                                  fontFamily: "'JetBrains Mono',monospace",
                                  background: "#e8f5e9",
                                  fontWeight: 700,
                                }}
                              >
                                {r.finalPrac20 ?? 0}
                              </td>
                            </>
                          )}
                          {finalPracTheo && (
                            <>
                              <ScoreCell val={r.finalPracT} />
                              <td
                                style={{
                                  textAlign: "center",
                                  fontFamily: "'JetBrains Mono',monospace",
                                  background: "#e8eaf6",
                                  fontWeight: 700,
                                }}
                              >
                                {r.finalPracT10 ?? 0}
                              </td>
                            </>
                          )}
                          <td
                            style={{
                              textAlign: "center",
                              fontFamily: "'JetBrains Mono',monospace",
                              background: "#fff8e1",
                              fontWeight: 700,
                            }}
                          >
                            {r.practicalMark ?? 0}
                          </td>
                          <td
                            style={{
                              textAlign: "center",
                              fontFamily: "'JetBrains Mono',monospace",
                              background: "#fff3cd",
                              fontWeight: 700,
                            }}
                          >
                            {r.prac20 ?? 0}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {/* ── MODULE MARK SUMMARY ── */}
            <TableHeader title="Module Mark" color="#002060" />
            <div
              className="table-wrap"
              style={{
                border: "1px solid var(--border)",
                borderTop: "none",
                borderRadius: "0 0 8px 8px",
                overflowX: "auto",
              }}
            >
              <table style={{ fontSize: 12 }}>
                <thead>
                  <tr>
                    <th style={{ width: 30 }}>No</th>
                    <th>Student</th>
                    <th>ID</th>
                    <th style={{ background: "#002060", color: "#C9A227", textAlign: "center" }}>40% CW</th>
                    <th style={{ background: "#7f3f00", color: "#ffd580", textAlign: "center" }}>20% Practical</th>
                    <th style={{ background: "#3d0000", color: "#fff", textAlign: "center" }}>40% Final Exam</th>
                    <th style={{ background: "#002060", color: "#fff", textAlign: "center", fontWeight: 800 }}>
                      Module Mark
                    </th>
                    <th style={{ textAlign: "center" }}>Decision</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.s.id} style={{ background: i % 2 === 0 ? "var(--card)" : "var(--bg2)" }}>
                      <td style={{ textAlign: "center", color: "var(--text2)" }}>{i + 1}</td>
                      <td style={{ fontWeight: 500 }}>{r.s.name}</td>
                      <td style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10 }}>{r.s.studentId}</td>
                      <td
                        style={{ textAlign: "center", fontFamily: "'JetBrains Mono',monospace", background: "#d0e4ff" }}
                      >
                        {r.theory40 ?? "—"}
                      </td>
                      <td
                        style={{ textAlign: "center", fontFamily: "'JetBrains Mono',monospace", background: "#fdecd0" }}
                      >
                        {r.prac20 ?? 0}
                      </td>
                      <td
                        style={{ textAlign: "center", fontFamily: "'JetBrains Mono',monospace", background: "#fdecea" }}
                      >
                        {r.final40 ?? 0}
                      </td>
                      <td
                        style={{
                          textAlign: "center",
                          fontFamily: "'JetBrains Mono',monospace",
                          fontSize: 14,
                          fontWeight: 800,
                          background: r.moduleMark >= 80 ? "#dcfce7" : r.moduleMark >= 50 ? "#eff6ff" : "#fef2f2",
                        }}
                      >
                        {r.moduleMark}%
                      </td>
                      <td style={{ textAlign: "center" }}>
                        <span className={`badge ${gradeColor(r.decision)}`}>{r.decision}</span>
                      </td>
                    </tr>
                  ))}
                  {classAvg !== null && (
                    <tr style={{ background: "#002060", color: "#fff", fontWeight: 700 }}>
                      <td colSpan={6} style={{ textAlign: "right", paddingRight: 12, fontSize: 11, color: "#C9A227" }}>
                        CLASS AVERAGE
                      </td>
                      <td style={{ textAlign: "center", fontFamily: "'JetBrains Mono',monospace", fontSize: 14 }}>
                        {classAvg}%
                      </td>
                      <td style={{ textAlign: "center" }}>
                        <span className={`badge ${gradeColor(grade(classAvg))}`}>{grade(classAvg)}</span>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Grading scale */}
            <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
              {[
                ["0–49%", "Fail", "badge-fail"],
                ["50–59%", "Pass", "badge-pass"],
                ["60–69%", "Credit", "badge-credit"],
                ["70–79%", "Merit", "badge-merit"],
                ["80–100%", "Distinction", "badge-distinction"],
              ].map(([range, label, cls]) => (
                <div
                  key={label}
                  style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text2)" }}
                >
                  <span className={`badge ${cls}`}>{label}</span> {range}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    );
  };

  // ── OVERVIEW ────────────────────────────────────────────────────────────────
  const OverviewReport = () => (
    <div>
      <div style={{ display: "flex", gap: 10, marginBottom: 16, alignItems: "center" }}>
        <select
          className="form-select"
          style={{ width: "auto" }}
          value={yearFilter}
          onChange={(e) => setYearFilter(e.target.value === "" ? "" : Number(e.target.value))}
        >
          <option value="">All Years</option>
          {[1, 2, 3].map((y) => (
            <option key={y} value={y}>
              Year {y}
            </option>
          ))}
        </select>
        <select
          className="form-select"
          style={{ width: "auto" }}
          value={semFilter}
          onChange={(e) => setSemFilter(e.target.value === "" ? "" : Number(e.target.value))}
        >
          <option value="">All Semesters</option>
          <option value={1}>Semester 1</option>
          <option value={2}>Semester 2</option>
        </select>
        <span style={{ fontSize: 12, color: "var(--text2)" }}>{filteredClasses.length} class(es)</span>
      </div>
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div
          style={{
            background: "#002060",
            color: "#e6edf3",
            padding: "10px 16px",
            fontWeight: 700,
            textAlign: "center",
            fontSize: 13,
          }}
        >
          Grade Overview — {db.config.currentYear}
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Class</th>
                <th>Programme</th>
                <th style={{ textAlign: "center" }}>Yr/Sem</th>
                <th>Lecturer</th>
                {GRADE_ORDER.map((g) => (
                  <th key={g} style={{ textAlign: "center" }}>
                    {g}
                  </th>
                ))}
                <th style={{ textAlign: "center" }}>Students</th>
                <th style={{ textAlign: "center" }}>Pass Rate</th>
                <th style={{ textAlign: "center" }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredClasses.map((cls) => {
                const students = db.students.filter((s) => s.classId === cls.id);
                const prog = db.config.programmes.find((p) => p.id === cls.programme);
                // Use legacy marks for overview
                const counts: Record<string, number> = { Distinction: 0, Merit: 0, Credit: 0, Pass: 0, Fail: 0 };
                students.forEach((s) => {
                  const sMarks = db.marks.filter((m) => m.studentId === s.studentId && m.classId === cls.id);
                  if (sMarks.length) {
                    const a = Math.round(
                      sMarks.reduce((acc, m) => {
                        const cw = ((m.test1 + m.test2 + m.practTest + m.indAss + m.grpAss) / 5) * 0.4;
                        return acc + cw + m.finalExam * 0.4 + m.practical * 0.2;
                      }, 0) / sMarks.length,
                    );
                    const g = grade(a);
                    if (counts[g] !== undefined) counts[g]++;
                  }
                });
                const passPct = students.length
                  ? Math.round(((students.length - (counts.Fail || 0)) / students.length) * 100)
                  : 0;
                return (
                  <tr key={cls.id}>
                    <td className="td-name">{cls.name}</td>
                    <td style={{ fontSize: 11, color: "var(--text2)" }}>{prog?.name || "—"}</td>
                    <td style={{ textAlign: "center", fontSize: 11 }}>
                      Y{cls.year} S{cls.semester}
                    </td>
                    <td style={{ fontSize: 11 }}>{cls.lecturer || "—"}</td>
                    {GRADE_ORDER.map((g) => (
                      <td
                        key={g}
                        style={{
                          textAlign: "center",
                          fontFamily: "'JetBrains Mono',monospace",
                          fontWeight: 700,
                          color: counts[g] > 0 ? "var(--text)" : "#d0d7de",
                        }}
                      >
                        {counts[g]}
                      </td>
                    ))}
                    <td style={{ textAlign: "center", fontWeight: 700 }}>{students.length}</td>
                    <td style={{ textAlign: "center", fontWeight: 700, color: passPct >= 50 ? "#16a34a" : "#dc2626" }}>
                      {passPct}%
                    </td>
                    <td style={{ textAlign: "center" }}>
                      <button
                        className="btn btn-outline btn-sm"
                        onClick={() => {
                          setSelClassId(cls.id);
                          setSelModuleId("");
                          setView("detail");
                        }}
                      >
                        View Report
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">
            <i className="fa-solid fa-chart-bar" style={{ color: "var(--accent)", marginRight: 8 }} />
            Reports
          </div>
          <div className="page-sub">
            {db.config.currentYear} · Semester {db.config.currentSemester}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {(["overview", "detail"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              style={{
                padding: "6px 14px",
                fontSize: 12,
                borderRadius: 6,
                border: "none",
                cursor: "pointer",
                fontWeight: view === v ? 700 : 400,
                background: view === v ? "var(--accent)" : "var(--bg2)",
                color: view === v ? "#fff" : "var(--text1)",
              }}
            >
              {v === "overview" ? "📊 Overview" : "📋 Class Report"}
            </button>
          ))}
        </div>
      </div>
      {view === "overview" ? <OverviewReport /> : <DetailReport />}
    </>
  );
}

// ── Small helpers ─────────────────────────────────────────────────────────────
function ScoreCell({ val }: { val: number | null }) {
  return (
    <td style={{ textAlign: "center", fontFamily: "'JetBrains Mono',monospace" }}>
      {val !== null ? val : <span style={{ color: "#d0d7de" }}>—</span>}
    </td>
  );
}
function TableHeader({ title, color }: { title: string; color: string }) {
  return (
    <div
      style={{
        background: color,
        color: "#fff",
        padding: "8px 16px",
        fontWeight: 700,
        fontSize: 12,
        textTransform: "uppercase",
        letterSpacing: 0.5,
        borderLeft: `3px solid #C9A227`,
        marginTop: 12,
      }}
    >
      {title}
    </div>
  );
}
function Placeholder({ text }: { text: string }) {
  return <div style={{ textAlign: "center", padding: 60, color: "var(--text2)", fontSize: 13 }}>{text}</div>;
}
