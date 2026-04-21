import React, { useState } from "react";
import { useApp } from "@/context/AppContext";
import { supabase } from "@/integrations/supabase/client";
import { getLecturerForModuleClass } from "@/lib/lecturerHelpers";

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
  const [activeTab, setActiveTab] = useState<"timetable" | "exams">("timetable");
  const [filterCls, setFilterCls] = useState("");
  const [filterMonth, setFilterMonth] = useState(() => {
    const n = new Date();
    return n.getFullYear() + '-' + String(n.getMonth()+1).padStart(2,'0');
  });
  const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

  const exportToExcel = () => {
    const HEADER = ["Day", "Time", "Class", "Module", "Lecturer", "Room"];

    const slotLecturerName = (moduleId: string, classId: string) => {
      const lmEntry = getLecturerForModuleClass(db.lecturerModules, moduleId, classId);
      return lmEntry ? (db.users.find(u => u.id === lmEntry)?.name || "—") : "—";
    };

    // Sheet 1: All slots grouped by day
    const allRows: (string | number)[][] = [HEADER];
    for (const day of days) {
      const daySlots = db.timetable.filter((t) => t.day === day).sort((a, b) => a.time.localeCompare(b.time));
      daySlots.forEach((t) => {
        const cls = db.classes.find((c) => c.id === t.classId);
        const mod = db.modules.find((m) => m.id === t.moduleId);
        allRows.push([day, t.time, cls?.name || "", mod?.name || "", slotLecturerName(t.moduleId, t.classId), t.room || ""]);
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
          rows.push([day, t.time, cls?.name || "", mod?.name || "", slotLecturerName(t.moduleId, t.classId), t.room || ""]);
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

  const printTimetable = () => {
    const logoUrl = window.location.origin + "/transcript_logo.png";
    const slotLecturerName = (moduleId: string, classId: string) => {
      const lmEntry = getLecturerForModuleClass(db.lecturerModules, moduleId, classId);
      return lmEntry ? (db.users.find(u => u.id === lmEntry)?.name || "—") : "—";
    };

    // Index exams by ISO date
    const examsByDate: Record<string, typeof db.exams> = {};
    db.exams.forEach((e) => {
      if (!e.date) return;
      const iso = e.date.substring(0, 10);
      if (!examsByDate[iso]) examsByDate[iso] = [];
      examsByDate[iso].push(e);
    });

    const filteredSlots = db.timetable.filter((t) => {
      if (filterCls && t.classId !== filterCls) return false;
      return true;
    });

    // Generate every weekday in the selected month
    const [yr, mo] = filterMonth.split('-').map(Number);
    const daysInMonth = new Date(yr, mo, 0).getDate();
    const weekdayNames = ["Monday","Tuesday","Wednesday","Thursday","Friday"];
    const daySections: string[] = [];

    for (let d = 1; d <= daysInMonth; d++) {
      const dateObj = new Date(yr, mo - 1, d);
      const dayName = dateObj.toLocaleDateString('en-GB', { weekday: 'long' });
      if (!weekdayNames.includes(dayName)) continue;
      const isoDate = `${yr}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;

      // Recurring slots for this weekday + any one-off slots pinned to this date
      const dateSlots = filteredSlots.filter(t => {
        if (t.date) return t.date === isoDate;
        return t.day === dayName;
      }).sort((a, b) => a.time.localeCompare(b.time));

      const dayExams = examsByDate[isoDate] || [];
      if (!dateSlots.length && !dayExams.length) continue;

      const dateLabel = dateObj.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

      const seenSessions = new Set<string>();
      const slotRows = dateSlots.map((t, i) => {
        if (t.sessionId) {
          if (seenSessions.has(t.sessionId)) return '';
          seenSessions.add(t.sessionId);
        }
        const sharedSlots = t.sessionId
          ? db.timetable.filter(s => s.sessionId === t.sessionId)
          : [t];
        const classNames = sharedSlots
          .map(s => db.classes.find(c => c.id === s.classId)?.name)
          .filter(Boolean).join(" + ");
        const mod = db.modules.find(m => m.id === t.moduleId);
        const bg = i % 2 === 0 ? "#f9fafb" : "#ffffff";
        return `<tr style="background:${bg}">
          <td style="padding:6px 10px;font-weight:600;color:#4f46e5">${t.time}</td>
          <td style="padding:6px 10px;font-weight:600">${classNames}</td>
          <td style="padding:6px 10px">${mod?.name || "—"}</td>
          <td style="padding:6px 10px;color:#6b7280">${slotLecturerName(t.moduleId, t.classId)}</td>
          <td style="padding:6px 10px">${t.room ? `<span style="background:#e0e7ff;border-radius:4px;padding:2px 8px;font-size:11px">${t.room}</span>` : "—"}</td>
          <td style="padding:6px 10px"><span style="background:#dcfce7;color:#166534;border-radius:4px;padding:2px 8px;font-size:11px;font-weight:600">Class</span></td>
        </tr>`;
      }).join('');

      const examRows = dayExams.map((e, i) => {
        const cls = db.classes.find(c => c.id === e.classId);
        const mod = db.modules.find(m => m.id === e.moduleId);
        const bg = (dateSlots.length + i) % 2 === 0 ? "#f9fafb" : "#ffffff";
        return `<tr style="background:${bg}">
          <td style="padding:6px 10px;font-weight:600;color:#dc2626">${e.startTime || '—'}</td>
          <td style="padding:6px 10px;font-weight:600">${cls?.name || "—"}</td>
          <td style="padding:6px 10px">${mod?.name || "—"} — ${e.name}</td>
          <td style="padding:6px 10px;color:#6b7280">—</td>
          <td style="padding:6px 10px">—</td>
          <td style="padding:6px 10px"><span style="background:#fee2e2;color:#dc2626;border-radius:4px;padding:2px 8px;font-size:11px;font-weight:600">EXAM</span></td>
        </tr>`;
      }).join('');

      daySections.push(`
        <div style="margin-bottom:20px">
          <div style="background:#002060;color:#fff;padding:7px 14px;font-weight:700;font-size:13px;border-radius:4px 4px 0 0;border-left:4px solid #C9A227">
            ${dateLabel}
          </div>
          <table style="width:100%;border-collapse:collapse;font-size:12px;border:1px solid #e5e7eb;border-top:none">
            <thead>
              <tr style="background:#f3f4f6">
                <th style="padding:6px 10px;text-align:left;font-size:11px;color:#6b7280">Time</th>
                <th style="padding:6px 10px;text-align:left;font-size:11px;color:#6b7280">Class</th>
                <th style="padding:6px 10px;text-align:left;font-size:11px;color:#6b7280">Module</th>
                <th style="padding:6px 10px;text-align:left;font-size:11px;color:#6b7280">Lecturer</th>
                <th style="padding:6px 10px;text-align:left;font-size:11px;color:#6b7280">Room</th>
                <th style="padding:6px 10px;text-align:left;font-size:11px;color:#6b7280">Type</th>
              </tr>
            </thead>
            <tbody>${slotRows}${examRows}</tbody>
          </table>
        </div>`);
    }

    const clsName = filterCls ? db.classes.find((c) => c.id === filterCls)?.name || "" : "All Classes";
    const monthLabel = new Date(yr, mo - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8"/>
  <title>Timetable — ${clsName} — ${monthLabel}</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family: Arial, sans-serif; color:#000; background:#fff; padding:20px 30px; }
    @page { size: A4 landscape; margin: 12mm 14mm; }
    @media print { body { padding:0; } .no-print { display:none !important; } }
    table { border-collapse: collapse; }
  </style>
</head>
<body>
  <div style="text-align:center;margin-bottom:12px">
    <img src="${logoUrl}" style="height:60px;object-fit:contain" onerror="this.style.display='none'"/>
  </div>
  <div style="background:#002060;color:#fff;padding:12px 20px;text-align:center;border-bottom:3px solid #C9A227;margin-bottom:16px;border-radius:6px">
    <div style="font-size:15px;font-weight:800;letter-spacing:0.5px">BOSSWA CULINARY INSTITUTE OF BOTSWANA</div>
    <div style="font-size:12px;color:#C9A227;margin-top:4px">
      Class Timetable — ${clsName} &nbsp;·&nbsp; ${monthLabel} &nbsp;·&nbsp; Semester ${db.config.currentSemester}
    </div>
  </div>
  ${daySections.length === 0 ? `<div style="text-align:center;padding:40px;color:#999">No timetable entries found for ${monthLabel}.</div>` : daySections.join('')}
  <div class="no-print" style="text-align:center;margin-top:24px">
    <button onclick="window.print()" style="background:#002060;color:#fff;border:none;padding:10px 28px;font-size:14px;border-radius:6px;cursor:pointer">🖨️ Print / Save as PDF</button>
  </div>
  <script>window.onload = function(){ window.print(); }</script>
</body>
</html>`;

    const win = window.open("", "_blank", "width=1100,height=750");
    if (!win) {
      alert("Pop-ups blocked. Please allow pop-ups to print.");
      return;
    }
    win.document.write(html);
    win.document.close();
  };

  let slots = [...db.timetable];
  if (filterCls) slots = slots.filter((t) => t.classId === filterCls);

  // Check if a room is already booked at the given day+time (excluding a specific slot id)
  // ── Double booking notification ────────────────────────────────────────────
  const sendDoubleBookingNotification = async (conflict: string, action: string) => {
    await supabase.from("notifications").insert({
      id: "notif_dbl_" + Date.now(),
      title: "⚠️ Double Booking Detected",
      body: `A timetable ${action} was blocked: ${conflict}`,
      date: new Date().toISOString().split("T")[0],
      priority: "high",
      author: "Timetable System",
    });
  };

  // ── Conflict detection (overlap-aware) ────────────────────────────────────
  // Parse "HH:MM-HH:MM" → [startMins, endMins]
  const parseTimeRange = (t: string): [number, number] | null => {
    const m = t.match(/^(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    const start = parseInt(m[1]) * 60 + parseInt(m[2]);
    const end = parseInt(m[3]) * 60 + parseInt(m[4]);
    return [start, end];
  };

  const timesOverlap = (a: string, b: string): boolean => {
    const ra = parseTimeRange(a);
    const rb = parseTimeRange(b);
    if (!ra || !rb) return a === b; // fallback: exact match
    return ra[0] < rb[1] && rb[0] < ra[1];
  };

  interface ConflictResult {
    type: "room" | "class";
    message: string;
  }

  const checkConflicts = (
    classId: string,
    roomName: string,
    day: string,
    time: string,
    moduleId?: string,
    excludeSessionId?: string,
  ): ConflictResult | null => {
    const others = db.timetable.filter((t) =>
      t.day === day && (!excludeSessionId || t.sessionId !== excludeSessionId)
    );

    // 1. Room double-booking — only a conflict if DIFFERENT module
    if (roomName) {
      const roomConflict = others.find((t) =>
        t.room === roomName && timesOverlap(t.time, time) && (!moduleId || t.moduleId !== moduleId)
      );
      if (roomConflict) {
        const cls = db.classes.find((c) => c.id === roomConflict.classId);
        return {
          type: "room",
          message: `Room "${roomName}" is already booked on ${day} at ${roomConflict.time} for ${cls?.name || "another class"} (different module).`,
        };
      }
    }

    // 2. Class double-booking (same class, same day, overlapping time)
    const classConflict = others.find((t) => t.classId === classId && timesOverlap(t.time, time));
    if (classConflict) {
      const mod = db.modules.find((m) => m.id === classConflict.moduleId);
      return {
        type: "class",
        message: `This class already has a slot on ${day} at ${classConflict.time}${mod ? ` (${mod.name})` : ""}. Times overlap.`,
      };
    }

    return null;
  };

  const handleAddSlot = () => {
    let classIds: string[] = db.classes[0] ? [db.classes[0].id] : [];
    let day = "Monday", time = "08:00-10:00";
    let moduleId = db.modules[0]?.id || "";
    let roomName = "", date = "";

    showModal(
      "Add Timetable Slot",
      <TimetableForm
        db={db}
        days={days}
        initialValues={{ classIds, day, time, moduleId, roomName, date }}
        onChange={(v) => { classIds = v.classIds; day = v.day; time = v.time; moduleId = v.moduleId; roomName = v.roomName; date = v.date; }}
        onSubmit={async () => {
          if (!classIds.length || !day || !time || !moduleId) {
            toast("Select at least one class, day, time and module", "error");
            return;
          }
          const sessionId = classIds.length > 1 ? "sess_" + Date.now() : null;
          const errors: string[] = [];
          for (const cid of classIds) {
            const conflict = checkConflicts(cid, roomName, day, time, moduleId);
            if (conflict) {
              toast(`⚠️ ${conflict.message}`, "error");
              await sendDoubleBookingNotification(conflict.message, "addition");
              return;
            }
            const { error } = await supabase.from("timetable").insert({
              id: "tt_" + Date.now() + "_" + cid,
              class_id: cid, day, time, module_id: moduleId,
              room: roomName || "", date: date || null,
              session_id: sessionId,
            });
            if (error) errors.push(cid);
          }
          if (errors.length) { toast("Some slots could not be saved", "error"); } else {
            toast(classIds.length > 1 ? `Combined slot added for ${classIds.length} classes!` : "Slot added!", "success");
            closeModal(); reloadDb();
          }
        }}
        submitLabel="Add Slot"
      />,
    );
  };

  const handleEditSlot = (slot: (typeof slots)[0]) => {
    // If this slot has a session_id, collect all sibling class IDs
    const siblingIds = slot.sessionId
      ? db.timetable.filter(t => t.sessionId === slot.sessionId).map(t => t.classId)
      : [slot.classId];

    let classIds: string[] = siblingIds;
    let day = slot.day, time = slot.time, moduleId = slot.moduleId;
    let roomName = slot.room, date = slot.date || "";

    showModal(
      "Edit Timetable Slot",
      <TimetableForm
        db={db}
        days={days}
        initialValues={{ classIds, day, time, moduleId, roomName, date, sessionId: slot.sessionId } as any}
        onChange={(v) => { classIds = v.classIds; day = v.day; time = v.time; moduleId = v.moduleId; roomName = v.roomName; date = v.date; }}
        onSubmit={async () => {
          // Delete all old sibling rows then re-insert
          const idsToDelete = slot.sessionId
            ? db.timetable.filter(t => t.sessionId === slot.sessionId).map(t => t.id)
            : [slot.id];
          for (const did of idsToDelete) {
            await supabase.from("timetable").delete().eq("id", did);
          }
          const sessionId = classIds.length > 1 ? (slot.sessionId || "sess_" + Date.now()) : null;
          const errors: string[] = [];
          for (const cid of classIds) {
            const { error } = await supabase.from("timetable").insert({
              id: "tt_" + Date.now() + "_" + cid,
              class_id: cid, day, time, module_id: moduleId,
              room: roomName || "", date: date || null,
              session_id: sessionId,
            });
            if (error) errors.push(cid);
          }
          if (errors.length) { toast("Some slots could not be saved", "error"); } else {
            toast("Slot updated!", "success"); closeModal(); reloadDb();
          }
        }}
        submitLabel="Save Changes"
        onDelete={async () => {
          if (!confirm(slot.sessionId ? "Delete this combined session (all classes)?" : "Delete this timetable slot?")) return;
          const idsToDelete = slot.sessionId
            ? db.timetable.filter(t => t.sessionId === slot.sessionId).map(t => t.id)
            : [slot.id];
          for (const did of idsToDelete) {
            await supabase.from("timetable").delete().eq("id", did);
          }
          toast("Slot deleted", "success"); closeModal(); reloadDb();
        }}
      />,
    );
  };

  // ── Conflict detection for timetable tab ─────────────────────────────────
  const conflictBanner = (() => {
    const parseT = (t: string): [number, number] | null => {
      const m = t.match(/^(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})$/);
      if (!m) return null;
      return [parseInt(m[1]) * 60 + parseInt(m[2]), parseInt(m[3]) * 60 + parseInt(m[4])];
    };
    const ov = (a: string, b: string) => {
      const ra = parseT(a), rb = parseT(b);
      if (!ra || !rb) return a === b;
      return ra[0] < rb[1] && rb[0] < ra[1];
    };
    const conflicts: { label: string; detail: string }[] = [];
    const seenPairs = new Set<string>();
    db.timetable.forEach((a) => {
      db.timetable.forEach((b) => {
        if (a.id >= b.id) return;
        if (a.day !== b.day) return;
        if (!ov(a.time, b.time)) return;
        const clsA = db.classes.find((c) => c.id === a.classId)?.name || a.classId;
        const clsB = db.classes.find((c) => c.id === b.classId)?.name || b.classId;
        // Room conflict only if different module (same module = allowed shared session)
        if (a.room && a.room === b.room && a.moduleId !== b.moduleId) {
          const k = `room|${a.room}|${a.day}|${a.id}|${b.id}`;
          if (!seenPairs.has(k)) { seenPairs.add(k); conflicts.push({ label: "Room conflict", detail: `"${a.room}" on ${a.day}: ${clsA} (${a.time}) vs ${clsB} (${b.time})` }); }
        }
        if (a.classId === b.classId) {
          const k = `class|${a.classId}|${a.day}|${a.id}|${b.id}`;
          if (!seenPairs.has(k)) { seenPairs.add(k); conflicts.push({ label: "Class conflict", detail: `${clsA} double-booked on ${a.day}: ${a.time} vs ${b.time}` }); }
        }
      });
    });
    if (!conflicts.length) return null;
    return (
      <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.35)", borderRadius: 8, padding: "12px 16px", marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <i className="fa-solid fa-circle-exclamation" style={{ color: "#ef4444", fontSize: 15 }} />
          <strong style={{ fontSize: 13, color: "#ef4444" }}>{conflicts.length} Scheduling Conflict{conflicts.length > 1 ? "s" : ""} Detected</strong>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {conflicts.map((c, i) => (
            <div key={i} style={{ fontSize: 12, color: "var(--text1)", display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ background: "#ef4444", color: "#fff", borderRadius: 4, padding: "1px 7px", fontWeight: 700, fontSize: 11, whiteSpace: "nowrap" }}>{c.label.toUpperCase()}</span>
              {c.detail}
            </div>
          ))}
        </div>
      </div>
    );
  })();

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">
            <i className="fa-solid fa-calendar-days" style={{ color: "var(--accent)", marginRight: 8 }} />
            Timetable
          </div>
          <div className="page-sub">
            {activeTab === "timetable" ? `${db.timetable.length} scheduled slot(s)` : `${db.exams.length} exam(s)`}
          </div>
        </div>
        {activeTab === "timetable" && role === "admin" && (
          <button className="btn btn-primary btn-sm" onClick={handleAddSlot}>
            <i className="fa-solid fa-plus" /> Add Slot
          </button>
        )}
        {activeTab === "timetable" && (
          <>
            <button className="btn btn-outline btn-sm" onClick={exportToExcel} title="Download as Excel">
              <i className="fa-solid fa-file-excel" /> Export Excel
            </button>
            <button className="btn btn-outline btn-sm" onClick={printTimetable} title="Print as PDF">
              <i className="fa-solid fa-print" /> Print PDF
            </button>
          </>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 0, marginBottom: 16, borderBottom: "2px solid var(--border)" }}>
        {(["timetable", "exams"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: "8px 22px",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              border: "none",
              borderBottom: activeTab === tab ? "2px solid var(--accent)" : "2px solid transparent",
              marginBottom: -2,
              background: "transparent",
              color: activeTab === tab ? "var(--accent)" : "var(--text2)",
              transition: "color 0.15s",
            }}
          >
            <i className={`fa-solid ${tab === "timetable" ? "fa-calendar-days" : "fa-file-pen"}`} style={{ marginRight: 7 }} />
            {tab === "timetable" ? "Class Timetable" : "Exam Timetable"}
          </button>
        ))}
      </div>

      {/* ── CLASS TIMETABLE TAB ── */}
      {activeTab === "timetable" && (
        <>
          {conflictBanner}
          <div className="card" style={{ marginBottom: 14, padding: "12px 16px" }}>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
              <div className="form-group" style={{ marginBottom: 0, minWidth: 160 }}>
                <label style={{ fontSize: 11 }}>Class</label>
                <select className="form-select" value={filterCls} onChange={(e) => setFilterCls(e.target.value)}>
                  <option value="">All Classes</option>
                  {db.classes.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div className="form-group" style={{ marginBottom: 0, minWidth: 160 }}>
                <label style={{ fontSize: 11 }}>Month</label>
                <input
                  className="form-input"
                  type="month"
                  value={filterMonth}
                  onChange={(e) => setFilterMonth(e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Time</th>
                    <th>Class</th>
                    <th>Module</th>
                    <th>Lecturer</th>
                    <th>Room</th>
                    {role === "admin" && <th>Edit</th>}
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const [yr, mo] = filterMonth.split('-').map(Number);
                    const daysInMonth = new Date(yr, mo, 0).getDate();
                    const allRows: React.ReactNode[] = [];
                    for (let d = 1; d <= daysInMonth; d++) {
                      const dateObj = new Date(yr, mo - 1, d);
                      const dayName = dateObj.toLocaleDateString('en-GB', { weekday: 'long' });
                      if (!days.includes(dayName)) continue;
                      const isoDate = `${yr}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
                      const dateSlots = slots.filter(t => {
                        if (t.date) return t.date === isoDate;
                        return t.day === dayName;
                      }).sort((a, b) => a.time.localeCompare(b.time));
                      if (!dateSlots.length) continue;
                      const dateLabel = dateObj.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
                      const seenSessions = new Set<string>();
                      let isFirst = true;
                      for (const t of dateSlots) {
                        if (t.sessionId) {
                          if (seenSessions.has(t.sessionId)) continue;
                          seenSessions.add(t.sessionId);
                        }
                        const sharedSlots = t.sessionId
                          ? db.timetable.filter((s: any) => s.sessionId === t.sessionId)
                          : [t];
                        const classNames = sharedSlots
                          .map((s: any) => db.classes.find((c: any) => c.id === s.classId)?.name)
                          .filter(Boolean).join(" + ");
                        const mod = db.modules.find((m: any) => m.id === t.moduleId);
                        const isShared = sharedSlots.length > 1;
                        const lmId = getLecturerForModuleClass(db.lecturerModules, t.moduleId, t.classId);
                        allRows.push(
                          <tr key={`${t.id}-${isoDate}`}>
                            <td style={{ fontWeight: 600, color: "var(--accent)", whiteSpace: "nowrap" }}>
                              {isFirst ? dateLabel : ""}
                            </td>
                            <td style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, whiteSpace: "nowrap" }}>{t.time}</td>
                            <td style={{ fontWeight: 600 }}>
                              {classNames}
                              {isShared && <span style={{ marginLeft: 5, fontSize: 10, background: "rgba(99,102,241,0.15)", color: "var(--accent)", borderRadius: 3, padding: "1px 5px" }}>combined</span>}
                            </td>
                            <td>{mod?.name}</td>
                            <td style={{ fontSize: 11, color: "var(--text2)" }}>
                              {lmId ? (db.users.find((u: any) => u.id === lmId)?.name || "—") : "—"}
                            </td>
                            <td>
                              {t.room ? (
                                <span style={{ background: "var(--surface2)", borderRadius: 4, padding: "2px 8px", fontSize: 11 }}>
                                  <i className="fa-solid fa-door-open" style={{ marginRight: 4, fontSize: 9, opacity: 0.7 }} />
                                  {t.room}
                                </span>
                              ) : <span style={{ color: "var(--text2)", fontSize: 11 }}>—</span>}
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
                        isFirst = false;
                      }
                    }
                    if (!allRows.length) return (
                      <tr><td colSpan={role === "admin" ? 7 : 6} style={{ textAlign: "center", color: "var(--text2)", padding: 32 }}>No timetable slots found.</td></tr>
                    );
                    return allRows;
                  })()}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ── EXAM TIMETABLE TAB ── */}
      {activeTab === "exams" && (
        <>
          <div className="card" style={{ marginBottom: 14, padding: "12px 16px" }}>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
              <div className="form-group" style={{ marginBottom: 0, minWidth: 160 }}>
                <label style={{ fontSize: 11 }}>Class</label>
                <select className="form-select" value={filterCls} onChange={(e) => setFilterCls(e.target.value)}>
                  <option value="">All Classes</option>
                  {db.classes.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
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
                    <th>Date</th>
                    <th>Day</th>
                    <th>Time</th>
                    <th>Class</th>
                    <th>Module</th>
                    <th>Exam Name</th>
                    <th>Venue</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const filtered = db.exams
                      .filter((e) => {
                        if (filterCls && e.classId !== filterCls) return false;
                        return !!e.date;
                      })
                      .sort((a, b) => (a.date || "").localeCompare(b.date || ""));

                    if (!filtered.length) return (
                      <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--text2)", padding: 32 }}>No exams scheduled.</td></tr>
                    );

                    return filtered.map((e) => {
                      const cls = db.classes.find((c) => c.id === e.classId);
                      const mod = db.modules.find((m) => m.id === e.moduleId);
                      const dateObj = e.date ? new Date(e.date) : null;
                      const dateStr = dateObj ? dateObj.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";
                      const dayName = dateObj && !isNaN(dateObj.getTime()) ? dateObj.toLocaleDateString("en-GB", { weekday: "long" }) : "—";
                      const fmt = (t: string) => t ? t.substring(0, 5) : "";
                      const timeStr = e.startTime || e.endTime
                        ? [fmt(e.startTime || ""), fmt(e.endTime || "")].filter(Boolean).join(" – ")
                        : "—";
                      return (
                        <tr key={e.id} style={{ background: "rgba(220,38,38,0.03)" }}>
                          <td style={{ fontWeight: 600, color: "#dc2626", whiteSpace: "nowrap" }}>{dateStr}</td>
                          <td style={{ fontSize: 11, color: "var(--text2)" }}>{dayName}</td>
                          <td style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, whiteSpace: "nowrap" }}>{timeStr}</td>
                          <td style={{ fontWeight: 600 }}>{cls?.name || "—"}</td>
                          <td>{mod?.name || "—"}</td>
                          <td>
                            <span style={{ background: "rgba(220,38,38,0.12)", color: "#dc2626", borderRadius: 4, padding: "2px 8px", fontSize: 11, fontWeight: 600 }}>
                              {e.name}
                            </span>
                          </td>
                          <td style={{ fontSize: 11 }}>
                            {e.room ? (
                              <span style={{ background: "var(--surface2)", borderRadius: 4, padding: "2px 8px", fontSize: 11 }}>
                                <i className="fa-solid fa-door-open" style={{ marginRight: 4, fontSize: 9, opacity: 0.7 }} />
                                {e.room}
                              </span>
                            ) : "—"}
                          </td>
                        </tr>
                      );
                    });
                  })()}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
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
  initialValues: { classIds: string[]; day: string; time: string; moduleId: string; roomName: string; date: string };
  onChange: (v: { classIds: string[]; day: string; time: string; moduleId: string; roomName: string; date: string }) => void;
  onSubmit: () => void;
  submitLabel: string;
  onDelete?: () => void;
}) {
  const [vals, setVals] = useState(initialValues);
  const [roomConflict, setRoomConflict] = useState<string | null>(null);

  const parseTime = (t: string): [number, number] | null => {
    const m = t.match(/^(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    return [parseInt(m[1]) * 60 + parseInt(m[2]), parseInt(m[3]) * 60 + parseInt(m[4])];
  };
  const overlaps = (a: string, b: string) => {
    const ra = parseTime(a), rb = parseTime(b);
    if (!ra || !rb) return a === b;
    return ra[0] < rb[1] && rb[0] < ra[1];
  };

  const update = (patch: Partial<typeof vals>) => {
    const next = { ...vals, ...patch };
    setVals(next);
    onChange(next);

    const excludeSessionId = (initialValues as any).sessionId;
    const others = db.timetable.filter((t: any) =>
      t.day === next.day &&
      (!excludeSessionId || t.sessionId !== excludeSessionId)
    );

    // Room conflict — allowed if same module (shared lecture)
    if (next.roomName && next.time) {
      const rc = others.find((t: any) =>
        t.room === next.roomName &&
        overlaps(t.time, next.time) &&
        t.moduleId !== next.moduleId  // only flag if DIFFERENT module
      );
      if (rc) {
        const cls = db.classes.find((c: any) => c.id === rc.classId);
        setRoomConflict(`Room "${next.roomName}" already booked at ${rc.time} for ${cls?.name || "another class"} (different module).`);
        return;
      }
    }

    // Class double-booking — same class can't have two overlapping slots
    for (const cid of next.classIds) {
      if (!cid || !next.time) continue;
      const cc = others.find((t: any) => t.classId === cid && overlaps(t.time, next.time));
      if (cc) {
        const cls = db.classes.find((c: any) => c.id === cid);
        const mod = db.modules.find((m: any) => m.id === cc.moduleId);
        setRoomConflict(`${cls?.name || "A class"} already has a slot at ${cc.time}${mod ? ` (${mod.name})` : ""}. Times overlap.`);
        return;
      }
    }

    setRoomConflict(null);
  };

  const rooms: any[] = db.rooms || [];
  const toggleClass = (id: string) => {
    const next = vals.classIds.includes(id)
      ? vals.classIds.filter(c => c !== id)
      : [...vals.classIds, id];
    update({ classIds: next });
  };

  return (
    <div>
      {/* Classes — multi-select checkboxes */}
      <div className="form-group">
        <label>Class(es) * <span style={{ fontWeight: 400, color: "var(--text2)", fontSize: 11 }}>— select multiple for a combined / shared session</span></label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
          {db.classes.map((c: any) => (
            <label key={c.id} style={{ display: "flex", alignItems: "center", gap: 5, background: "var(--bg2)", borderRadius: 5, padding: "4px 10px", fontSize: 12, cursor: "pointer", border: vals.classIds.includes(c.id) ? "1.5px solid var(--accent)" : "1.5px solid var(--border)" }}>
              <input type="checkbox" checked={vals.classIds.includes(c.id)} onChange={() => toggleClass(c.id)} style={{ accentColor: "var(--accent)" }} />
              {c.name}
            </label>
          ))}
        </div>
        {vals.classIds.length === 0 && <div style={{ fontSize: 11, color: "var(--danger)", marginTop: 4 }}>Select at least one class.</div>}
      </div>

      <div className="form-row cols2">
        <div className="form-group">
          <label>Day *</label>
          <select className="form-select" value={vals.day} onChange={(e) => update({ day: e.target.value })}>
            {days.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label>Specific Date <span style={{ fontWeight: 400, color: "var(--text2)", fontSize: 11 }}>(optional — leave blank for recurring)</span></label>
          <input
            className="form-input"
            type="date"
            value={vals.date}
            onChange={(e) => update({ date: e.target.value })}
          />
        </div>
      </div>

      <div className="form-row cols2">
        <div className="form-group">
          <label>Time * <span style={{ fontWeight: 400, color: "var(--text2)", fontSize: 11 }}>e.g. 08:00-10:00</span></label>
          <input
            className="form-input"
            value={vals.time}
            placeholder="08:00-10:00"
            onChange={(e) => update({ time: e.target.value })}
          />
        </div>
        <div className="form-group">
          <label>Room</label>
          {rooms.length > 0 ? (
            <select className="form-select" value={vals.roomName} onChange={(e) => update({ roomName: e.target.value })}>
              <option value="">— No Room —</option>
              {rooms.map((r: any) => (
                <option key={r.id} value={r.name}>
                  {r.name} ({r.type}{r.capacity > 0 ? `, cap. ${r.capacity}` : ""})
                </option>
              ))}
            </select>
          ) : (
            <input className="form-input" value={vals.roomName} placeholder="Room / Lab" onChange={(e) => update({ roomName: e.target.value })} />
          )}
        </div>
      </div>

      {/* Double-booking warning */}
      {roomConflict && (
        <div style={{ background: "rgba(220,38,38,0.12)", border: "1px solid rgba(220,38,38,0.4)", borderRadius: 6, padding: "8px 12px", marginBottom: 10, fontSize: 12, color: "#f87171", display: "flex", alignItems: "center", gap: 8 }}>
          <i className="fa-solid fa-triangle-exclamation" />
          <span><strong>Conflict:</strong> {roomConflict}</span>
        </div>
      )}

      <div className="form-group">
        <label>Module *</label>
        <select className="form-select" value={vals.moduleId} onChange={(e) => update({ moduleId: e.target.value })}>
          {db.modules.map((m: any) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
      </div>

      {vals.classIds.length > 1 && (
        <div style={{ background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.3)", borderRadius: 6, padding: "7px 12px", fontSize: 12, color: "var(--accent)", marginBottom: 8 }}>
          <i className="fa-solid fa-users" style={{ marginRight: 6 }} />
          <strong>Combined session</strong> — {vals.classIds.length} classes will share this room and time slot for the same module.
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button className="btn btn-primary" onClick={onSubmit} disabled={!!roomConflict || vals.classIds.length === 0}>
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
