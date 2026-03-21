import { useState, useEffect, useCallback } from "react";
import { useApp } from "@/context/AppContext";
import { supabase } from "@/integrations/supabase/client";

interface FacultyRow {
  user_id: string;
  name: string;
  email: string;
  role: string;
  dept: string;
  code: string;
}

export default function LecturersPage() {
  const { db, toast, showModal, closeModal, currentUser } = useApp();
  const [faculty, setFaculty] = useState<FacultyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<FacultyRow | null>(null);
  const isAdmin = currentUser?.role === "admin";

  const load = useCallback(async () => {
    setLoading(true);
    const { data: profiles } = await supabase.from("profiles").select("*");
    const { data: roles } = await supabase.from("user_roles").select("*");
    const roleMap: Record<string, string> = {};
    (roles || []).forEach((r: any) => {
      roleMap[r.user_id] = r.role;
    });
    const mapped = (profiles || [])
      .filter((p: any) => ["lecturer", "hod", "hoy"].includes(roleMap[p.user_id]))
      .map((p: any) => ({
        user_id: p.user_id,
        name: p.name,
        email: p.email || "",
        role: roleMap[p.user_id] || "lecturer",
        dept: p.dept || "",
        code: p.code || "",
      }));
    setFaculty(mapped);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = faculty;

  const handleEdit = (f: FacultyRow) => {
    let name = f.name,
      email = f.email,
      dept = f.dept,
      code = f.code,
      role = f.role;
    showModal(
      "Edit Lecturer — " + f.name,
      <div>
        <div style={{ marginBottom: 20 }}>
          <div
            style={{
              fontWeight: 700,
              fontSize: 12,
              color: "#002060",
              borderBottom: "2px solid #C9A227",
              paddingBottom: 4,
              marginBottom: 12,
            }}
          >
            Account Details
          </div>
          <div className="form-row cols2">
            <div className="form-group">
              <label>Full Name *</label>
              <input className="form-input" defaultValue={name} onChange={(e) => (name = e.target.value)} />
            </div>
            <div className="form-group">
              <label>Email</label>
              <input
                className="form-input"
                type="email"
                defaultValue={email}
                onChange={(e) => (email = e.target.value)}
              />
            </div>
          </div>
          <div className="form-row cols2">
            <div className="form-group">
              <label>Role</label>
              <select className="form-select" defaultValue={role} onChange={(e) => (role = e.target.value)}>
                <option value="lecturer">Lecturer</option>
                <option value="hod">HOD</option>
                <option value="hoy">HOY</option>
              </select>
            </div>
            <div className="form-group">
              <label>Staff Code</label>
              <input
                className="form-input"
                defaultValue={code}
                placeholder="e.g. LEC001"
                onChange={(e) => (code = e.target.value)}
              />
            </div>
          </div>
        </div>
        <div style={{ marginBottom: 20 }}>
          <div
            style={{
              fontWeight: 700,
              fontSize: 12,
              color: "#002060",
              borderBottom: "2px solid #C9A227",
              paddingBottom: 4,
              marginBottom: 12,
            }}
          >
            Department
          </div>
          <div className="form-group">
            <label>Department</label>
            <select className="form-select" defaultValue={dept} onChange={(e) => (dept = e.target.value)}>
              <option value="">— Select —</option>
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
          style={{ width: "100%" }}
          onClick={async () => {
            if (!name.trim()) {
              toast("Name is required", "error");
              return;
            }
            const { error: profErr } = await supabase
              .from("profiles")
              .update({ name, email, dept, code })
              .eq("user_id", f.user_id);
            if (profErr) {
              toast(profErr.message, "error");
              return;
            }
            if (role !== f.role) {
              const { error: roleErr } = await supabase
                .from("user_roles")
                .update({ role: role as any })
                .eq("user_id", f.user_id);
              if (roleErr) {
                toast(roleErr.message, "error");
                return;
              }
            }
            toast("Lecturer updated!", "success");
            closeModal();
            // Update local state immediately
            setFaculty((prev) =>
              prev.map((x) => (x.user_id === f.user_id ? { ...x, name, email, dept, code, role } : x)),
            );
            if (selected?.user_id === f.user_id) setSelected({ ...f, name, email, dept, code, role });
          }}
        >
          Save Changes
        </button>
      </div>,
    );
  };

  const handleDelete = (f: FacultyRow) => {
    showModal(
      "Delete Lecturer",
      <div>
        <p style={{ marginBottom: 16 }}>
          Are you sure you want to delete <strong>{f.name}</strong>? This cannot be undone.
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            className="btn btn-danger"
            style={{ flex: 1 }}
            onClick={async () => {
              await supabase.from("user_roles").delete().eq("user_id", f.user_id);
              await supabase.from("profiles").delete().eq("user_id", f.user_id);
              toast(`${f.name} deleted`, "success");
              closeModal();
              setFaculty((prev) => prev.filter((x) => x.user_id !== f.user_id));
              if (selected?.user_id === f.user_id) setSelected(null);
            }}
          >
            Delete
          </button>
          <button className="btn btn-outline" style={{ flex: 1 }} onClick={closeModal}>
            Cancel
          </button>
        </div>
      </div>,
    );
  };

  const handleCreate = () => {
    let name = "", email = "", role = "lecturer", dept = "", code = "";
    showModal(
      "Add New Lecturer",
      <div>
        <div className="form-row cols2">
          <div className="form-group">
            <label>Full Name *</label>
            <input className="form-input" onChange={(e) => (name = e.target.value)} />
          </div>
          <div className="form-group">
            <label>Email *</label>
            <input className="form-input" type="email" onChange={(e) => (email = e.target.value)} />
          </div>
        </div>
        <div className="form-row cols2">
          <div className="form-group">
            <label>Role</label>
            <select className="form-select" defaultValue="lecturer" onChange={(e) => (role = e.target.value)}>
              <option value="lecturer">Lecturer</option>
              <option value="hod">HOD</option>
              <option value="hoy">HOY</option>
            </select>
          </div>
          <div className="form-group">
            <label>Staff Code</label>
            <input className="form-input" placeholder="e.g. LEC001" onChange={(e) => (code = e.target.value)} />
          </div>
        </div>
        <div className="form-group">
          <label>Department</label>
          <select className="form-select" defaultValue="" onChange={(e) => (dept = e.target.value)}>
            <option value="">— Select —</option>
            {db.departments.map((d) => (
              <option key={d.id} value={d.name}>{d.name}</option>
            ))}
          </select>
        </div>
        <button
          className="btn btn-primary"
          style={{ width: "100%", marginTop: 8 }}
          onClick={async () => {
            if (!name.trim() || !email.trim()) {
              toast("Name and email are required", "error");
              return;
            }
            const { data: authData, error: authErr } = await supabase.auth.admin.createUser({
              email: email.trim(),
              password: "Boswa@2024",
              email_confirm: true,
            });
            if (authErr || !authData?.user) {
              toast(authErr?.message || "Failed to create account", "error");
              return;
            }
            const user_id = authData.user.id;
            await supabase.from("profiles").insert({ user_id, name: name.trim(), email: email.trim(), dept, code });
            await supabase.from("user_roles").insert({ user_id, role: role as any });
            toast("Lecturer created!", "success");
            closeModal();
            load();
          }}
        >
          Create Lecturer
        </button>
      </div>,
    );
  };

  const roleBadge = (r: string) => {
    const colors: Record<string, string> = { hod: "badge-fail", hoy: "badge-pass", lecturer: "badge-active" };
    return <span className={`badge ${colors[r] || "badge-pass"}`}>{r.toUpperCase()}</span>;
  };

  return (
    <div style={{ display: "flex", gap: 16, height: "calc(100vh - 120px)", overflow: "hidden" }}>
      {/* ── LEFT: Table ── */}
      <div
        style={{
          flex: selected ? "0 0 520px" : "1",
          display: "flex",
          flexDirection: "column",
          gap: 12,
          overflow: "hidden",
        }}
      >
        <div className="page-header" style={{ margin: 0, padding: 0 }}>
          <div>
            <div className="page-title">Faculty / Lecturers</div>
            <div className="page-sub">{filtered.length} staff members</div>
          </div>
          {isAdmin && (
            <button className="btn btn-primary btn-sm" onClick={handleCreate}>
              <i className="fa-solid fa-plus" /> Add Lecturer
            </button>
          )}
        </div>

        <div style={{ flex: 1, overflowY: "auto" }}>
          <div className="card" style={{ padding: 0 }}>
            {loading ? (
              <div style={{ padding: 40, textAlign: "center", color: "var(--text2)" }}>Loading…</div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Role</th>
                      <th>Department</th>
                      <th>Email</th>
                      <th>Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((f) => (
                      <tr
                        key={f.user_id}
                        style={{ background: selected?.user_id === f.user_id ? "var(--bg2)" : undefined }}
                      >
                        <td className="td-name">
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <div
                              className="avatar"
                              style={{ background: "#c8860a", width: 28, height: 28, fontSize: 11 }}
                            >
                              {f.name[0]}
                            </div>
                            {f.name}
                          </div>
                        </td>
                        <td>{roleBadge(f.role)}</td>
                        <td>{f.dept || "—"}</td>
                        <td style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11 }}>{f.email}</td>
                        <td>
                          <span className="badge badge-active">Active</span>
                        </td>
                        <td>
                          <div style={{ display: "flex", gap: 4 }}>
                            <button className="btn btn-outline btn-sm" onClick={() => setSelected(f)}>
                              View
                            </button>
                            {isAdmin && (
                              <>
                                <button className="btn btn-outline btn-sm" onClick={() => handleEdit(f)}>
                                  Edit
                                </button>
                                <button className="btn btn-danger btn-sm" onClick={() => handleDelete(f)}>
                                  Delete
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── RIGHT: Detail panel ── */}
      {selected && (
        <div
          style={{
            flex: 1,
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            overflow: "auto",
            padding: 24,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
            <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
              <div className="avatar" style={{ background: "#c8860a", width: 52, height: 52, fontSize: 20 }}>
                {selected.name[0]}
              </div>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{selected.name}</div>
                <div style={{ fontSize: 12, color: "var(--text2)", marginTop: 2 }}>{selected.email}</div>
                <div style={{ marginTop: 4 }}>{roleBadge(selected.role)}</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {isAdmin && (
                <button className="btn btn-outline btn-sm" onClick={() => handleEdit(selected)}>
                  <i className="fa-solid fa-pen" /> Edit
                </button>
              )}
              <button
                style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "var(--text2)" }}
                onClick={() => setSelected(null)}
              >
                ×
              </button>
            </div>
          </div>

          <PanelSection title="Staff Details">
            <PRow label="Full Name" value={selected.name} />
            <PRow label="Email" value={selected.email || "—"} />
            <PRow label="Staff Code" value={selected.code || "—"} />
            <PRow label="Role" value={selected.role.toUpperCase()} />
            <PRow label="Department" value={selected.dept || "—"} />
          </PanelSection>

          {/* Assigned modules */}
          <AssignedModules lecturerName={selected.name} />
        </div>
      )}
    </div>
  );
}

function AssignedModules({ lecturerName }: { lecturerName: string }) {
  const { db } = useApp();
  const assignedClasses = db.classes.filter((c: any) => c.lecturer === lecturerName);
  if (assignedClasses.length === 0) return null;

  return (
    <PanelSection title="Assigned Classes">
      {assignedClasses.map((c: any) => {
        const prog = db.config.programmes.find((p: any) => p.id === c.programme);
        return (
          <div
            key={c.id}
            style={{ gridColumn: "1/-1", background: "var(--bg2)", borderRadius: 6, padding: "8px 12px", fontSize: 13 }}
          >
            <div style={{ fontWeight: 600 }}>{c.name}</div>
            <div style={{ color: "var(--text2)", fontSize: 11, marginTop: 2 }}>
              {prog?.name || "—"} · Year {c.year} · Sem {c.semester}
            </div>
          </div>
        );
      })}
    </PanelSection>
  );
}

function PanelSection({ title, children }: any) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div
        style={{
          fontWeight: 700,
          fontSize: 11,
          color: "var(--text2)",
          textTransform: "uppercase",
          letterSpacing: 0.5,
          borderBottom: "1px solid var(--border)",
          paddingBottom: 4,
          marginBottom: 10,
        }}
      >
        {title}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 16px" }}>{children}</div>
    </div>
  );
}
function PRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ fontSize: 13 }}>
      <div style={{ color: "var(--text2)", fontSize: 11 }}>{label}</div>
      <div style={{ fontWeight: 500, marginTop: 1 }}>{value}</div>
    </div>
  );
}
