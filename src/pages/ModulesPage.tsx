import { useApp } from "@/context/AppContext";
import { supabase } from "@/integrations/supabase/client";

export default function ModulesPage() {
  const { db, currentUser, toast, showModal, closeModal, reloadDb } = useApp();
  const isAdmin = currentUser?.role === "admin";

  const showEditModule = (modId: string) => {
    const mod = db.modules.find((m) => m.id === modId);
    if (!mod) return;
    let code = mod.code,
      name = mod.name,
      dept = mod.dept;
    let selectedClasses = [...mod.classes];

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
        <button
          className="btn btn-primary"
          style={{ marginTop: 12 }}
          onClick={async () => {
            if (!name.trim()) {
              toast("Module name is required", "error");
              return;
            }
            const { error: modErr } = await supabase.from("modules").update({ code, name, dept }).eq("id", modId);
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

  const showAddModule = () => {
    let code = "",
      name = "",
      dept = db.departments[0]?.id || "";
    let selectedClasses: string[] = [];

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
        <button
          className="btn btn-primary"
          style={{ marginTop: 12 }}
          onClick={async () => {
            if (!name.trim() || !code.trim()) {
              toast("Code and name are required", "error");
              return;
            }
            const newId = "mod" + Date.now();
            const { error: modErr } = await supabase.from("modules").insert({ id: newId, code, name, dept });
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
                {isAdmin && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {db.modules.map((m) => {
                const dept = db.departments.find((d) => d.id === m.dept);
                const cls = m.classes.map((cid) => db.classes.find((c) => c.id === cid)?.name || cid).join(", ");
                return (
                  <tr key={m.id}>
                    <td style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11 }}>{m.code}</td>
                    <td className="td-name">{m.name}</td>
                    <td>{dept?.name}</td>
                    <td style={{ fontSize: 11 }}>{cls}</td>
                    {isAdmin && (
                      <td>
                        <button className="btn btn-outline btn-sm" onClick={() => showEditModule(m.id)}>
                          <i className="fa-solid fa-pen" /> Edit
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
