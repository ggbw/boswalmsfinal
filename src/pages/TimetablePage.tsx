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

  // Check if a room is already booked at the given day+time (excluding a specific slot id)
  const checkRoomConflict = (roomName: string, day: string, time: string, excludeId?: string): string | null => {
    if (!roomName) return null;
    const conflict = db.timetable.find(
      (t) => t.room === roomName && t.day === day && t.time === time && t.id !== excludeId,
    );
    if (conflict) {
      const conflictCls = db.classes.find((c) => c.id === conflict.classId);
      return `"${roomName}" is already booked on ${day} at ${time} for ${conflictCls?.name || "another class"}.`;
    }
    return null;
  };

  const handleAddSlot = () => {
    let classId = db.classes[0]?.id || "";
    let day = "Monday",
      time = "08:00-10:00";
    let moduleId = db.modules[0]?.id || "";
    let roomName = "";

    showModal(
      "Add Timetable Slot",
      <TimetableForm
        db={db}
        days={days}
        initialValues={{ classId, day, time, moduleId, roomName }}
        onChange={(v) => {
          classId = v.classId;
          day = v.day;
          time = v.time;
          moduleId = v.moduleId;
          roomName = v.roomName;
        }}
        onSubmit={async () => {
          if (!classId || !day || !time || !moduleId) {
            toast("All required fields must be filled", "error");
            return;
          }
          const conflict = checkRoomConflict(roomName, day, time);
          if (conflict) {
            toast(`⚠️ Double booking: ${conflict}`, "error");
            return;
          }
          const id = "tt_" + Date.now();
          const { error } = await supabase
            .from("timetable")
            .insert({ id, class_id: classId, day, time, module_id: moduleId, room: roomName || "" });
          if (error) {
            toast(error.message, "error");
          } else {
            toast("Slot added!", "success");
            closeModal();
            reloadDb();
          }
        }}
        submitLabel="Add Slot"
      />,
    );
  };

  const handleEditSlot = (slot: (typeof slots)[0]) => {
    let classId = slot.classId,
      day = slot.day,
      time = slot.time,
      moduleId = slot.moduleId,
      roomName = slot.room;

    showModal(
      "Edit Timetable Slot",
      <TimetableForm
        db={db}
        days={days}
        initialValues={{ classId, day, time, moduleId, roomName }}
        onChange={(v) => {
          classId = v.classId;
          day = v.day;
          time = v.time;
          moduleId = v.moduleId;
          roomName = v.roomName;
        }}
        onSubmit={async () => {
          const conflict = checkRoomConflict(roomName, day, time, slot.id);
          if (conflict) {
            toast(`⚠️ Double booking: ${conflict}`, "error");
            return;
          }
          const { error } = await supabase
            .from("timetable")
            .update({ class_id: classId, day, time, module_id: moduleId, room: roomName })
            .eq("id", slot.id);
          if (error) {
            toast(error.message, "error");
          } else {
            toast("Slot updated!", "success");
            closeModal();
            reloadDb();
          }
        }}
        submitLabel="Save Changes"
        onDelete={async () => {
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
      />,
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
                        {t.room ? (
                          <span
                            style={{ background: "var(--surface2)", borderRadius: 4, padding: "2px 8px", fontSize: 11 }}
                          >
                            <i
                              className="fa-solid fa-door-open"
                              style={{ marginRight: 4, fontSize: 9, opacity: 0.7 }}
                            />
                            {t.room}
                          </span>
                        ) : (
                          <span style={{ color: "var(--text2)", fontSize: 11 }}>—</span>
                        )}
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

// ── Shared form component (used for both Add and Edit) ───────────────────────
function TimetableForm({
  db,
  days,
  initialValues,
  onChange,
  onSubmit,
  submitLabel,
  onDelete,
}: {
  db: any;
  days: string[];
  initialValues: { classId: string; day: string; time: string; moduleId: string; roomName: string };
  onChange: (v: { classId: string; day: string; time: string; moduleId: string; roomName: string }) => void;
  onSubmit: () => void;
  submitLabel: string;
  onDelete?: () => void;
}) {
  const [vals, setVals] = useState(initialValues);
  const [roomConflict, setRoomConflict] = useState<string | null>(null);

  const update = (patch: Partial<typeof vals>) => {
    const next = { ...vals, ...patch };
    setVals(next);
    onChange(next);

    // Live conflict check
    if (next.roomName && next.day && next.time) {
      const conflict = db.timetable.find(
        (t: any) =>
          t.room === next.roomName && t.day === next.day && t.time === next.time && t.id !== (initialValues as any).id,
      );
      if (conflict) {
        const cls = db.classes.find((c: any) => c.id === conflict.classId);
        setRoomConflict(`"${next.roomName}" is already booked at this time for ${cls?.name || "another class"}.`);
      } else {
        setRoomConflict(null);
      }
    } else {
      setRoomConflict(null);
    }
  };

  const rooms: any[] = db.rooms || [];

  return (
    <div>
      <div className="form-row cols2">
        <div className="form-group">
          <label>Class *</label>
          <select className="form-select" value={vals.classId} onChange={(e) => update({ classId: e.target.value })}>
            {db.classes.map((c: any) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label>Day *</label>
          <select className="form-select" value={vals.day} onChange={(e) => update({ day: e.target.value })}>
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
            value={vals.time}
            placeholder="e.g. 08:00-10:00"
            onChange={(e) => update({ time: e.target.value })}
          />
        </div>
        <div className="form-group">
          <label>Room</label>
          {rooms.length > 0 ? (
            <select
              className="form-select"
              value={vals.roomName}
              onChange={(e) => update({ roomName: e.target.value })}
            >
              <option value="">— No Room —</option>
              {rooms.map((r: any) => (
                <option key={r.id} value={r.name}>
                  {r.name} ({r.type}
                  {r.capacity > 0 ? `, cap. ${r.capacity}` : ""})
                </option>
              ))}
            </select>
          ) : (
            <input
              className="form-input"
              value={vals.roomName}
              placeholder="Room / Lab"
              onChange={(e) => update({ roomName: e.target.value })}
            />
          )}
        </div>
      </div>

      {/* Double-booking warning */}
      {roomConflict && (
        <div
          style={{
            background: "rgba(220,38,38,0.12)",
            border: "1px solid rgba(220,38,38,0.4)",
            borderRadius: 6,
            padding: "8px 12px",
            marginBottom: 10,
            fontSize: 12,
            color: "#f87171",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <i className="fa-solid fa-triangle-exclamation" />
          <span>
            <strong>Double booking:</strong> {roomConflict}
          </span>
        </div>
      )}

      <div className="form-group">
        <label>Module *</label>
        <select className="form-select" value={vals.moduleId} onChange={(e) => update({ moduleId: e.target.value })}>
          {db.modules.map((m: any) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button className="btn btn-primary" onClick={onSubmit} disabled={!!roomConflict}>
          {submitLabel}
        </button>
        {onDelete && (
          <button className="btn btn-outline" style={{ color: "var(--danger)" }} onClick={onDelete}>
            Delete Slot
          </button>
        )}
      </div>
    </div>
  );
}
