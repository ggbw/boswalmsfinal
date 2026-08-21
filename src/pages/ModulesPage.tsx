import { useApp } from "@/context/AppContext";
import { isAdminRole, getScopedModuleIds, getScopedClassIds } from '@/lib/scope';
import { getLecturersForModuleClass } from '@/lib/lecturerHelpers';
import { supabase } from "@/integrations/supabase/client";

export default function ModulesPage() {
  const { db, currentUser, toast, showModal, closeModal, reloadDb } = useApp();
  const role = currentUser?.role;
  const isAdmin = isAdminRole(role);

  // Scope through the shared rule rather than a role check written here.
  //
  // This page previously filtered for HOD and NOBODY ELSE, so every other role
  // reaching it saw all 50 modules. That mattered because the lecturer's
  // "My Modules" menu item pointed at this page, not MyModulesPage.
  //
  // The old HOD lookup was `d.hod === currentUser?.name` — an exact match on a
  // display name. Any difference in spelling, or a rename, silently matched
  // nothing and fell through to showing the whole school.
  // resolveDepartment() exists precisely to fix that: it tries the department's
  // hod field, then falls back to the department on their profile, tolerating
  // profiles.dept holding a NAME while modules.dept holds an ID.
  //
  // null means unrestricted; [] means nothing. Never collapse the two.
  const scopedIds = getScopedModuleIds(db, currentUser);
  const scopedClassIds = getScopedClassIds(db, currentUser);

  // Teaching view: the extra columns are for someone who TEACHES these modules,
  // not someone cataloguing them. An admin sees every class of every module, so
  // co-teachers and student counts would be noise spanning the whole school;
  // a lecturer's are about the two modules in front of them.
  const isTeachingView = scopedClassIds !== null;
  const visibleModules = scopedIds === null
    ? db.modules
    : db.modules.filter((m) => scopedIds.includes(m.id));

  const showEditModule = (modId: string) => {
    const mod = db.modules.find((m) => m.id === modId);
    if (!mod) return;
    let code = mod.code,
      name = mod.name,
      dept = mod.dept;
    let selectedClasses = [...mod.classes];
    let hasPractical = mod.hasPractical !== false;

    showModal(
      "Edit Module",
      <div>
        <div className="form-row cols2">
          <div className="form-group">
            <label>Module Code</label>
            <input className="form-input" defaultValue={code} onChange={(e) => (code = e.target.value)} />
          </div>
          <div className="form-group">
            <label>Module Name</label>
            <input className="form-input" defaultValue={name} onChange={(e) => (name = e.target.value)} />
          </div>
        </div>
        <div className="form-group">
          <label>Department</label>
          <select className="form-input" defaultValue={dept} onChange={(e) => (dept = e.target.value)}>
            {db.departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label>Assigned Classes (hold Ctrl/Cmd to select multiple)</label>
          <select
            className="form-input"
            multiple
            style={{ height: 120 }}
            defaultValue={selectedClasses}
            onChange={(e) => {
              selectedClasses = Array.from(e.target.selectedOptions).map((o) => o.value);
            }}
          >
            {db.classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 400, cursor: "pointer" }}>
            <input type="checkbox" defaultChecked={hasPractical} onChange={(e) => (hasPractical = e.target.checked)} />
            Module has a practical component
          </label>
          <div style={{ fontSize: 11, color: "var(--text2)", marginTop: 4 }}>
            With practical: Coursework 40% + Practical 20% + Final Exam 40%. Without: Coursework 60% + Final Exam 40%.
          </div>
        </div>
        <button
          className="btn btn-primary"
          style={{ marginTop: 12 }}
          onClick={async () => {
            if (!name.trim()) {
              toast("Module name is required", "error");
              return;
            }
            const { error: modErr } = await supabase.from("modules").update({ code, name, dept, has_practical: hasPractical }).eq("id", modId);
            if (modErr) {
              toast(modErr.message, "error");
              return;
            }
            await supabase.from("module_classes").delete().eq("module_id", modId);
            if (selectedClasses.length > 0) {
              const inserts = selectedClasses.map((cid) => ({ module_id: modId, class_id: cid }));
              const { error: mcErr } = await supabase.from("module_classes").insert(inserts);
              if (mcErr) {
                toast(mcErr.message, "error");
                return;
              }
            }
            toast("Module updated successfully!", "success");
            closeModal();
            reloadDb();
          }}
        >
          Save Changes
        </button>
      </div>,
    );
  };

  const deleteModule = async (mod: { id: string; name: string }) => {
    if (!window.confirm(`Delete module "${mod.name}"? This removes its class assignments. Existing marks/exams are kept but will no longer link to a listed module.`)) return;
    // Remove class links first (no FK cascade guaranteed), then the module row.
    await supabase.from("module_classes").delete().eq("module_id", mod.id);
    const { error } = await supabase.from("modules").delete().eq("id", mod.id);
    if (error) {
      toast(error.message, "error");
      return;
    }
    toast("Module deleted", "success");
    reloadDb();
  };

  const showAddModule = () => {
    let code = "",
      name = "",
      dept = db.departments[0]?.id || "";
    let selectedClasses: string[] = [];
    let hasPractical = true;

    showModal(
      "Add New Module",
      <div>
        <div className="form-row cols2">
          <div className="form-group">
            <label>Module Code *</label>
            <input className="form-input" placeholder="e.g. BOSCG-09" onChange={(e) => (code = e.target.value)} />
          </div>
          <div className="form-group">
            <label>Module Name *</label>
            <input className="form-input" placeholder="Module name" onChange={(e) => (name = e.target.value)} />
          </div>
        </div>
        <div className="form-group">
          <label>Department</label>
          <select className="form-input" onChange={(e) => (dept = e.target.value)}>
            {db.departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label>Assigned Classes (hold Ctrl/Cmd to select multiple)</label>
          <select
            className="form-input"
            multiple
            style={{ height: 120 }}
            onChange={(e) => {
              selectedClasses = Array.from(e.target.selectedOptions).map((o) => o.value);
            }}
          >
            {db.classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 400, cursor: "pointer" }}>
            <input type="checkbox" defaultChecked={hasPractical} onChange={(e) => (hasPractical = e.target.checked)} />
            Module has a practical component
          </label>
          <div style={{ fontSize: 11, color: "var(--text2)", marginTop: 4 }}>
            With practical: Coursework 40% + Practical 20% + Final Exam 40%. Without: Coursework 60% + Final Exam 40%.
          </div>
        </div>
        <button
          className="btn btn-primary"
          style={{ marginTop: 12 }}
          onClick={async () => {
            if (!name.trim() || !code.trim()) {
              toast("Code and name are required", "error");
              return;
            }
            const newId = "mod" + Date.now();
            const { error: modErr } = await supabase.from("modules").insert({ id: newId, code, name, dept, has_practical: hasPractical });
            if (modErr) {
              toast(modErr.message, "error");
              return;
            }
            if (selectedClasses.length > 0) {
              const inserts = selectedClasses.map((cid) => ({ module_id: newId, class_id: cid }));
              await supabase.from("module_classes").insert(inserts);
            }
            toast("Module added successfully!", "success");
            closeModal();
            reloadDb();
          }}
        >
          Add Module
        </button>
      </div>,
    );
  };

  return (
    <>
      <div className="page-header">
        <div className="page-title">Modules</div>
        {isAdmin && (
          <button className="btn btn-primary btn-sm" onClick={showAddModule}>
            <i className="fa-solid fa-plus" /> Add Module
          </button>
        )}
      </div>
      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Module Name</th>
                <th>Department</th>
                <th>Classes</th>
                {isTeachingView && <><th>Co-teachers</th><th style={{ textAlign: 'center' }}>Practical</th></>}
                {isAdmin && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {visibleModules.map((m) => {
                const dept = db.departments.find((d) => d.id === m.dept);
                // Scope the classes shown, not just the modules listed. A
                // module is linked to every class taking it, so an unscoped
                // column tells a lecturer teaching ONE class the names of the
                // five others — and reads as though they teach all six.
                const visibleClassIds = scopedClassIds === null
                  ? m.classes
                  : m.classes.filter((cid) => scopedClassIds.includes(cid));
                const cls = visibleClassIds.map((cid) => db.classes.find((c) => c.id === cid)?.name || cid).join(", ");
                return (
                  <tr key={m.id}>
                    <td style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11 }}>{m.code}</td>
                    <td className="td-name">{m.name}</td>
                    <td>{dept?.name}</td>
                    <td style={{ fontSize: 11 }}>{cls}</td>
                    {isTeachingView && (() => {
                      // Everyone else holding this module in the classes THIS
                      // person teaches. Co-teaching is supported, and until now
                      // nothing showed a lecturer they were sharing a module.
                      const coNames = [...new Set(
                        visibleClassIds.flatMap((cid) =>
                          getLecturersForModuleClass(db.lecturerModules, m.id, cid)),
                      )]
                        .filter((lid) => lid !== currentUser?.id)
                        .map((lid) => db.users.find((u) => u.id === lid)?.name)
                        .filter(Boolean);
                      // hasPractical decides the weighting — 40/20/40 with a
                      // practical, 60/40 without — so it changes how this
                      // module's marks are computed. Worth seeing.
                      const practical = m.hasPractical !== false;
                      return (
                        <>
                          <td style={{ fontSize: 11 }}>
                            {coNames.length ? coNames.join(', ')
                              : <span style={{ color: 'var(--text3)' }}>— you only</span>}
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            <span className={`badge ${practical ? 'badge-active' : 'badge-pass'}`}>
                              {practical ? 'Yes' : 'No'}
                            </span>
                          </td>
                        </>
                      );
                    })()}
                    {isAdmin && (
                      <td style={{ display: "flex", gap: 6 }}>
                        <button className="btn btn-outline btn-sm" onClick={() => showEditModule(m.id)}>
                          <i className="fa-solid fa-pen" /> Edit
                        </button>
                        <button
                          className="btn btn-outline btn-sm"
                          style={{ color: "var(--danger)" }}
                          onClick={() => deleteModule(m)}
                        >
                          <i className="fa-solid fa-trash" /> Delete
                        </button>
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
