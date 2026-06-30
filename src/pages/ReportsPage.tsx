import { useState, useEffect, useCallback, useMemo } from "react";
import { useApp } from "@/context/AppContext";
import { supabase } from "@/integrations/supabase/client";
import { getLecturerClasses } from "@/lib/lecturerHelpers";
import { avg, categorizeModuleAssessments, computeStudentModuleMark } from "@/lib/moduleMark";
import { letterGrade, letterBadgeClass, GRADE_SCALE, LETTER_ORDER, PASS_MARK } from "@/lib/grading";

// Grade-distribution columns use the shared transcript letter scale so the report
// and the transcript always agree.
const GRADE_ORDER = LETTER_ORDER;

interface AssessmentMark {
  student_id: string;
  assessment_id: string;
  score: number;
}

export default function ReportsPage() {
  const { db, currentUser } = useApp();
  const role = currentUser?.role;
  const visibleClasses = role === "lecturer"
    ? getLecturerClasses(db.lecturerModules, db.classes, currentUser?.id || '')
    : db.classes;

  const [view, setView] = useState<"overview" | "detail">("overview");
  const [selClassId, setSelClassId] = useState(visibleClasses[0]?.id || "");
  const [selModuleId, setSelModuleId] = useState("");
  const [yearFilter, setYearFilter] = useState<number | "">("");
  const [semFilter, setSemFilter] = useState<number | "">("");
  const [asmMarks, setAsmMarks] = useState<AssessmentMark[]>([]);
  const [loading, setLoading] = useState(false);

  // Load assessment_marks for selected class+module.
  //
  // Match marks by assessment_id (the exam/assignment they belong to) rather than
  // the denormalised class_id/module_id columns stored on assessment_marks. Those
  // columns are snapshotted from the exam at save time and go stale if the exam is
  // later re-assigned to a different module or class — which would make already-
  // saved marks silently vanish from this report even though they still appear on
  // the Exams "Enter Marks" screen (that screen keys on assessment_id). Keying on
  // assessment_id keeps the two views consistent.
  const loadMarks = useCallback(async (classId: string, moduleId: string) => {
    if (!classId || !moduleId) return;
    setLoading(true);
    const assessmentIds = [
      ...db.exams.filter((e) => e.classId === classId && e.moduleId === moduleId).map((e) => e.id),
      ...db.assignments.filter((a) => a.classId === classId && a.moduleId === moduleId).map((a) => a.id),
    ];
    if (assessmentIds.length === 0) {
      setAsmMarks([]);
      setLoading(false);
      return;
    }
    const { data } = await supabase
      .from("assessment_marks")
      .select("student_id, assessment_id, score")
      .in("assessment_id", assessmentIds);
    setAsmMarks(
      (data || []).map((x: any) => ({
        student_id: x.student_id,
        assessment_id: x.assessment_id,
        score: Number(x.score),
      })),
    );
    setLoading(false);
  }, [db.exams, db.assignments]);

  // Modules the report can actually show for a class = those that have an exam or
  // assignment in that class. We deliberately do NOT use the module_classes link
  // here: the data has modules that carry marks/exams for a class they were never
  // formally linked to (e.g. "Hot Kitchen" for Reubens). Driving the dropdown off
  // real assessments means such a module still appears, and the default module is
  // one that actually has data instead of an arbitrary first-of-all-modules.
  const modulesForClass = useCallback((classId: string) => {
    const ids = new Set<string>();
    db.exams.forEach((e) => { if (e.classId === classId && e.moduleId) ids.add(e.moduleId); });
    db.assignments.forEach((a) => { if (a.classId === classId && a.moduleId) ids.add(a.moduleId); });
    return db.modules.filter((m) => ids.has(m.id));
  }, [db.exams, db.assignments, db.modules]);

  useEffect(() => {
    if (view === "detail" && selClassId) {
      const cm = modulesForClass(selClassId);
      const mid = selModuleId || cm[0]?.id || "";
      if (mid) loadMarks(selClassId, mid);
    }
  }, [view, selClassId, selModuleId, loadMarks, modulesForClass]);

  // Overview grades are computed from assessment_marks (the real source of truth),
  // the same data the Class Report uses. The legacy `marks` table is unreliable
  // for this: it is keyed by the student row id (e.g. "s052") while the rest of the
  // app keys on the human student number (e.g. "BCI2025D-52"), so the old overview
  // matched nothing and showed empty grade columns.
  const [ovMarks, setOvMarks] = useState<AssessmentMark[]>([]);
  useEffect(() => {
    if (view !== "overview") return;
    const classIds = visibleClasses.map((c) => c.id);
    if (classIds.length === 0) { setOvMarks([]); return; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("assessment_marks")
        .select("student_id, assessment_id, score")
        .in("class_id", classIds);
      if (!cancelled) {
        setOvMarks(
          (data || []).map((x: any) => ({
            student_id: x.student_id,
            assessment_id: x.assessment_id,
            score: Number(x.score),
          })),
        );
      }
    })();
    return () => { cancelled = true; };
    // db.classes / db.lecturerModules are stable references until a reload, so this
    // does not loop; visibleClasses is derived from them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, db.classes, db.lecturerModules]);

  // O(1) lookup for overview score-of-assessment (the overview loops over every
  // class × student × module, so a linear scan per cell would be slow).
  const ovScoreMap = useMemo(() => {
    const m = new Map<string, number>();
    ovMarks.forEach((x) => m.set(`${x.student_id}|${x.assessment_id}`, x.score));
    return m;
  }, [ovMarks]);
  const ovScoreOf = useCallback(
    (studentId: string, assessmentId: string) => {
      const v = ovScoreMap.get(`${studentId}|${assessmentId}`);
      return v === undefined ? null : v;
    },
    [ovScoreMap],
  );

  const filteredClasses = visibleClasses.filter((c) => {
    if (yearFilter !== "" && c.year !== yearFilter) return false;
    if (semFilter !== "" && c.semester !== semFilter) return false;
    return true;
  });

  // ── DETAIL REPORT ──────────────────────────────────────────────────────────
  const DetailReport = () => {
    const cls = db.classes.find((c) => c.id === selClassId);
    if (!cls) return <Placeholder text="Select a class to view the report." />;

    const classModules = modulesForClass(cls.id);
    const moduleId = selModuleId || classModules[0]?.id || "";
    const mod = db.modules.find((m) => m.id === moduleId);
    // Non-practical modules are weighted Coursework 60% + Final Exam 40%
    // (no practical section); practical modules stay CW 40% + Prac 20% + Exam 40%.
    const moduleHasPractical = mod?.hasPractical !== false;
    const cwPct = moduleHasPractical ? 40 : 60;
    const students = db.students.filter((s) => s.classId === cls.id);
    const prog = db.config.programmes.find((p) => p.id === cls.programme);

    // Get all exams and assignments for this class+module
    const classExams = db.exams.filter((e) => e.classId === cls.id && e.moduleId === moduleId);
    const classAssignments = db.assignments.filter((a) => a.classId === cls.id && a.moduleId === moduleId);

    // Categorise into the buckets the weighting needs (shared with the transcript).
    const cat = categorizeModuleAssessments(classExams, classAssignments);
    const { theoryCWExams, finalTheoryExam, practicalCWExams, recipeExams, finalPracExam, finalPracTheo } = cat;

    // Helper: get score for a student+assessment
    const score = (studentId: string, assessmentId: string) => {
      const m = asmMarks.find((x) => x.student_id === studentId && x.assessment_id === assessmentId);
      return m ? m.score : null;
    };

    // Build rows using the shared weighted computation.
    const rows = students.map((s) => {
      const mark = computeStudentModuleMark({
        studentId: s.studentId,
        hasPractical: moduleHasPractical,
        cat,
        scoreOf: score,
      });
      return { s, ...mark, decision: letterGrade(mark.moduleMark) };
    });

    const classAvg = rows.length ? Math.round(avg(rows.map((r) => r.moduleMark))) : null;
    const gradeCounts: Record<string, number> = Object.fromEntries(LETTER_ORDER.map((g) => [g, 0]));
    rows.forEach((r) => {
      gradeCounts[r.decision] = (gradeCounts[r.decision] || 0) + 1;
    });
    // Pass rate uses the shared pass mark (40%): a fail is any mark below it.
    const failCount = rows.filter((r) => r.moduleMark < PASS_MARK).length;
    const passPct = students.length
      ? Math.round(((students.length - failCount) / students.length) * 100)
      : 0;

    const hasTheory = theoryCWExams.length > 0 || classAssignments.length > 0 || finalTheoryExam;
    const hasPractical =
      moduleHasPractical &&
      (practicalCWExams.length > 0 || recipeExams.length > 0 || !!finalPracExam || !!finalPracTheo);

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
        ...(thHeaders.length > 0 ? ["CW Avg", `${cwPct}% CW`] : []),
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
        ...GRADE_SCALE.map(([label, range]) => ["", "", `${label}   ${range}`]),
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
                              {cwPct}% CW
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
                    <th style={{ background: "#002060", color: "#C9A227", textAlign: "center" }}>{cwPct}% CW</th>
                    {moduleHasPractical && (
                      <th style={{ background: "#7f3f00", color: "#ffd580", textAlign: "center" }}>20% Practical</th>
                    )}
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
                      {moduleHasPractical && (
                        <td
                          style={{ textAlign: "center", fontFamily: "'JetBrains Mono',monospace", background: "#fdecd0" }}
                        >
                          {r.prac20 ?? 0}
                        </td>
                      )}
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
                        <span className={`badge ${letterBadgeClass(r.decision)}`}>{r.decision}</span>
                      </td>
                    </tr>
                  ))}
                  {classAvg !== null && (
                    <tr style={{ background: "#002060", color: "#fff", fontWeight: 700 }}>
                      <td colSpan={moduleHasPractical ? 6 : 5} style={{ textAlign: "right", paddingRight: 12, fontSize: 11, color: "#C9A227" }}>
                        CLASS AVERAGE
                      </td>
                      <td style={{ textAlign: "center", fontFamily: "'JetBrains Mono',monospace", fontSize: 14 }}>
                        {classAvg}%
                      </td>
                      <td style={{ textAlign: "center" }}>
                        <span className={`badge ${letterBadgeClass(letterGrade(classAvg))}`}>{letterGrade(classAvg)}</span>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Grading scale — shared with the transcript */}
            <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
              {GRADE_SCALE.map(([label, range]) => (
                <div
                  key={label}
                  style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text2)" }}
                >
                  <span className={`badge ${letterBadgeClass(label)}`}>{label}</span> {range}
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
                // Grade distribution computed from assessment_marks, using the
                // same weighted module-mark helper as the Class Report so the two
                // always agree. A student is graded on the average of the module
                // marks they actually have marks for in this class.
                const clsModuleIds = modulesForClass(cls.id).map((m) => m.id);
                const counts: Record<string, number> = Object.fromEntries(LETTER_ORDER.map((g) => [g, 0]));
                students.forEach((s) => {
                  const moduleMarks: number[] = [];
                  clsModuleIds.forEach((mid) => {
                    const mod = db.modules.find((mo) => mo.id === mid);
                    const classExams = db.exams.filter((e) => e.classId === cls.id && e.moduleId === mid);
                    const classAssignments = db.assignments.filter((a) => a.classId === cls.id && a.moduleId === mid);
                    const hasAny = [...classExams, ...classAssignments].some(
                      (a) => ovScoreOf(s.studentId, a.id) !== null,
                    );
                    if (!hasAny) return;
                    const cat = categorizeModuleAssessments(classExams, classAssignments);
                    const { moduleMark } = computeStudentModuleMark({
                      studentId: s.studentId,
                      hasPractical: mod?.hasPractical !== false,
                      cat,
                      scoreOf: ovScoreOf,
                    });
                    moduleMarks.push(moduleMark);
                  });
                  if (moduleMarks.length) {
                    const g = letterGrade(Math.round(avg(moduleMarks)));
                    if (counts[g] !== undefined) counts[g]++;
                  }
                });
                const passPct = students.length
                  ? Math.round(((students.length - (counts.F || 0)) / students.length) * 100)
                  : 0;
                return (
                  <tr key={cls.id}>
                    <td className="td-name">{cls.name}</td>
                    <td style={{ fontSize: 11, color: "var(--text2)" }}>{prog?.name || "—"}</td>
                    <td style={{ textAlign: "center", fontSize: 11 }}>
                      Y{cls.year} S{cls.semester}
                    </td>
                    <td style={{ fontSize: 11 }}>{[...new Set(db.lecturerModules.filter(lm => lm.classId === cls.id).map(lm => db.users.find(u => u.id === lm.lecturerId)?.name).filter(Boolean))].join(', ') || "—"}</td>
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
