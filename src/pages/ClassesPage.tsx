import { useState, Fragment } from "react";
import { useApp } from "@/context/AppContext";
import { supabase } from "@/integrations/supabase/client";

// Sync module_classes for a class based on its programme + year + semester
async function syncModulesForClass(classId: string, programmeId: string, year: number, semester: number) {
  const { data: pmRows } = await supabase
    .from("programme_modules" as any)
    .select("module_id")
    .eq("programme_id", programmeId)
    .eq("year", year)
    .eq("semester", semester);

  await supabase.from("module_classes").delete().eq("class_id", classId);

  const moduleIds = (pmRows || []).map((r: any) => r.module_id);
  if (moduleIds.length > 0) {
    await supabase.from("module_classes").insert(
      moduleIds.map((modId: string) => ({ module_id: modId, class_id: classId }))
    );
  }
}

// Panel to assign a lecturer to each module within a class
function ModuleAssignmentPanel({ classId, onClose }: { classId: string; onClose: () => void }) {
  const { db, toast, reloadDb } = useApp();
  const lecturers = db.users.filter((u) => ["lecturer", "hod", "hoy"].includes(u.role));
  const [saving, setSaving] = useState<string | null>(null);

  // Modules already linked to this class via module_classes
  const linkedModuleIds = new Set(db.modules.filter((m) => m.classes.includes(classId)).map((m) => m.id));
  // Show linked modules first, then any modules that have a lecturer assignment but aren't linked, then all others
  const assignedModuleIds = new Set(db.lecturerModules.filter((lm) => lm.classId === classId).map((lm) => lm.moduleId));
  const allModules = [...db.modules].sort((a, b) => {
    const aLinked = linkedModuleIds.has(a.id) ? 0 : assignedModuleIds.has(a.id) ? 1 : 2;
    const bLinked = linkedModuleIds.has(b.id) ? 0 : assignedModuleIds.has(b.id) ? 1 : 2;
    return aLinked - bLinked || a.name.localeCompare(b.name);
  });

  const getLecturerId = (moduleId: string) =>
    db.lecturerModules.find((lm) => lm.moduleId === moduleId && lm.classId === classId)?.lecturerId || "";

  const handleAssign = async (moduleId: string, lecturerId: string) => {
    setSaving(moduleId);
    const existing = db.lecturerModules.find((lm) => lm.moduleId === moduleId && lm.classId === classId);
    if (existing) {
      if (lecturerId === "") {
        const { error } = await supabase.from("lecturer_modules").delete().eq("id", existing.id);
        if (error) toast(error.message, "error");
        else { toast("Assignment removed", "success"); reloadDb(); }
      } else {
        const { error } = await supabase.from("lecturer_modules").update({ lecturer_id: lecturerId }).eq("id", existing.id);
        if (error) toast(error.message, "error");
        else { toast("Lecturer updated", "success"); reloadDb(); }
      }
    } else if (lecturerId !== "") {
      const { error } = await supabase.from("lecturer_modules").insert({
        id: "lm_" + Date.now() + "_" + moduleId,
        lecturer_id: lecturerId,
        module_id: moduleId,
        class_id: classId,
      });
      if (error) toast(error.message, "error");
      else { toast("Lecturer assigned", "success"); reloadDb(); }
    }
    setSaving(null);
  };

  return (
    <div style={{ background: "var(--bg2)", borderRadius: 8, padding: 16, marginTop: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>Module Lecturers</div>
        <button className="btn btn-outline btn-sm" onClick={onClose}>Close</button>
      </div>
      {linkedModuleIds.size === 0 && (
        <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 10, padding: "6px 8px", background: "var(--bg3)", borderRadius: 5 }}>
          No modules synced to this class yet — showing all modules. Run <strong>Sync Modules</strong> to auto-link modules from the programme.
        </div>
      )}
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ borderBottom: "1px solid var(--border)" }}>
            <th style={{ textAlign: "left", padding: "6px 8px", fontSize: 12 }}>Module</th>
            <th style={{ textAlign: "left", padding: "6px 8px", fontSize: 12 }}>Lecturer</th>
          </tr>
        </thead>
        <tbody>
          {allModules.map((mod) => {
            const isLinked = linkedModuleIds.has(mod.id);
            return (
              <tr key={mod.id} style={{ borderBottom: "1px solid var(--border)", opacity: isLinked || linkedModuleIds.size === 0 ? 1 : 0.5 }}>
                <td style={{ padding: "6px 8px", fontSize: 13 }}>
                  <div style={{ fontWeight: 600 }}>{mod.name}</div>
                  <div style={{ fontSize: 11, color: "var(--text2)" }}>
                    {mod.code}
                    {!isLinked && linkedModuleIds.size > 0 && <span style={{ marginLeft: 6, color: "var(--text3)" }}>(not in this class)</span>}
                  </div>
                </td>
                <td style={{ padding: "6px 8px" }}>
                  <select
                    className="form-select"
                    value={getLecturerId(mod.id)}
                    disabled={saving === mod.id}
                    onChange={(e) => handleAssign(mod.id, e.target.value)}
                    style={{ fontSize: 12, minWidth: 180 }}
                  >
                    <option value="">— Unassigned —</option>
                    {lecturers.map((l) => (
                      <option key={l.id} value={l.id}>{l.name}</option>
                    ))}
                  </select>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function ClassesPage() {
  const { db, currentUser, toast, showModal, closeModal, reloadDb } = useApp();
  const isAdmin = currentUser?.role === "admin";
  const [syncing, setSyncing] = useState(false);
  const [openPanelId, setOpenPanelId] = useState<string | null>(null);

  const syncAllModules = async () => {
    setSyncing(true);
    let count = 0;
    for (const cls of db.classes) {
      if (cls.programme) {
        await syncModulesForClass(cls.id, cls.programme, cls.year, cls.semester);
        count++;
      }
    }
    await reloadDb();
    setSyncing(false);
    toast(`Synced modules for ${count} class(es)`, "success");
  };

  const showEditClass = (clsId: string) => {
    const cls = db.classes.find((c) => c.id === clsId);
    if (!cls) return;
    let name = cls.name,
      programme = cls.programme,
      year = cls.year,
      semester = cls.semester,
      calYear = cls.calYear,
      division = cls.division;

    showModal(
      "Edit Class",
      <div>
        <div className="form-row cols2">
          <div className="form-group">
            <label>Class Name *</label>
            <input className="form-input" defaultValue={name} onChange={(e) => (name = e.target.value)} />
          </div>
          <div className="form-group">
            <label>Programme</label>
            <select className="form-input" defaultValue={programme} onChange={(e) => (programme = e.target.value)}>
              {db.config.programmes.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.startYear})
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="form-row cols2">
          <div className="form-group">
            <label>Year</label>
            <select className="form-input" defaultValue={year} onChange={(e) => (year = Number(e.target.value))}>
              <option value={1}>Year 1</option>
              <option value={2}>Year 2</option>
              <option value={3}>Year 3</option>
            </select>
          </div>
          <div className="form-group">
            <label>Semester</label>
            <select
              className="form-input"
              defaultValue={semester}
              onChange={(e) => (semester = Number(e.target.value))}
            >
              <option value={1}>Semester 1</option>
              <option value={2}>Semester 2</option>
            </select>
          </div>
        </div>
        <div className="form-row cols2">
          <div className="form-group">
            <label>Calendar Year</label>
            <input
              className="form-input"
              type="number"
              defaultValue={calYear}
              onChange={(e) => (calYear = Number(e.target.value))}
            />
          </div>
          <div className="form-group">
            <label>Division</label>
            <input className="form-input" defaultValue={division} onChange={(e) => (division = e.target.value)} />
          </div>
        </div>
        <button
          className="btn btn-primary"
          style={{ marginTop: 12 }}
          onClick={async () => {
            if (!name.trim()) {
              toast("Class name is required", "error");
              return;
            }
            const { error } = await supabase
              .from("classes")
              .update({ name, programme, year, semester, cal_year: calYear, division })
              .eq("id", clsId);
            if (error) {
              toast(error.message, "error");
              return;
            }
            if (programme !== cls.programme) {
              await supabase.from("students").update({ programme }).eq("class_id", clsId);
            }
            await syncModulesForClass(clsId, programme, year, semester);
            toast("Class updated successfully!", "success");
            closeModal();
            reloadDb();
          }}
        >
          Save Changes
        </button>
      </div>,
    );
  };

  const showAddClass = () => {
    let name = "",
      programme = db.config.programmes[0]?.id || "",
      year = 1,
      semester = 1,
      calYear = new Date().getFullYear(),
      division = "";

    showModal(
      "Create New Class (New Intake)",
      <div>
        <div
          style={{
            background: "var(--bg3)",
            padding: "8px 12px",
            borderRadius: 6,
            marginBottom: 14,
            fontSize: 12,
            color: "var(--text2)",
          }}
        >
          <i className="fa-solid fa-info-circle" /> Use this to create a class for a new intake group of students.
        </div>
        <div className="form-row cols2">
          <div className="form-group">
            <label>Class Name *</label>
            <input
              className="form-input"
              placeholder="e.g. Escoffiers 2026"
              onChange={(e) => (name = e.target.value)}
            />
          </div>
          <div className="form-group">
            <label>Programme *</label>
            <select className="form-input" onChange={(e) => (programme = e.target.value)}>
              {db.config.programmes.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.startYear})
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="form-row cols2">
          <div className="form-group">
            <label>Year</label>
            <select className="form-input" onChange={(e) => (year = Number(e.target.value))}>
              <option value={1}>Year 1</option>
              <option value={2}>Year 2</option>
              <option value={3}>Year 3</option>
            </select>
          </div>
          <div className="form-group">
            <label>Semester</label>
            <select className="form-input" onChange={(e) => (semester = Number(e.target.value))}>
              <option value={1}>Semester 1</option>
              <option value={2}>Semester 2</option>
            </select>
          </div>
        </div>
        <div className="form-row cols2">
          <div className="form-group">
            <label>Calendar Year</label>
            <input
              className="form-input"
              type="number"
              defaultValue={calYear}
              onChange={(e) => (calYear = Number(e.target.value))}
            />
          </div>
          <div className="form-group">
            <label>Division</label>
            <input
              className="form-input"
              placeholder="e.g. Year 1 - 2026"
              onChange={(e) => (division = e.target.value)}
            />
          </div>
        </div>
        <button
          className="btn btn-primary"
          style={{ marginTop: 12 }}
          onClick={async () => {
            if (!name.trim()) {
              toast("Class name is required", "error");
              return;
            }
            const newId = "cls" + Date.now();
            const { error } = await supabase.from("classes").insert({
              id: newId,
              name,
              programme,
              year,
              semester,
              cal_year: calYear,
              division,
            });
            if (error) {
              toast(error.message, "error");
              return;
            }
            await syncModulesForClass(newId, programme, year, semester);
            toast("Class created successfully!", "success");
            closeModal();
            reloadDb();
          }}
        >
          Create Class
        </button>
      </div>,
    );
  };

  return (
    <>
      <div className="page-header">
        <div className="page-title">Classes</div>
        {isAdmin && (
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-outline btn-sm" onClick={syncAllModules} disabled={syncing}>
              <i className={`fa-solid ${syncing ? "fa-spinner fa-spin" : "fa-rotate"}`} /> {syncing ? "Syncing…" : "Sync Modules"}
            </button>
            <button className="btn btn-primary btn-sm" onClick={showAddClass}>
              <i className="fa-solid fa-plus" /> New Class (Intake)
            </button>
          </div>
        )}
      </div>
      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Class Name</th>
                <th>Type</th>
                <th>Year/Sem</th>
                <th>Cal Year</th>
                <th>Lecturers</th>
                <th>Students</th>
                <th>Status</th>
                {isAdmin && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {db.classes.map((cls) => {
                const prog = db.config.programmes.find((p) => p.id === cls.programme);
                const studCount = db.students.filter((s) => s.classId === cls.id).length;
                const classLecturers = [...new Set(
                  db.lecturerModules
                    .filter((lm) => lm.classId === cls.id)
                    .map((lm) => db.users.find((u) => u.id === lm.lecturerId)?.name)
                    .filter(Boolean) as string[]
                )];
                return (
                  <Fragment key={cls.id}>
                    <tr>
                      <td className="td-name">{cls.name}</td>
                      <td>{prog?.type}</td>
                      <td>Year {cls.year} · Sem {cls.semester}</td>
                      <td>{cls.calYear}</td>
                      <td style={{ fontSize: 12 }}>{classLecturers.length > 0 ? classLecturers.join(", ") : <span style={{ color: "var(--text3)" }}>—</span>}</td>
                      <td style={{ fontFamily: "'JetBrains Mono',monospace" }}>{studCount}</td>
                      <td><span className="badge badge-active">Active</span></td>
                      {isAdmin && (
                        <td>
                          <div style={{ display: "flex", gap: 4 }}>
                            <button
                              className="btn btn-outline btn-sm"
                              onClick={() => setOpenPanelId(openPanelId === cls.id ? null : cls.id)}
                              title="Assign module lecturers"
                            >
                              <i className="fa-solid fa-chalkboard-user" /> Lecturers
                            </button>
                            <button className="btn btn-outline btn-sm" onClick={() => showEditClass(cls.id)}>
                              <i className="fa-solid fa-pen" /> Edit
                            </button>
                            <button className="btn btn-danger btn-sm" onClick={async () => {
                              if (!confirm(`Delete class "${cls.name}"? This cannot be undone.`)) return;
                              const { error } = await supabase.from("classes").delete().eq("id", cls.id);
                              if (error) { toast(error.message, "error"); } else { toast("Class deleted", "success"); reloadDb(); }
                            }}>
                              <i className="fa-solid fa-trash" />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                    {openPanelId === cls.id && (
                      <tr>
                        <td colSpan={isAdmin ? 8 : 7} style={{ padding: "0 8px 12px" }}>
                          <ModuleAssignmentPanel classId={cls.id} onClose={() => setOpenPanelId(null)} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
