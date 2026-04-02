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
  const [activeTab, setActiveTab] = useState<"timetable" | "exams">("timetable");
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

  const printTimetable = () => {
    const logoUrl = window.location.origin + "/transcript_logo.png";
    const allDays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

    // Build combined slots + exams per day
    const examsByDay: Record<string, typeof db.exams> = {};
    if (true) {
      db.exams.forEach((e) => {
        if (!e.date) return;
        const d = new Date(e.date);
        if (isNaN(d.getTime())) return;
        const dayName = d.toLocaleDateString("en-GB", { weekday: "long" });
        if (!examsByDay[dayName]) examsByDay[dayName] = [];
        examsByDay[dayName].push(e);
      });
    }

    const filteredSlots = db.timetable.filter((t) => {
      if (filterCls && t.classId !== filterCls) return false;
      if (filterDay && t.day !== filterDay) return false;
      return true;
    });

    const daysToShow = filterDay ? [filterDay] : allDays;

    const daySections = daysToShow
      .map((day) => {
        const daySlots = filteredSlots.filter((t) => t.day === day).sort((a, b) => a.time.localeCompare(b.time));
        const dayExams = examsByDay[day] || [];
        if (!daySlots.length && !dayExams.length) return "";

        const slotRows = daySlots
          .map((t, i) => {
            const cls = db.classes.find((c) => c.id === t.classId);
            const mod = db.modules.find((m) => m.id === t.moduleId);
            const bg = i % 2 === 0 ? "#f9fafb" : "#ffffff";
            return `<tr style="background:${bg}">
          <td style="padding:6px 10px;font-weight:600;color:#4f46e5">${t.time}</td>
          <td style="padding:6px 10px;font-weight:600">${cls?.name || "—"}</td>
          <td style="padding:6px 10px">${mod?.name || "—"}</td>
          <td style="padding:6px 10px;color:#6b7280">${cls?.lecturer || "—"}</td>
          <td style="padding:6px 10px">${t.room ? `<span style="background:#e0e7ff;border-radius:4px;padding:2px 8px;font-size:11px">${t.room}</span>` : "—"}</td>
          <td style="padding:6px 10px"><span style="background:#dcfce7;color:#166534;border-radius:4px;padding:2px 8px;font-size:11px;font-weight:600">Class</span></td>
        </tr>`;
          })
          .join("");

        const examRows = dayExams
          .map((e, i) => {
            const cls = db.classes.find((c) => c.id === e.classId);
            const mod = db.modules.find((m) => m.id === e.moduleId);
            const dateStr = e.date ? new Date(e.date).toLocaleDateString("en-GB") : "—";
            const bg = (daySlots.length + i) % 2 === 0 ? "#f9fafb" : "#ffffff";
            return `<tr style="background:${bg}">
          <td style="padding:6px 10px;font-weight:600;color:#dc2626">${dateStr}</td>
          <td style="padding:6px 10px;font-weight:600">${cls?.name || "—"}</td>
          <td style="padding:6px 10px">${mod?.name || "—"} — ${e.name}</td>
          <td style="padding:6px 10px;color:#6b7280">—</td>
          <td style="padding:6px 10px">—</td>
          <td style="padding:6px 10px"><span style="background:#fee2e2;color:#dc2626;border-radius:4px;padding:2px 8px;font-size:11px;font-weight:600">EXAM</span></td>
        </tr>`;
          })
          .join("");

        return `
        <div style="margin-bottom:20px">
          <div style="background:#002060;color:#fff;padding:7px 14px;font-weight:700;font-size:13px;border-radius:4px 4px 0 0;border-left:4px solid #C9A227">
            ${day}
          </div>
          <table style="width:100%;border-collapse:collapse;font-size:12px;border:1px solid #e5e7eb;border-top:none">
            <thead>
              <tr style="background:#f3f4f6">
                <th style="padding:6px 10px;text-align:left;font-size:11px;color:#6b7280">Time / Date</th>
                <th style="padding:6px 10px;text-align:left;font-size:11px;color:#6b7280">Class</th>
                <th style="padding:6px 10px;text-align:left;font-size:11px;color:#6b7280">Module</th>
                <th style="padding:6px 10px;text-align:left;font-size:11px;color:#6b7280">Lecturer</th>
                <th style="padding:6px 10px;text-align:left;font-size:11px;color:#6b7280">Room</th>
                <th style="padding:6px 10px;text-align:left;font-size:11px;color:#6b7280">Type</th>
              </tr>
            </thead>
            <tbody>${slotRows}${examRows}</tbody>
          </table>
        </div>`;
      })
      .join("");

    const clsName = filterCls ? db.classes.find((c) => c.id === filterCls)?.name || "" : "All Classes";
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8"/>
  <title>Timetable — ${clsName}</title>
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
      Class Timetable — ${clsName} &nbsp;·&nbsp; ${db.config.currentYear} &nbsp;·&nbsp; Semester ${db.config.currentSemester}
    </div>
  </div>
  ${dayEmpty(dayHasContent(daysToShow, filteredSlots, examsByDay)) ? `<div style="text-align:center;padding:40px;color:#999">No timetable entries found.</div>` : daySections}
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

  // helpers for print
  const dayHasContent = (
    daysToShow: string[],
    filteredSlots: typeof db.timetable,
    examsByDay: Record<string, typeof db.exams>,
  ) => daysToShow.some((d) => filteredSlots.some((t) => t.day === d) || (examsByDay[d] || []).length > 0);
  const dayEmpty = (v: boolean) => !v;

  let slots = [...db.timetable];
  if (filterCls) slots = slots.filter((t) => t.classId === filterCls);
  if (filterDay) slots = slots.filter((t) => t.day === filterDay);

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
    excludeId?: string,
  ): ConflictResult | null => {
    const others = db.timetable.filter((t) => t.day === day && t.id !== excludeId);

    // 1. Room double-booking (any overlap)
    if (roomName) {
      const roomConflict = others.find((t) => t.room === roomName && timesOverlap(t.time, time));
      if (roomConflict) {
        const cls = db.classes.find((c) => c.id === roomConflict.classId);
        return {
          type: "room",
          message: `Room "${roomName}" is already booked on ${day} at ${roomConflict.time} for ${cls?.name || "another class"}.`,
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
          const conflict = checkConflicts(classId, roomName, day, time);
          if (conflict) {
            toast(`⚠️ ${conflict.type === "class" ? "Class" : "Room"} double booking: ${conflict.message}`, "error");
            await sendDoubleBookingNotification(conflict.message, "addition");
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
          const conflict = checkConflicts(classId, roomName, day, time, slot.id);
          if (conflict) {
            toast(`⚠️ ${conflict.type === "class" ? "Class" : "Room"} double booking: ${conflict.message}`, "error");
            await sendDoubleBookingNotification(conflict.message, "edit");
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
        if (a.room && a.room === b.room) {
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
              <div className="form-group" style={{ marginBottom: 0, minWidth: 140 }}>
                <label style={{ fontSize: 11 }}>Day</label>
                <select className="form-select" value={filterDay} onChange={(e) => setFilterDay(e.target.value)}>
                  <option value="">All Days</option>
                  {days.map((d) => <option key={d} value={d}>{d}</option>)}
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
                          <td style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, whiteSpace: "nowrap" }}>{t.time}</td>
                          <td style={{ fontWeight: 600 }}>{cls?.name}</td>
                          <td>{mod?.name}</td>
                          <td style={{ fontSize: 11, color: "var(--text2)" }}>{cls?.lecturer || "—"}</td>
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
                    });
                  })}
                  {slots.length === 0 && (
                    <tr><td colSpan={role === "admin" ? 7 : 6} style={{ textAlign: "center", color: "var(--text2)", padding: 32 }}>No timetable slots found.</td></tr>
                  )}
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
                      const timeStr = e.time ? e.time.substring(0, 5) : "—";
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
                          <td style={{ fontSize: 11 }}>{(e as any).venue || "—"}</td>
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
  initialValues: { classId: string; day: string; time: string; moduleId: string; roomName: string };
  onChange: (v: { classId: string; day: string; time: string; moduleId: string; roomName: string }) => void;
  onSubmit: () => void;
  submitLabel: string;
  onDelete?: () => void;
}) {
  const [vals, setVals] = useState(initialValues);
  const [roomConflict, setRoomConflict] = useState<string | null>(null);

  // Parse "HH:MM-HH:MM" → [startMins, endMins]
  const parseTime = (t: string): [number, number] | null => {
    const m = t.match(/^(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    return [parseInt(m[1]) * 60 + parseInt(m[2]), parseInt(m[3]) * 60 + parseInt(m[4])];
  };
  const overlaps = (a: string, b: string) => {
    const ra = parseTime(a),
      rb = parseTime(b);
    if (!ra || !rb) return a === b;
    return ra[0] < rb[1] && rb[0] < ra[1];
  };

  const update = (patch: Partial<typeof vals>) => {
    const next = { ...vals, ...patch };
    setVals(next);
    onChange(next);

    const excludeId = (initialValues as any).id;
    const others = db.timetable.filter((t: any) => t.day === next.day && t.id !== excludeId);

    // Room conflict
    if (next.roomName) {
      const rc = others.find((t: any) => t.room === next.roomName && next.time && overlaps(t.time, next.time));
      if (rc) {
        const cls = db.classes.find((c: any) => c.id === rc.classId);
        setRoomConflict(`Room "${next.roomName}" already booked at ${rc.time} for ${cls?.name || "another class"}.`);
        return;
      }
    }

    // Class conflict
    if (next.classId && next.time) {
      const cc = others.find((t: any) => t.classId === next.classId && overlaps(t.time, next.time));
      if (cc) {
        const mod = db.modules.find((m: any) => m.id === cc.moduleId);
        setRoomConflict(`This class already has a slot at ${cc.time}${mod ? ` (${mod.name})` : ""}. Times overlap.`);
        return;
      }
    }

    setRoomConflict(null);
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
