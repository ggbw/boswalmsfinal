import { useState } from "react";
import { useApp } from "@/context/AppContext";
import { supabase } from "@/integrations/supabase/client";

// Minimal XLSX builder — no external dependency needed
function buildXlsx(sheets: { name: string; rows: (string | number)[][] }[]): Blob {
  // We generate a proper .xlsx using the SpreadsheetML XML format packaged as a zip.
  // Using a simple approach: generate as a multi-sheet workbook via data URL trick with
  // the SYLK/HTML table approach is unreliable. Instead we'll use the well-supported
  // approach of building an XML-based xlsx manually.

  // Helper: escape XML special chars
  const esc = (v: string) =>
    String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  // Convert a column index (0-based) to Excel column letters
  const col = (n: number): string => {
    let s = "";
    n++;
    while (n > 0) {
      const r = (n - 1) % 26;
      s = String.fromCharCode(65 + r) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  };

  // Build shared strings table
  const strings: string[] = [];
  const strIdx: Record<string, number> = {};
  const si = (v: string) => {
    if (!(v in strIdx)) {
      strIdx[v] = strings.length;
      strings.push(v);
    }
    return strIdx[v];
  };

  // Pre-collect all strings
  sheets.forEach((sh) =>
    sh.rows.forEach((row) =>
      row.forEach((cell) => {
        if (typeof cell === "string") si(cell);
      }),
    ),
  );

  // Build sheet XMLs
  const sheetXmls = sheets.map((sh) => {
    const rowsXml = sh.rows
      .map((row, ri) => {
        const cells = row
          .map((cell, ci) => {
            const cellRef = `${col(ci)}${ri + 1}`;
            if (typeof cell === "number") {
              return `<c r="${cellRef}"><v>${cell}</v></c>`;
            }
            const idx = si(String(cell));
            return `<c r="${cellRef}" t="s"><v>${idx}</v></c>`;
          })
          .join("");
        return `<row r="${ri + 1}">${cells}</row>`;
      })
      .join("");
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetData>${rowsXml}</sheetData>
</worksheet>`;
  });

  const ssXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">
${strings.map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join("")}
</sst>`;

  const wbXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>
${sheets.map((sh, i) => `<sheet name="${esc(sh.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}
</sheets>
</workbook>`;

  const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}
<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
</Relationships>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}
<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
</Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  // Pack into zip using a simple zip builder
  function toBytes(str: string): Uint8Array {
    return new TextEncoder().encode(str);
  }

  function crc32(data: Uint8Array): number {
    const table = (() => {
      const t = new Uint32Array(256);
      for (let i = 0; i < 256; i++) {
        let c = i;
        for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[i] = c;
      }
      return t;
    })();
    let crc = 0xffffffff;
    for (let i = 0; i < data.length; i++) crc = table[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function u16(n: number): Uint8Array {
    return new Uint8Array([n & 0xff, (n >> 8) & 0xff]);
  }
  function u32(n: number): Uint8Array {
    return new Uint8Array([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff]);
  }

  function concat(...arrays: Uint8Array[]): Uint8Array {
    const total = arrays.reduce((s, a) => s + a.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const a of arrays) {
      out.set(a, off);
      off += a.length;
    }
    return out;
  }

  const files: { name: string; data: Uint8Array }[] = [
    { name: "[Content_Types].xml", data: toBytes(contentTypes) },
    { name: "_rels/.rels", data: toBytes(rootRels) },
    { name: "xl/workbook.xml", data: toBytes(wbXml) },
    { name: "xl/_rels/workbook.xml.rels", data: toBytes(wbRels) },
    { name: "xl/sharedStrings.xml", data: toBytes(ssXml) },
    ...sheetXmls.map((xml, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: toBytes(xml) })),
  ];

  const localHeaders: Uint8Array[] = [];
  const offsets: number[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = toBytes(file.name);
    const crc = crc32(file.data);
    const local = concat(
      new Uint8Array([0x50, 0x4b, 0x03, 0x04]), // local file sig
      u16(20),
      u16(0),
      u16(0), // version, flags, compression (stored)
      u16(0),
      u16(0), // mod time, mod date
      u32(crc),
      u32(file.data.length),
      u32(file.data.length),
      u16(nameBytes.length),
      u16(0),
      nameBytes,
      file.data,
    );
    offsets.push(offset);
    localHeaders.push(local);
    offset += local.length;
  }

  const centralDir: Uint8Array[] = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const nameBytes = toBytes(file.name);
    const crc = crc32(file.data);
    centralDir.push(
      concat(
        new Uint8Array([0x50, 0x4b, 0x01, 0x02]), // central dir sig
        u16(20),
        u16(20),
        u16(0),
        u16(0), // versions, flags, compression
        u16(0),
        u16(0), // mod time, date
        u32(crc),
        u32(file.data.length),
        u32(file.data.length),
        u16(nameBytes.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offsets[i]),
        nameBytes,
      ),
    );
  }

  const centralDirData = concat(...centralDir);
  const eocd = concat(
    new Uint8Array([0x50, 0x4b, 0x05, 0x06]), // end of central dir
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(centralDirData.length),
    u32(offset),
    u16(0),
  );

  const final = concat(...localHeaders, centralDirData, eocd);
  return new Blob([final.buffer.slice(final.byteOffset, final.byteOffset + final.byteLength) as ArrayBuffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

export default function TimetablePage() {
  const { db, currentUser, showModal, closeModal, toast, reloadDb } = useApp();
  const role = currentUser?.role;
  const [filterCls, setFilterCls] = useState("");
  const [filterDay, setFilterDay] = useState("");
  const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

  const exportToExcel = () => {
    const HEADER = ["Day", "Time", "Class", "Module", "Lecturer", "Room"];

    // Sheet 1: All slots grouped by day
    const allRows: (string | number)[][] = [HEADER];
    for (const day of days) {
      const daySlots = db.timetable.filter((t) => t.day === day).sort((a, b) => a.time.localeCompare(b.time));
      daySlots.forEach((t) => {
        const cls = db.classes.find((c) => c.id === t.classId);
        const mod = db.modules.find((m) => m.id === t.moduleId);
        allRows.push([day, t.time, cls?.name || "", mod?.name || "", cls?.lecturer || "", t.room || ""]);
      });
    }

    // Sheet 2: One sheet per day (only days with slots)
    const daySheets = days
      .map((day) => {
        const daySlots = db.timetable.filter((t) => t.day === day).sort((a, b) => a.time.localeCompare(b.time));
        if (!daySlots.length) return null;
        const rows: (string | number)[][] = [HEADER];
        daySlots.forEach((t) => {
          const cls = db.classes.find((c) => c.id === t.classId);
          const mod = db.modules.find((m) => m.id === t.moduleId);
          rows.push([day, t.time, cls?.name || "", mod?.name || "", cls?.lecturer || "", t.room || ""]);
        });
        return { name: day, rows };
      })
      .filter(Boolean) as { name: string; rows: (string | number)[][] }[];

    const blob = buildXlsx([{ name: "Full Timetable", rows: allRows }, ...daySheets]);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Timetable_${new Date().getFullYear()}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast("Timetable downloaded!", "success");
  };

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
        <button className="btn btn-outline btn-sm" onClick={exportToExcel} title="Download as Excel">
          <i className="fa-solid fa-file-excel" /> Export Excel
        </button>
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
