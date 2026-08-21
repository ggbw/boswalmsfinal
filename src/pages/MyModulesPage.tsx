import { useApp } from "@/context/AppContext";
import { grade, gradeColor, type DB, type Student } from "@/data/db";
import { getLecturersForModuleClass } from "@/lib/lecturerHelpers";
import { useAssessmentMarks } from "@/hooks/useAssessmentMarks";
import { studentModuleResults, studentAverage } from "@/lib/studentMarks";

export default function MyModulesPage() {
  const { db, currentUser } = useApp();
  const stu =
    currentUser?.role === "student"
      ? db.students.find((s) => s.studentId === currentUser?.studentId)
      : null;

  if (!stu)
    return (
      <div className="card" style={{ textAlign: "center", padding: 40 }}>
        This page is only available to students.
      </div>
    );

  return <MyModulesInner stu={stu} db={db} />;
}

// Split out so the marks hook is not called behind the early returns above.
function MyModulesInner({ stu, db }: { stu: Student; db: DB }) {

  const cls = db.classes.find((c) => c.id === stu.classId);
  const prog = db.config.programmes.find((p) => p.id === stu.programme);

  // Current semester modules — from current class + overrides
  const currentClassMods = db.modules.filter((m) => m.classes.includes(stu.classId));
  const overrideModIds = db.studentModules.filter((sm) => sm.studentId === stu.id).map((sm) => sm.moduleId);
  const overrideMods = db.modules.filter(
    (m) => overrideModIds.includes(m.id) && !currentClassMods.find((cm) => cm.id === m.id),
  );
  const currentModIds = new Set([...currentClassMods, ...overrideMods].map((m) => m.id));

  // Marks come from assessment_marks. This previously read db.marks, filtering
  // by the student number against rows keyed by students.id — so it matched
  // nothing and every student saw zero modules and no average.
  const { scoreOf, loading: marksLoading } = useAssessmentMarks({ studentNumbers: [stu.studentId] });
  const results = marksLoading ? [] : studentModuleResults(db, stu, scoreOf);
  const markedResults = results.filter((r) => !r.unmarked);
  const markOf = (moduleId: string) =>
    markedResults.find((r) => r.module.id === moduleId)?.mark ?? null;

  // Past modules: marked modules that are not in the current class — i.e.
  // carried over from an earlier semester or year.
  const pastMods = markedResults
    .filter((r) => !currentModIds.has(r.module.id))
    .map((r) => r.module);

  const allModsWithMarks = markedResults.length;
  const currentMods = [...currentClassMods, ...overrideMods];
  const passingCurrent = markedResults.filter(
    (r) => currentModIds.has(r.module.id) && r.mark.moduleMark >= 50,
  ).length;
  const avgMark = studentAverage(results);

  const getLecturer = (mod: (typeof currentMods)[0]) => {
    // Every lecturer teaching this module, across the classes it runs in. This
    // used to take the FIRST match per class, so a co-taught module showed one
    // name and the second assignment looked as though it had not saved.
    const lecturerIds = [...new Set(
      (mod.classes || []).flatMap((cid: string) =>
        getLecturersForModuleClass(db.lecturerModules, mod.id, cid),
      ),
    )];
    const names = lecturerIds
      .map((lid) => db.users.find((u) => u.id === lid)?.name)
      .filter(Boolean);
    return names.join(", ") || "—";
  };

  const renderModuleCard = (m: (typeof currentMods)[0], isPast: boolean) => {
    // Already weighted by computeStudentModuleMark — no second calculation here.
    const mark = markOf(m.id);
    const mm = mark ? mark.moduleMark : null;
    const g = mm !== null ? grade(mm) : null;
    const passed = mm !== null && mm >= 50;
    const dept = db.departments.find((d) => d.id === m.dept);
    const lecturer = getLecturer(m);

    // Colours
    let barColor: string;
    if (isPast) {
      barColor = passed ? "#27ae60" : mm !== null ? "var(--danger)" : "var(--border)";
    } else {
      barColor = mm === null ? "var(--accent)" : mm >= 80 ? "#27ae60" : mm >= 50 ? "var(--accent2)" : "var(--danger)";
    }

    // Status badge
    let statusBadge: React.ReactNode;
    if (isPast) {
      if (passed) {
        statusBadge = (
          <span className="badge badge-active" style={{ opacity: 0.8 }}>
            Passed
          </span>
        );
      } else if (mm !== null) {
        statusBadge = (
          <span className="badge badge-fail" style={{ opacity: 0.8 }}>
            Failed
          </span>
        );
      } else {
        statusBadge = <span className="badge badge-inactive">Historical</span>;
      }
    } else {
      statusBadge = (
        <span className="badge" style={{ background: "var(--accent)", color: "#fff", fontWeight: 700 }}>
          Active
        </span>
      );
    }

    // Semester/year info from the mark record
    const semInfo = mark ? `Year ${stu.year} · Sem ${stu.semester}` : null;

    return (
      <div
        key={m.id}
        style={{
          borderRadius: 10,
          overflow: "hidden",
          background: "var(--surface)",
          border: "1px solid var(--border)",
          opacity: isPast ? 0.72 : 1,
          filter: isPast ? "grayscale(30%)" : "none",
          transition: "opacity .2s",
        }}
      >
        {/* Top colour bar */}
        <div style={{ height: 4, background: barColor }} />
        <div style={{ padding: 16 }}>
          {/* Header row */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              marginBottom: 8,
              gap: 8,
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontWeight: 700,
                  fontSize: 14,
                  color: isPast ? "var(--text2)" : "var(--text1)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {m.name}
              </div>
              <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 2 }}>
                {m.code}
                {dept ? ` · ${dept.name}` : ""}
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
              {statusBadge}
              {g && (
                <span className={`badge ${gradeColor(g)}`} style={{ fontSize: 10 }}>
                  {g}
                </span>
              )}
            </div>
          </div>

          {/* Semester tag */}
          {semInfo && (
            <div
              style={{
                fontSize: 10,
                color: "var(--text3)",
                marginBottom: 6,
                fontFamily: "'JetBrains Mono', monospace",
              }}
            >
              {semInfo}
            </div>
          )}

          {/* Lecturer */}
          <div style={{ fontSize: 11, color: "var(--text2)", marginBottom: 10 }}>
            <i className="fa-solid fa-chalkboard-user" style={{ marginRight: 4 }} /> {lecturer}
          </div>

          {/* Progress bar */}
          <div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 11,
                color: "var(--text2)",
                marginBottom: 4,
              }}
            >
              <span>{isPast ? "Final mark" : "Overall mark"}</span>
              <span style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 700, color: barColor }}>
                {mm !== null ? mm + "%" : isPast ? "—" : "Pending"}
              </span>
            </div>
            <div style={{ height: 6, background: "var(--surface2)", borderRadius: 3, overflow: "hidden" }}>
              <div
                style={{
                  height: "100%",
                  width: `${mm || 0}%`,
                  background: barColor,
                  borderRadius: 3,
                  transition: "width .4s ease",
                }}
              />
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <>
      <div className="page-header">
        <div className="page-title">
          <i className="fa-solid fa-book-open" style={{ marginRight: 8, color: "var(--accent)" }} /> My Modules
        </div>
        {cls && (
          <div style={{ fontSize: 12, color: "var(--text2)" }}>
            {cls.name} &nbsp;·&nbsp; Year {stu.year} &nbsp;·&nbsp; Semester {stu.semester}
          </div>
        )}
      </div>

      {/* Stats */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))",
          gap: 12,
          marginBottom: 20,
        }}
      >
        <div className="card" style={{ textAlign: "center", padding: "14px 10px" }}>
          <div style={{ fontSize: 26, fontWeight: 800, color: "var(--accent)" }}>{currentMods.length}</div>
          <div style={{ fontSize: 11, color: "var(--text2)", marginTop: 2 }}>Active this semester</div>
        </div>
        <div className="card" style={{ textAlign: "center", padding: "14px 10px" }}>
          <div style={{ fontSize: 26, fontWeight: 800 }}>{pastMods.length}</div>
          <div style={{ fontSize: 11, color: "var(--text2)", marginTop: 2 }}>Completed</div>
        </div>
        <div className="card" style={{ textAlign: "center", padding: "14px 10px" }}>
          <div style={{ fontSize: 26, fontWeight: 800, color: "#27ae60" }}>{passingCurrent}</div>
          <div style={{ fontSize: 11, color: "var(--text2)", marginTop: 2 }}>Passing (current)</div>
        </div>
        <div className="card" style={{ textAlign: "center", padding: "14px 10px" }}>
          <div
            style={{
              fontSize: 26,
              fontWeight: 800,
              color: avgMark !== null ? (avgMark >= 50 ? "#27ae60" : "var(--danger)") : "var(--text3)",
            }}
          >
            {avgMark !== null ? avgMark + "%" : "—"}
          </div>
          <div style={{ fontSize: 11, color: "var(--text2)", marginTop: 2 }}>Overall average</div>
        </div>
      </div>

      {/* Current / Active semester modules */}
      {currentMods.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: "var(--text1)" }}>
              <span className="badge" style={{ background: "var(--accent)", color: "#fff", marginRight: 8 }}>
                Active
              </span>
              Current Semester — Year {stu.year} · Semester {stu.semester}
            </div>
            <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
            <div style={{ fontSize: 11, color: "var(--text2)" }}>{currentMods.length} module(s)</div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))", gap: 16 }}>
            {currentMods.map((m) => renderModuleCard(m, false))}
          </div>
        </div>
      )}

      {/* Past / Completed modules */}
      {pastMods.length > 0 && (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: "var(--text2)" }}>
              <span className="badge badge-inactive" style={{ marginRight: 8 }}>
                Completed
              </span>
              Previous Semesters
            </div>
            <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
            <div style={{ fontSize: 11, color: "var(--text2)" }}>{pastMods.length} module(s)</div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))", gap: 16 }}>
            {pastMods.map((m) => renderModuleCard(m, true))}
          </div>
        </div>
      )}

      {currentMods.length === 0 && pastMods.length === 0 && (
        <div className="card" style={{ textAlign: "center", padding: 40, color: "var(--text2)" }}>
          No modules found. Contact your administrator if this seems incorrect.
        </div>
      )}
    </>
  );
}
