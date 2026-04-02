import { useState } from "react";
import { useApp } from "@/context/AppContext";
import { supabase } from "@/integrations/supabase/client";

// Sync module_classes for a class based on its programme + year + semester
async function syncModulesForClass(classId: string, programmeId: string, year: number, semester: number) {
  // Get modules mapped to this programme/year/semester from programme_modules
  const { data: pmRows } = await supabase
    .from("programme_modules" as any)
    .select("module_id")
    .eq("programme_id", programmeId)
    .eq("year", year)
    .eq("semester", semester);

  // Remove old module_classes for this class
  await supabase.from("module_classes").delete().eq("class_id", classId);

  // Insert new ones
  const moduleIds = (pmRows || []).map((r: any) => r.module_id);
  if (moduleIds.length > 0) {
    await supabase.from("module_classes").insert(
      moduleIds.map((modId: string) => ({ module_id: modId, class_id: classId }))
    );
  }
}

export default function ClassesPage() {
  const { db, currentUser, toast, showModal, closeModal, reloadDb } = useApp();
  const isAdmin = currentUser?.role === "admin";
  const [syncing, setSyncing] = useState(false);

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
      lecturer = cls.lecturer,
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
        <div className="form-group">
          <label>Lecturer</label>
          <input className="form-input" defaultValue={lecturer} onChange={(e) => (lecturer = e.target.value)} />
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
              .update({
                name,
                programme,
                year,
                semester,
                cal_year: calYear,
                lecturer,
                division,
              })
              .eq("id", clsId);
            if (error) {
              toast(error.message, "error");
              return;
            }
            // If programme/year/semester changed, update students and re-sync modules
            if (programme !== cls.programme) {
              await supabase.from("students").update({ programme }).eq("class_id", clsId);
            }
            // Always re-sync modules from programme_modules
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
      lecturer = "",
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
        <div className="form-group">
          <label>Class Lecturer</label>
          <input
            className="form-input"
            placeholder="Lecturer full name"
            onChange={(e) => (lecturer = e.target.value)}
          />
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
              lecturer,
              division,
            });
            if (error) {
              toast(error.message, "error");
              return;
            }
            // Auto-assign modules from programme_modules for this programme/year/semester
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
                <th>Lecturer</th>
                <th>Students</th>
                <th>Status</th>
                {isAdmin && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {db.classes.map((cls) => {
                const prog = db.config.programmes.find((p) => p.id === cls.programme);
                const studCount = db.students.filter((s) => s.classId === cls.id).length;
                return (
                  <tr key={cls.id}>
                    <td className="td-name">{cls.name}</td>
                    <td>{prog?.type}</td>
                    <td>
                      Year {cls.year} · Sem {cls.semester}
                    </td>
                    <td>{cls.calYear}</td>
                    <td>{cls.lecturer}</td>
                    <td style={{ fontFamily: "'JetBrains Mono',monospace" }}>{studCount}</td>
                    <td>
                      <span className="badge badge-active">Active</span>
                    </td>
                    {isAdmin && (
                      <td>
                        <div style={{ display: "flex", gap: 4 }}>
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
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
