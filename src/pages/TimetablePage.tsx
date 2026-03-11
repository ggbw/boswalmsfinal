import { useState } from "react";
import { useApp } from "@/context/AppContext";
import { supabase } from "@/integrations/supabase/client";

export default function TimetablePage() {
  const { db, currentUser, showModal, closeModal, toast, reloadDb } = useApp();
  const role = currentUser?.role;
  const [filterCls, setFilterCls] = useState("");
  const [filterDay, setFilterDay] = useState("");
  const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

  let slots = db.timetable;
  if (filterCls) slots = slots.filter((t) => t.classId === filterCls);
  if (filterDay) slots = slots.filter((t) => t.day === filterDay);

  const handleAddSlot = () => {
    let classId = db.classes[0]?.id || "";
    let day = "Monday",
      time = "08:00 - 09:00";
    let moduleId = db.modules[0]?.id || "";
    let room = "";

    showModal(
      "Add Timetable Slot",
      <div>
        <div className="form-row cols2">
          <div className="form-group">
            <label>Class *</label>
            <select className="form-select" defaultValue={classId} onChange={(e) => (classId = e.target.value)}>
              {db.classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>Day *</label>
            <select className="form-select" defaultValue={day} onChange={(e) => (day = e.target.value)}>
              {days.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="form-row cols2">
          <div className="form-group">
            <label>Time *</label>
            <input
              className="form-input"
              defaultValue={time}
              placeholder="e.g. 08:00 - 09:00"
              onChange={(e) => (time = e.target.value)}
            />
          </div>
          <div className="form-group">
            <label>Room</label>
            <input
              className="form-input"
              defaultValue={room}
              placeholder="Room / Lab"
              onChange={(e) => (room = e.target.value)}
            />
          </div>
        </div>
        <div className="form-group">
          <label>Module *</label>
          <select className="form-select" defaultValue={moduleId} onChange={(e) => (moduleId = e.target.value)}>
            {db.modules.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
        <button
          className="btn btn-primary"
          style={{ marginTop: 12 }}
          onClick={async () => {
            if (!classId || !day || !time || !moduleId) {
              toast("All required fields must be filled", "error");
              return;
            }
            const id = "tt_" + Date.now();
            const { error } = await supabase
              .from("timetable")
              .insert({ id, class_id: classId, day, time, module_id: moduleId, room: room || "" });
            if (error) {
              toast(error.message, "error");
            } else {
              toast("Slot added!", "success");
              closeModal();
              reloadDb();
            }
          }}
        >
          Add Slot
        </button>
      </div>,
    );
  };

  const handleEditSlot = (slot: (typeof slots)[0]) => {
    let classId = slot.classId,
      day = slot.day,
      time = slot.time,
      moduleId = slot.moduleId,
      room = slot.room;
    showModal(
      "Edit Timetable Slot",
      <div>
        <div className="form-row cols2">
          <div className="form-group">
            <label>Class *</label>
            <select className="form-select" defaultValue={classId} onChange={(e) => (classId = e.target.value)}>
              {db.classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>Day *</label>
            <select className="form-select" defaultValue={day} onChange={(e) => (day = e.target.value)}>
              {days.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="form-row cols2">
          <div className="form-group">
            <label>Time *</label>
            <input className="form-input" defaultValue={time} onChange={(e) => (time = e.target.value)} />
          </div>
          <div className="form-group">
            <label>Room</label>
            <input className="form-input" defaultValue={room} onChange={(e) => (room = e.target.value)} />
          </div>
        </div>
        <div className="form-group">
          <label>Module *</label>
          <select className="form-select" defaultValue={moduleId} onChange={(e) => (moduleId = e.target.value)}>
            {db.modules.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button
            className="btn btn-primary"
            onClick={async () => {
              const { error } = await supabase
                .from("timetable")
                .update({ class_id: classId, day, time, module_id: moduleId, room })
                .eq("id", slot.id);
              if (error) {
                toast(error.message, "error");
              } else {
                toast("Slot updated!", "success");
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
              if (!confirm("Delete this timetable slot?")) return;
              const { error } = await supabase.from("timetable").delete().eq("id", slot.id);
              if (error) {
                toast(error.message, "error");
              } else {
                toast("Slot deleted", "success");
                closeModal();
                reloadDb();
              }
            }}
          >
            Delete Slot
          </button>
        </div>
      </div>,
    );
  };

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">
            <i className="fa-solid fa-calendar-days" style={{ color: "var(--accent)", marginRight: 8 }} />
            Timetable
          </div>
          <div className="page-sub">{db.timetable.length} scheduled slot(s)</div>
        </div>
        {role === "admin" && (
          <button className="btn btn-primary btn-sm" onClick={handleAddSlot}>
            <i className="fa-solid fa-plus" /> Add Slot
          </button>
        )}
      </div>
      <div className="card" style={{ marginBottom: 14, padding: "12px 16px" }}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div className="form-group" style={{ marginBottom: 0, minWidth: 160 }}>
            <label style={{ fontSize: 11 }}>Class</label>
            <select className="form-select" value={filterCls} onChange={(e) => setFilterCls(e.target.value)}>
              <option value="">All Classes</option>
              {db.classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group" style={{ marginBottom: 0, minWidth: 140 }}>
            <label style={{ fontSize: 11 }}>Day</label>
            <select className="form-select" value={filterDay} onChange={(e) => setFilterDay(e.target.value)}>
              <option value="">All Days</option>
              {days.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Day</th>
                <th>Time</th>
                <th>Class</th>
                <th>Module</th>
                <th>Lecturer</th>
                <th>Room</th>
                {role === "admin" && <th>Edit</th>}
              </tr>
            </thead>
            <tbody>
              {days.map((day) => {
                if (filterDay && filterDay !== day) return null;
                const daySlots = slots.filter((t) => t.day === day).sort((a, b) => a.time.localeCompare(b.time));
                if (!daySlots.length) return null;
                return daySlots.map((t, i) => {
                  const cls = db.classes.find((c) => c.id === t.classId);
                  const mod = db.modules.find((m) => m.id === t.moduleId);
                  return (
                    <tr key={t.id}>
                      <td style={{ fontWeight: 600, color: "var(--accent)" }}>{i === 0 ? day : ""}</td>
                      <td style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, whiteSpace: "nowrap" }}>
                        {t.time}
                      </td>
                      <td style={{ fontWeight: 600 }}>{cls?.name}</td>
                      <td>{mod?.name}</td>
                      <td style={{ fontSize: 11, color: "var(--text2)" }}>{cls?.lecturer || "—"}</td>
                      <td>
                        <span
                          style={{ background: "var(--surface2)", borderRadius: 4, padding: "2px 8px", fontSize: 11 }}
                        >
                          {t.room}
                        </span>
                      </td>
                      {role === "admin" && (
                        <td>
                          <button className="btn btn-outline btn-sm" onClick={() => handleEditSlot(t)}>
                            <i className="fa-solid fa-pen" />
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                });
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
