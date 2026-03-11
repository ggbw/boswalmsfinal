import { useState } from "react";
import { useApp } from "@/context/AppContext";
import { supabase } from "@/integrations/supabase/client";

const ALL_MODULES = [
  "Introduction to Pastry",
  "Food Safety and Hygiene",
  "Introduction to Hot Kitchen/Savory",
  "Cooking Methods, Techniques and Commodities",
  "Hospitality Management",
  "Providing Guest Service",
  "Dietary Management",
  "Cold Food Preparation",
  "Menu Planning and Design",
  "Food Preparation - Sweet Products",
  "Food Preparation - Savory Products",
  "Computer Skills",
  "Accounting Awareness in Culinary Arts",
  "Paste Products",
  "Meat and Seafood Products",
  "Starch Products",
  "Fruit and Vegetable Products",
  "Food Preparation Adv 1 - Sweet Products",
  "Food Preparation Adv 1 - Savory Products",
  "Understanding the Role of Self Development",
  "Contribute to Business Success",
  "Hot and Cold Desserts",
  "Wines and Food",
  "Monitoring and Supervision of Own Section",
  "Molecular Gastronomy",
  "Food Preparation Adv 2 - Sweet Products",
  "Food Preparation Adv 2 - Savory Products",
  "Professional Workplace Standards",
  "Developing Progression in Culinary Arts",
  "URSD",
  "Introduction to Dough",
];

export default function ConfigPage() {
  const { db, toast, showModal, closeModal, reloadDb } = useApp();
  const [activeTab, setActiveTab] = useState<"programmes" | "departments" | "modules" | "mapping">("programmes");

  // ---- PROGRAMMES ----
  const handleAddProgramme = () => {
    let name = "",
      type = "Diploma",
      years = 3,
      semesters = 2,
      startYear = new Date().getFullYear();
    showModal(
      "Add Programme",
      <div>
        <div className="form-group">
          <label>Programme Name *</label>
          <input className="form-input" onChange={(e) => (name = e.target.value)} />
        </div>
        <div className="form-row cols2">
          <div className="form-group">
            <label>Type</label>
            <select className="form-select" defaultValue={type} onChange={(e) => (type = e.target.value)}>
              <option>Diploma</option>
              <option>Certificate</option>
              <option>Degree</option>
            </select>
          </div>
          <div className="form-group">
            <label>Start Year</label>
            <input
              className="form-input"
              type="number"
              defaultValue={startYear}
              onChange={(e) => (startYear = Number(e.target.value))}
            />
          </div>
        </div>
        <div className="form-row cols2">
          <div className="form-group">
            <label>Number of Years</label>
            <input
              className="form-input"
              type="number"
              min={1}
              max={6}
              defaultValue={years}
              onChange={(e) => (years = Number(e.target.value))}
            />
          </div>
          <div className="form-group">
            <label>Semesters per Year</label>
            <input
              className="form-input"
              type="number"
              min={1}
              max={4}
              defaultValue={semesters}
              onChange={(e) => (semesters = Number(e.target.value))}
            />
          </div>
        </div>
        <button
          className="btn btn-primary"
          style={{ marginTop: 12 }}
          onClick={async () => {
            if (!name) {
              toast("Programme name is required", "error");
              return;
            }
            const id = "prog_" + Date.now();
            const { error } = await supabase
              .from("programmes")
              .insert({ id, name, type, years, semesters, start_year: startYear });
            if (error) {
              toast(error.message, "error");
            } else {
              toast("Programme added!", "success");
              closeModal();
              reloadDb();
            }
          }}
        >
          Add Programme
        </button>
      </div>,
    );
  };

  const handleEditProgramme = (prog: any) => {
    let name = prog.name,
      type = prog.type,
      years = prog.years,
      semesters = prog.semesters,
      startYear = prog.startYear;
    showModal(
      "Edit Programme",
      <div>
        <div className="form-group">
          <label>Programme Name *</label>
          <input className="form-input" defaultValue={name} onChange={(e) => (name = e.target.value)} />
        </div>
        <div className="form-row cols2">
          <div className="form-group">
            <label>Type</label>
            <select className="form-select" defaultValue={type} onChange={(e) => (type = e.target.value)}>
              <option>Diploma</option>
              <option>Certificate</option>
              <option>Degree</option>
            </select>
          </div>
          <div className="form-group">
            <label>Start Year</label>
            <input
              className="form-input"
              type="number"
              defaultValue={startYear}
              onChange={(e) => (startYear = Number(e.target.value))}
            />
          </div>
        </div>
        <div className="form-row cols2">
          <div className="form-group">
            <label>Number of Years</label>
            <input
              className="form-input"
              type="number"
              min={1}
              max={6}
              defaultValue={years}
              onChange={(e) => (years = Number(e.target.value))}
            />
          </div>
          <div className="form-group">
            <label>Semesters per Year</label>
            <input
              className="form-input"
              type="number"
              min={1}
              max={4}
              defaultValue={semesters}
              onChange={(e) => (semesters = Number(e.target.value))}
            />
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button
            className="btn btn-primary"
            onClick={async () => {
              const { error } = await supabase
                .from("programmes")
                .update({ name, type, years, semesters, start_year: startYear })
                .eq("id", prog.id);
              if (error) {
                toast(error.message, "error");
              } else {
                toast("Programme updated!", "success");
                closeModal();
                reloadDb();
              }
            }}
          >
            Save Changes
          </button>
          <button
            className="btn btn-outline"
            style={{ color: "var(--danger)" }}
            onClick={async () => {
              if (!confirm("Delete this programme?")) return;
              const { error } = await supabase.from("programmes").delete().eq("id", prog.id);
              if (error) {
                toast(error.message, "error");
              } else {
                toast("Programme deleted", "success");
                closeModal();
                reloadDb();
              }
            }}
          >
            Delete
          </button>
        </div>
      </div>,
    );
  };

  // ---- DEPARTMENTS ----
  const handleAddDept = () => {
    let name = "",
      hod = "";
    showModal(
      "Add Department",
      <div>
        <div className="form-group">
          <label>Department Name *</label>
          <input className="form-input" onChange={(e) => (name = e.target.value)} />
        </div>
        <div className="form-group">
          <label>Head of Department</label>
          <input className="form-input" onChange={(e) => (hod = e.target.value)} />
        </div>
        <button
          className="btn btn-primary"
          style={{ marginTop: 12 }}
          onClick={async () => {
            if (!name) {
              toast("Department name is required", "error");
              return;
            }
            const id = "dept_" + Date.now();
            const { error } = await supabase.from("departments").insert({ id, name, hod: hod || null });
            if (error) {
              toast(error.message, "error");
            } else {
              toast("Department added!", "success");
              closeModal();
              reloadDb();
            }
          }}
        >
          Add Department
        </button>
      </div>,
    );
  };

  const handleEditDept = (dept: any) => {
    let name = dept.name,
      hod = dept.hod || "";
    showModal(
      "Edit Department",
      <div>
        <div className="form-group">
          <label>Department Name *</label>
          <input className="form-input" defaultValue={name} onChange={(e) => (name = e.target.value)} />
        </div>
        <div className="form-group">
          <label>Head of Department</label>
          <input className="form-input" defaultValue={hod} onChange={(e) => (hod = e.target.value)} />
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button
            className="btn btn-primary"
            onClick={async () => {
              const { error } = await supabase
                .from("departments")
                .update({ name, hod: hod || null })
                .eq("id", dept.id);
              if (error) {
                toast(error.message, "error");
              } else {
                toast("Department updated!", "success");
                closeModal();
                reloadDb();
              }
            }}
          >
            Save Changes
          </button>
          <button
            className="btn btn-outline"
            style={{ color: "var(--danger)" }}
            onClick={async () => {
              if (!confirm("Delete this department?")) return;
              const { error } = await supabase.from("departments").delete().eq("id", dept.id);
              if (error) {
                toast(error.message, "error");
              } else {
                toast("Department deleted", "success");
                closeModal();
                reloadDb();
              }
            }}
          >
            Delete
          </button>
        </div>
      </div>,
    );
  };

  // ---- MODULES ----
  const handleAddModule = () => {
    let name = ALL_MODULES[0],
      code = "",
      dept = db.departments[0]?.name || "";
    let customName = "";
    let useCustom = false;
    showModal(
      "Add Module",
      <div>
        <div className="form-group">
          <label>Select from list</label>
          <select
            className="form-select"
            defaultValue={name}
            onChange={(e) => {
              name = e.target.value;
              useCustom = e.target.value === "__custom__";
            }}
          >
            {ALL_MODULES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
            <option value="__custom__">— Enter custom name —</option>
          </select>
        </div>
        <div className="form-group">
          <label>Custom Name (if not in list)</label>
          <input
            className="form-input"
            placeholder="Leave blank to use selection above"
            onChange={(e) => {
              customName = e.target.value;
            }}
          />
        </div>
        <div className="form-row cols2">
          <div className="form-group">
            <label>Module Code *</label>
            <input className="form-input" onChange={(e) => (code = e.target.value)} />
          </div>
          <div className="form-group">
            <label>Department</label>
            <select className="form-select" defaultValue={dept} onChange={(e) => (dept = e.target.value)}>
              {db.departments.map((d) => (
                <option key={d.id} value={d.name}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <button
          className="btn btn-primary"
          style={{ marginTop: 12 }}
          onClick={async () => {
            const finalName = customName.trim() || name;
            if (!finalName || !code) {
              toast("Module name and code are required", "error");
              return;
            }
            const id = "mod_" + Date.now();
            const { error } = await supabase.from("modules").insert({ id, name: finalName, code, dept: dept || null });
            if (error) {
              toast(error.message, "error");
            } else {
              toast("Module added!", "success");
              closeModal();
              reloadDb();
            }
          }}
        >
          Add Module
        </button>
      </div>,
    );
  };

  const handleEditModule = (mod: any) => {
    let name = mod.name,
      code = mod.code,
      dept = mod.dept || "";
    showModal(
      "Edit Module",
      <div>
        <div className="form-group">
          <label>Module Name *</label>
          <input className="form-input" defaultValue={name} onChange={(e) => (name = e.target.value)} />
        </div>
        <div className="form-row cols2">
          <div className="form-group">
            <label>Module Code *</label>
            <input className="form-input" defaultValue={code} onChange={(e) => (code = e.target.value)} />
          </div>
          <div className="form-group">
            <label>Department</label>
            <select className="form-select" defaultValue={dept} onChange={(e) => (dept = e.target.value)}>
              <option value="">— None —</option>
              {db.departments.map((d) => (
                <option key={d.id} value={d.name}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button
            className="btn btn-primary"
            onClick={async () => {
              if (!name || !code) {
                toast("Name and code are required", "error");
                return;
              }
              const { error } = await supabase
                .from("modules")
                .update({ name, code, dept: dept || null })
                .eq("id", mod.id);
              if (error) {
                toast(error.message, "error");
              } else {
                toast("Module updated!", "success");
                closeModal();
                reloadDb();
              }
            }}
          >
            Save Changes
          </button>
          <button
            className="btn btn-outline"
            style={{ color: "var(--danger)" }}
            onClick={async () => {
              if (!confirm("Delete this module? This will remove all class mappings.")) return;
              await supabase.from("module_classes").delete().eq("module_id", mod.id);
              const { error } = await supabase.from("modules").delete().eq("id", mod.id);
              if (error) {
                toast(error.message, "error");
              } else {
                toast("Module deleted", "success");
                closeModal();
                reloadDb();
              }
            }}
          >
            Delete
          </button>
        </div>
      </div>,
    );
  };

  // ---- MODULE-PROGRAMME MAPPING ----
  const handleMapModules = (prog: any) => {
    // Build year/semester structure
    const totalSemesters = prog.years * prog.semesters;
    // For each year/sem combo, track which modules are assigned
    type SlotKey = string; // "year_sem"
    const mappingState: Record<SlotKey, Set<string>> = {};
    for (let y = 1; y <= prog.years; y++) {
      for (let s = 1; s <= prog.semesters; s++) {
        mappingState[`${y}_${s}`] = new Set();
      }
    }

    // Pre-populate from existing programme_modules table if available
    // For now show all modules selectable per year/semester

    showModal(
      `Module Mapping — ${prog.name}`,
      <ProgrammeModuleMapper prog={prog} db={db} toast={toast} closeModal={closeModal} reloadDb={reloadDb} />,
      "large",
    );
  };

  return (
    <>
      <div className="page-header">
        <div className="page-title">System Configuration</div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 16 }}>
        {(["programmes", "departments", "modules", "mapping"] as const).map((tab) => (
          <button
            key={tab}
            className={`btn ${activeTab === tab ? "btn-primary" : "btn-outline"} btn-sm`}
            onClick={() => setActiveTab(tab)}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {/* Programmes Tab */}
      {activeTab === "programmes" && (
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div className="card-title" style={{ margin: 0 }}>
              <i className="fa-solid fa-graduation-cap" /> Programmes
            </div>
            <button className="btn btn-primary btn-sm" onClick={handleAddProgramme}>
              <i className="fa-solid fa-plus" /> Add Programme
            </button>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Programme Name</th>
                  <th>Type</th>
                  <th>Years</th>
                  <th>Semesters/Year</th>
                  <th>Start Year</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {db.config.programmes.map((p) => (
                  <tr key={p.id}>
                    <td className="td-name">{p.name}</td>
                    <td>
                      <span className="badge badge-pass">{p.type}</span>
                    </td>
                    <td>{p.years} yr</td>
                    <td>{p.semesters} sem</td>
                    <td style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11 }}>{p.startYear}</td>
                    <td>
                      <button className="btn btn-outline btn-sm" onClick={() => handleEditProgramme(p)}>
                        <i className="fa-solid fa-pen" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Departments Tab */}
      {activeTab === "departments" && (
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div className="card-title" style={{ margin: 0 }}>
              🏢 Departments
            </div>
            <button className="btn btn-primary btn-sm" onClick={handleAddDept}>
              <i className="fa-solid fa-plus" /> Add Department
            </button>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Department Name</th>
                  <th>Head of Department</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {db.departments.map((d) => (
                  <tr key={d.id}>
                    <td className="td-name">{d.name}</td>
                    <td>{d.hod || "—"}</td>
                    <td>
                      <button className="btn btn-outline btn-sm" onClick={() => handleEditDept(d)}>
                        <i className="fa-solid fa-pen" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modules Tab */}
      {activeTab === "modules" && (
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div className="card-title" style={{ margin: 0 }}>
              <i className="fa-solid fa-book-open" /> Modules
            </div>
            <button className="btn btn-primary btn-sm" onClick={handleAddModule}>
              <i className="fa-solid fa-plus" /> Add Module
            </button>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Module Name</th>
                  <th>Department</th>
                  <th>Classes</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {db.modules.map((m) => (
                  <tr key={m.id}>
                    <td style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11 }}>{m.code}</td>
                    <td className="td-name">{m.name}</td>
                    <td>{m.dept || "—"}</td>
                    <td>
                      <span className="badge badge-pending">{m.classes.length}</span>
                    </td>
                    <td>
                      <button className="btn btn-outline btn-sm" onClick={() => handleEditModule(m)}>
                        <i className="fa-solid fa-pen" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Module-Programme Mapping Tab */}
      {activeTab === "mapping" && (
        <div className="card">
          <div className="card-title">
            <i className="fa-solid fa-diagram-project" /> Module to Programme Mapping
          </div>
          <p style={{ fontSize: 12, color: "var(--text2)", marginBottom: 16 }}>
            Select a programme to map modules to specific years and semesters.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))", gap: 12 }}>
            {db.config.programmes.map((p) => (
              <div
                key={p.id}
                className="card"
                style={{ padding: 14, cursor: "pointer" }}
                onClick={() => handleMapModules(p)}
              >
                <div style={{ fontWeight: 700, marginBottom: 4 }}>{p.name}</div>
                <div style={{ fontSize: 11, color: "var(--text2)" }}>
                  {p.type} · {p.years} years · {p.semesters} sem/yr
                </div>
                <button
                  className="btn btn-primary btn-sm"
                  style={{ marginTop: 10 }}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleMapModules(p);
                  }}
                >
                  <i className="fa-solid fa-diagram-project" /> Map Modules
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Academic Year Settings */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-title">
          <span>
            <i className="fa-solid fa-gear" /> Academic Year Settings
          </span>
        </div>
        <div className="info-row">
          <span className="info-label">Current Year</span>
          <span className="info-val">{db.config.currentYear}</span>
        </div>
        <div className="info-row">
          <span className="info-label">Active Semester</span>
          <span className="info-val">Semester {db.config.currentSemester}</span>
        </div>
      </div>
    </>
  );
}

// Separate component for the programme module mapper (needs state)
function ProgrammeModuleMapper({ prog, db, toast, closeModal, reloadDb }: any) {
  // Build slot keys
  const slots: { year: number; sem: number }[] = [];
  for (let y = 1; y <= prog.years; y++) {
    for (let s = 1; s <= prog.semesters; s++) {
      slots.push({ year: y, sem: s });
    }
  }

  const [selectedSlot, setSelectedSlot] = useState<{ year: number; sem: number }>(slots[0]);
  const [moduleSelections, setModuleSelections] = useState<Record<string, Set<string>>>(() => {
    const init: Record<string, Set<string>> = {};
    slots.forEach((sl) => {
      init[`${sl.year}_${sl.sem}`] = new Set();
    });
    return init;
  });

  const slotKey = `${selectedSlot.year}_${selectedSlot.sem}`;
  const selected = moduleSelections[slotKey] || new Set<string>();

  const toggleModule = (moduleId: string) => {
    setModuleSelections((prev) => {
      const updated = new Set(prev[slotKey]);
      if (updated.has(moduleId)) updated.delete(moduleId);
      else updated.add(moduleId);
      return { ...prev, [slotKey]: updated };
    });
  };

  const handleSave = async () => {
    // For each slot, upsert module_classes entries
    // We use a convention: map to any class in that programme/year/semester
    const classes = db.classes.filter((c: any) => c.programme === prog.id);
    let saved = 0;
    for (const sl of slots) {
      const key = `${sl.year}_${sl.sem}`;
      const mods = Array.from(moduleSelections[key] as Set<string>);
      const slotClasses = classes.filter((c: any) => c.year === sl.year && c.semester === sl.sem);
      for (const modId of mods) {
        for (const cls of slotClasses) {
          const { error } = await supabase
            .from("module_classes")
            .upsert({ module_id: modId, class_id: cls.id }, { onConflict: "module_id,class_id" });
          if (!error) saved++;
        }
      }
    }
    toast(`Mapping saved! ${saved} association(s) created.`, "success");
    closeModal();
    reloadDb();
  };

  return (
    <div>
      <div style={{ marginBottom: 12, fontSize: 12, color: "var(--text2)" }}>
        Select a year/semester, then tick the modules for that period.
      </div>
      {/* Year/Semester selector */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
        {slots.map((sl) => (
          <button
            key={`${sl.year}_${sl.sem}`}
            className={`btn btn-sm ${selectedSlot.year === sl.year && selectedSlot.sem === sl.sem ? "btn-primary" : "btn-outline"}`}
            onClick={() => setSelectedSlot(sl)}
          >
            Year {sl.year} · Sem {sl.sem}
            {(moduleSelections[`${sl.year}_${sl.sem}`]?.size || 0) > 0 && (
              <span
                style={{
                  marginLeft: 4,
                  background: "var(--accent)",
                  color: "#fff",
                  borderRadius: 10,
                  padding: "0 5px",
                  fontSize: 9,
                }}
              >
                {moduleSelections[`${sl.year}_${sl.sem}`]?.size}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Module checklist */}
      <div style={{ maxHeight: 340, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 6 }}>
        {db.modules.map((mod: any) => (
          <label
            key={mod.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "8px 12px",
              cursor: "pointer",
              borderBottom: "1px solid var(--border)",
              fontSize: 13,
            }}
          >
            <input type="checkbox" checked={selected.has(mod.id)} onChange={() => toggleModule(mod.id)} />
            <span
              style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, color: "var(--text2)", minWidth: 60 }}
            >
              {mod.code}
            </span>
            {mod.name}
          </label>
        ))}
      </div>
      <div style={{ marginTop: 14, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 12, color: "var(--text2)" }}>
          {Array.from(Object.values(moduleSelections)).reduce((a: number, s: any) => a + s.size, 0)} total module
          assignments
        </div>
        <button className="btn btn-primary" onClick={handleSave}>
          <i className="fa-solid fa-floppy-disk" /> Save Mapping
        </button>
      </div>
    </div>
  );
}
