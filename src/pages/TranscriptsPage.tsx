import { useState, useEffect, useRef } from "react";
import { useApp } from "@/context/AppContext";
import { calcModuleMark } from "@/data/db";
import { supabase } from "@/integrations/supabase/client";
import { categorizeModuleAssessments, computeStudentModuleMark } from "@/lib/moduleMark";
import { letterGrade, gradePoint, GRADE_SCALE } from "@/lib/grading";

// Roles permitted to edit the transcript signatory ("admin and above").
const CAN_EDIT_ISSUER = ["admin", "super_admin"];

// ── Grading ───────────────────────────────────────────────────────────────────
// The letter-grade scale, grade points and displayed scale live in
// "@/lib/grading" so the transcript and the class report share one definition.

// Credit-weighted GPA: Σ(gradePoint × credits) / Σ(credits). Superseded
// (earlier retake) attempts are excluded — only the latest attempt counts.
function computeGPA(mods: PassedModule[]): string {
  const counted = mods.filter((m) => !m.superseded);
  const totalCredits = counted.reduce((s, m) => s + m.credits, 0);
  if (!totalCredits) return "—";
  const weighted = counted.reduce((s, m) => s + gradePoint(m.grade) * m.credits, 0);
  return (weighted / totalCredits).toFixed(2);
}

function formatDate(dateStr?: string): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

function todayStr(): string {
  return new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

interface PassedModule {
  moduleId: string;
  name: string;
  code: string;
  mark: number;
  grade: string;
  credits: number;
  // Study year/semester (1–3 / 1–2) the module sits in within the curriculum —
  // used for grouping/display on the transcript.
  year: number;
  semester: number;
  // The calendar period the mark was recorded in. Identifies the attempt so the
  // latest retake can be picked; NOT used for display.
  attemptYear?: number;
  attemptSem?: number;
  superseded?: boolean;
}

// When a module was taken more than once (a retake), only the latest attempt
// (highest calendar year, then semester) counts toward GPA/credits; earlier
// attempts are flagged "superseded" so they still display but don't count.
function flagSuperseded(mods: PassedModule[]): PassedModule[] {
  const latestRank: Record<string, number> = {};
  mods.forEach((m) => {
    const r = (m.attemptYear ?? m.year) * 100 + (m.attemptSem ?? m.semester);
    if (latestRank[m.moduleId] === undefined || r > latestRank[m.moduleId]) latestRank[m.moduleId] = r;
  });
  return mods.map((m) => ({ ...m, superseded: (m.attemptYear ?? m.year) * 100 + (m.attemptSem ?? m.semester) < latestRank[m.moduleId] }));
}

// School contact details shown on the transcript (kept in sync with the
// acceptance/welcome letters in ApplicantPortal).
const SCHOOL_CONTACT = {
  address: "Plot 2830, Sedie · Maun",
  pobox: "P O Box 661, Maun",
  tel: "+267 686 0262",
  fax: "+267 686 0261",
  email: "info@boswa.ac.bw",
  web: "www.boswa.ac.bw",
};
const SCHOOL_CONTACT_LINE =
  `${SCHOOL_CONTACT.address}  ·  ${SCHOOL_CONTACT.pobox}  ·  ☎ ${SCHOOL_CONTACT.tel}` +
  `  ·  ✉ ${SCHOOL_CONTACT.email}  ·  ${SCHOOL_CONTACT.web}`;

// The banner that sits at the FOOT of the transcript (on screen and in print).
// Built as inline HTML/SVG — no image asset and no icon font — so it looks
// identical in the printed PDF (a standalone window where FontAwesome isn't
// loaded) as it does on screen, and nothing is ever cropped. Navy bar, orange
// icon tiles, then the website + institute name (school letterhead footer).
function footerBannerHTML(): string {
  const svg = (path: string) =>
    `<svg width="13" height="13" viewBox="0 0 24 24" fill="#fff" style="display:block">${path}</svg>`;
  const ICONS = {
    phone: svg('<path d="M6.6 10.8c1.4 2.8 3.8 5.2 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.4 0 .8-.3 1l-2.2 2.2z"/>'),
    fax: svg('<path d="M6 3h12v4H6V3zm13 5H5a3 3 0 00-3 3v6h4v4h12v-4h4v-6a3 3 0 00-3-3zm-3 11H8v-5h8v5z"/>'),
    at: '<span style="color:#fff;font-weight:800;font-size:14px;line-height:1">@</span>',
    pin: svg('<path d="M12 2a7 7 0 00-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 00-7-7zm0 9.5A2.5 2.5 0 1112 6a2.5 2.5 0 010 5.5z"/>'),
    envelope: svg('<path d="M3 5h18a1 1 0 011 1v12a1 1 0 01-1 1H3a1 1 0 01-1-1V6a1 1 0 011-1zm9 7L4 7v.5l8 5 8-5V7l-8 5z"/>'),
  };
  const item = (icon: string, text: string) =>
    `<div style="display:flex;align-items:center;gap:8px">` +
    `<span style="display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;background:#f2882d;border-radius:6px;flex:none">${icon}</span>` +
    `<span style="font-size:11px;color:#fff;white-space:nowrap">${text}</span></div>`;
  return (
    // Full-width bar spanning the whole page; contact items spread edge-to-edge.
    `<div style="background:#16233f;padding:16px 30px;width:100%;box-sizing:border-box">` +
    `<div style="display:flex;flex-wrap:wrap;gap:12px 18px;align-items:center;justify-content:space-between">` +
    item(ICONS.phone, SCHOOL_CONTACT.tel) +
    item(ICONS.fax, SCHOOL_CONTACT.fax) +
    item(ICONS.at, SCHOOL_CONTACT.email) +
    item(ICONS.pin, SCHOOL_CONTACT.address) +
    item(ICONS.envelope, SCHOOL_CONTACT.pobox) +
    `</div>` +
    `<div style="text-align:center;margin-top:12px;font-weight:700;font-size:13px;letter-spacing:.3px;color:#fff">` +
    `<span style="color:#f2882d">${SCHOOL_CONTACT.web}</span>&nbsp;&nbsp;Bosswa Culinary Institute of Botswana</div>` +
    `</div>`
  );
}

// ── Build a student's transcript modules ─────────────────────────────────────
// Real marks live in `assessment_marks` (one row per exam/assignment). Each
// module's weighted mark is computed the same way the Class Report does, via the
// shared helpers, so the transcript and reports never diverge. Any legacy `marks`
// rows not already covered by assessment data are merged in so historical/retake
// records are never dropped.
async function buildPassedModules(db: any, student: any): Promise<PassedModule[]> {
  const { data } = await supabase
    .from("assessment_marks")
    .select("module_id,class_id,assessment_id,score")
    .eq("student_id", student.studentId);
  const asm = (data || []).map((x: any) => ({
    moduleId: x.module_id,
    classId: x.class_id,
    assessmentId: x.assessment_id,
    score: Number(x.score),
    rawScore: x.score, // kept un-coerced so a blank ("no mark") ≠ a real 0
  }));
  const scoreOf = (_studentId: string, assessmentId: string) => {
    const m = asm.find((x: any) => x.assessmentId === assessmentId);
    return m ? m.score : null;
  };

  // A module's "respective semester" comes from the programme CURRICULUM
  // (programme_modules) — the definitive study year/semester slot for that
  // module — so modules group correctly even if the class they were marked in
  // doesn't line up. Falls back to the class, then the mark's own period.
  const currOf = (moduleId: string) =>
    (db.programmeModules || []).find(
      (pm: any) => pm.programmeId === student.programme && pm.moduleId === moduleId,
    );

  // The transcript must show ONLY modules the student actually takes. Two kinds
  // of stray rows leak in otherwise: (a) "phantom" modules whose id is no longer
  // in the modules table (deleted in config), and (b) marks recorded against a
  // module for a DIFFERENT class the student isn't in. We keep a row only if the
  // module is real AND either the mark is for the student's own class or the
  // module is one they're enrolled in (class link + per-student overrides).
  const enrolledModuleIds = new Set<string>([
    ...db.modules.filter((m: any) => (m.classes || []).includes(student.classId)).map((m: any) => m.id),
    ...(db.studentModules || []).filter((sm: any) => sm.studentId === student.id).map((sm: any) => sm.moduleId),
  ]);
  const studentTakesModule = (moduleId: string, classId: string) =>
    db.modules.some((mo: any) => mo.id === moduleId) &&
    (classId === student.classId || enrolledModuleIds.has(moduleId));

  const result: PassedModule[] = [];
  const seenPairs = new Set<string>();
  // Track (module · attempt year · attempt semester) so legacy rows don't
  // duplicate an attempt already represented by assessment marks.
  const periodKeys = new Set<string>();

  asm.forEach((x: any) => {
    const pairKey = `${x.moduleId}|${x.classId}`;
    if (seenPairs.has(pairKey)) return;
    seenPairs.add(pairKey);
    // Skip modules the student doesn't actually take (phantom or other-class).
    if (!studentTakesModule(x.moduleId, x.classId)) return;
    // Skip outdated modules carried over from an old mapping: they have an
    // assessment row but NO actual marks, so they'd show as a blank "F". A real
    // score of 0 is a genuine mark and is kept; only truly-blank scores skip.
    const hasRealMark = asm.some(
      (a: any) =>
        a.moduleId === x.moduleId &&
        a.classId === x.classId &&
        a.rawScore !== null &&
        a.rawScore !== undefined &&
        String(a.rawScore).trim() !== "",
    );
    if (!hasRealMark) return;

    const mod = db.modules.find((mo: any) => mo.id === x.moduleId);
    const cls = db.classes.find((c: any) => c.id === x.classId);
    const classExams = db.exams.filter((e: any) => e.classId === x.classId && e.moduleId === x.moduleId);
    const classAssignments = db.assignments.filter((a: any) => a.classId === x.classId && a.moduleId === x.moduleId);
    const cat = categorizeModuleAssessments(classExams, classAssignments);
    const { moduleMark } = computeStudentModuleMark({
      studentId: student.studentId,
      hasPractical: mod?.hasPractical !== false,
      cat,
      scoreOf,
    });
    const mark = Math.round(moduleMark);
    const curr = currOf(x.moduleId);
    // Display/grouping period from the curriculum; attempt period from the class
    // (used only to identify/order retakes — unchanged from prior behaviour).
    const year = curr?.year ?? cls?.year ?? 0;
    const semester = curr?.semester ?? cls?.semester ?? 0;
    const attemptYear = cls?.year ?? year;
    const attemptSem = cls?.semester ?? semester;
    periodKeys.add(`${x.moduleId}|${attemptYear}|${attemptSem}`);
    result.push({
      moduleId: x.moduleId,
      name: mod?.name || "(module no longer listed)",
      code: mod?.code || x.moduleId,
      mark,
      grade: letterGrade(mark),
      credits: 10,
      year,
      semester,
      attemptYear,
      attemptSem,
    });
  });

  // Preserve legacy `marks` rows not already covered by assessment data. Their
  // display period comes from the curriculum (then class, then the mark row),
  // while the attempt period stays class/mark-based so retakes group as before.
  db.marks
    .filter((m: any) => m.studentId === student.studentId)
    .forEach((m: any) => {
      // Same guard as above — only modules the student actually takes.
      if (!studentTakesModule(m.moduleId, m.classId)) return;
      // Skip legacy rows with no marks at all (all components blank/zero) — these
      // are the outdated old-mapping modules that render as a blank "F".
      const hasAnyLegacyMark = [m.test1, m.test2, m.practTest, m.indAss, m.grpAss, m.finalExam, m.practical].some(
        (v: any) => v !== null && v !== undefined && Number(v) > 0,
      );
      if (!hasAnyLegacyMark) return;
      const cls = db.classes.find((c: any) => c.id === m.classId);
      const curr = currOf(m.moduleId);
      const year = curr?.year ?? cls?.year ?? m.year;
      const semester = curr?.semester ?? cls?.semester ?? m.semester;
      const attemptYear = cls?.year ?? m.year;
      const attemptSem = cls?.semester ?? m.semester;
      if (periodKeys.has(`${m.moduleId}|${attemptYear}|${attemptSem}`)) return;
      const mod = db.modules.find((mo: any) => mo.id === m.moduleId);
      const mark = calcModuleMark(m, mod?.hasPractical !== false);
      result.push({
        moduleId: m.moduleId,
        name: mod?.name || "(module no longer listed)",
        code: mod?.code || m.moduleId,
        mark,
        grade: letterGrade(mark),
        credits: 10,
        year,
        semester,
        attemptYear,
        attemptSem,
      });
    });

  // Order by academic year, then semester, then module code so the transcript
  // sections — and the modules within each — read in a stable, natural order.
  return flagSuperseded(result).sort(
    (a, b) => a.year - b.year || a.semester - b.semester || a.code.localeCompare(b.code),
  );
}
// Signatory block (signature image + "Issued By" name + position) shown near the
// foot of the transcript. Shared by the print window and the on-screen preview so
// they always match. Renders nothing if no signatory has been configured.
function signatoryBlockHTML(issuer?: string, title?: string, signature?: string): string {
  if (!issuer && !title && !signature) return "";
  const sig = signature
    ? `<img src="${signature}" alt="Signature" style="height:56px;max-width:220px;object-fit:contain;display:block;margin:0 auto 2px" />`
    : `<div style="height:56px"></div>`;
  return (
    `<div style="display:flex;justify-content:flex-end;margin:22px 0 6px;page-break-inside:avoid">` +
    `<div style="text-align:center;min-width:230px">` +
    sig +
    `<div style="border-top:1px solid #333;padding-top:4px">` +
    (issuer ? `<div style="font-weight:700;font-size:12px;color:#000">${issuer}</div>` : "") +
    (title ? `<div style="font-size:11px;color:#555">${title}</div>` : "") +
    `<div style="font-size:10px;color:#888;margin-top:2px;font-style:italic">Issued By</div>` +
    `</div></div></div>`
  );
}

// ── Print transcript in a new window ─────────────────────────────────────────
function printTranscript(
  student: any,
  prog: any,
  passedModules: PassedModule[],
  transcriptMeta?: { issuer?: string; title?: string; signature?: string },
) {
  const studyYears = prog?.startYear ? `${prog.startYear}–${prog.startYear + (prog.years || 3)}` : "—";

  const totalCredits = passedModules.filter((m) => !m.superseded).reduce((s, m) => s + m.credits, 0);
  const cumulativeGpa = computeGPA(passedModules);

  const semGroups: Record<string, PassedModule[]> = {};
  passedModules.forEach((m) => {
    const k = `Year ${m.year} · Semester ${m.semester}`;
    if (!semGroups[k]) semGroups[k] = [];
    semGroups[k].push(m);
  });

  // Build the logo URL (absolute so it works in a new window)
  const logoUrl = window.location.origin + "/transcript_logo.png";
  const watermarkUrl = window.location.origin + "/transcript_watermark.svg";

  const semSections = Object.keys(semGroups)
    .map((semKey) => {
      const semGpa = computeGPA(semGroups[semKey]);
      const semCredits = semGroups[semKey].filter((m) => !m.superseded).reduce((s, m) => s + m.credits, 0);
      const rows = semGroups[semKey]
        .map(
          (m, i) => `
      <tr style="background:${i % 2 === 0 ? "#D9D9D9" : "#fff"};${m.superseded ? "color:#999;text-decoration:line-through" : ""}">
        <td style="padding:5px 10px">${m.name}${m.superseded ? ' <span style="font-size:9px;font-style:italic;text-decoration:none">(superseded by retake)</span>' : ""}</td>
        <td style="padding:5px 10px;text-align:center;font-family:monospace;font-size:11px">${m.code}</td>
        <td style="padding:5px 10px;text-align:center;font-weight:700">${m.mark}%</td>
        <td style="padding:5px 10px;text-align:center;font-weight:700">${m.grade}</td>
        <td style="padding:5px 10px;text-align:center">${m.superseded ? "—" : m.credits}</td>
      </tr>`,
        )
        .join("");

      return `
      <div style="margin-bottom:18px">
        <div style="background:#1F3864;color:#fff;padding:6px 12px;font-weight:700;font-size:12px;border-radius:4px 4px 0 0">
          ${semKey}
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead>
            <tr style="background:#002060;color:#fff">
              <th style="padding:6px 10px;text-align:left">Module Names</th>
              <th style="padding:6px 10px;text-align:center">Module Code</th>
              <th style="padding:6px 10px;text-align:center">Marks %</th>
              <th style="padding:6px 10px;text-align:center">Grade</th>
              <th style="padding:6px 10px;text-align:center">Credits</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        <div style="font-size:12px;font-weight:700;display:flex;gap:20px;padding:6px 10px;background:#f4f4f4;border:1px solid #ddd;border-radius:0 0 4px 4px">
          <span>Semester GPA = ${semGpa}</span>
          <span>Credit Hours = ${semCredits * 10} hrs</span>
          <span>Credit Points = ${semCredits} Cr</span>
        </div>
      </div>`;
    })
    .join("");

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8"/>
  <title>Transcript — ${student.name}</title>
  <style>
    /* print-color-adjust:exact everywhere so background colours (the navy footer
       bar, orange contact tiles, table headers, semester bars) actually print —
       browsers strip backgrounds by default, which was blanking the footer. */
    * { margin: 0; padding: 0; box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { font-family: Arial, sans-serif; font-size: 12px; color: #000; background: #fff; padding: 20px 30px; }
    /* Extra bottom margin reserves a per-page strip for the repeating footer. */
    @page { size: A4; margin: 15mm 15mm 34mm 15mm; }
    /* Fixed footer → Chrome repeats it at the bottom of EVERY printed page,
       sitting inside the reserved bottom margin so it never overlaps content. */
    .pfooter { position: fixed; left: 15mm; right: 15mm; bottom: 8mm; z-index: 60; }
    @media print {
      body { padding: 0; }
      .no-print { display: none !important; }
      * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    }
    table { border-collapse: collapse; }
    /* Centered B-monogram watermark. Overlaid ABOVE content (z-index high) and
       fixed so it shows through the opaque table/panel backgrounds and repeats
       on every printed page. pointer-events:none keeps it non-interactive. */
    .watermark {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      height: 78%;
      max-height: 660px;
      opacity: 0.14;
      z-index: 9999;
      pointer-events: none;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    body > *:not(.watermark) { position: relative; z-index: 1; }
  </style>
</head>
<body>
  <!-- Watermark -->
  <img class="watermark" src="${watermarkUrl}" onerror="this.style.display='none'" />

  <!-- Header (logo lockup) -->
  <div style="text-align:center;padding:6px 0 10px;border-bottom:2px solid #C9A227;margin-bottom:6px">
    <img src="${logoUrl}" style="height:120px;max-width:100%;object-fit:contain;display:block;margin:0 auto" onerror="this.style.display='none'" />
    <div style="font-size:14px;color:#16233f;margin-top:6px;font-weight:600;letter-spacing:.3px">Bosswa Culinary Institute of Botswana</div>
  </div>

  <!-- Address / contact line -->
  <div style="text-align:center;font-size:10px;color:#555;margin-bottom:14px">${SCHOOL_CONTACT_LINE}</div>

  <!-- Student info -->
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 32px;margin-bottom:14px;background:#f9f9f9;padding:12px;border-radius:6px;font-size:12px;border-bottom:2px solid #C9A227">
    <div><strong style="color:#002060">Student Name:</strong> ${student.name}</div>
    <div><strong style="color:#002060">Date of Admission:</strong> ${student.enrolmentDate ? formatDate(student.enrolmentDate) : "—"}</div>
    <div><strong style="color:#002060">Student Number:</strong> ${student.studentId}</div>
    <div><strong style="color:#002060">Date of Completion:</strong> ${student.completionDate ? formatDate(student.completionDate) : "—"}</div>
    <div><strong style="color:#002060">ID/Passport No.:</strong> ${student.nationalId || "—"}</div>
    <div><strong style="color:#002060">Program of Study:</strong> ${prog?.name || "—"}</div>
    <div><strong style="color:#002060">Gender:</strong> ${student.gender || "—"}</div>
    <div><strong style="color:#002060">Level:</strong> ${prog?.level ? `Level ${prog.level}` : "—"}</div>
    <div><strong style="color:#002060">Nationality:</strong> ${student.nationality || "—"}</div>
    <div><strong style="color:#002060">Issue Date:</strong> ${todayStr()}</div>
  </div>

  <!-- Modules -->
  ${
    passedModules.length === 0
      ? `<div style="text-align:center;padding:20px;color:#666">No modules on record yet.</div>`
      : semSections
  }

  <!-- Overall summary -->
  ${
    passedModules.length === 0
      ? ""
      : `<div style="display:flex;gap:24px;justify-content:flex-end;align-items:center;background:#002060;color:#fff;padding:8px 16px;border-radius:4px;margin-bottom:14px;font-size:13px;font-weight:700">
          <span>Total Credit Points = ${totalCredits} Cr</span>
          <span>Total Credit Hours = ${totalCredits * 10} hrs</span>
          <span style="font-size:14px">Cumulative GPA = ${cumulativeGpa}</span>
        </div>`
  }

  <!-- Certification -->
  <p style="font-size:12px;color:#555;font-style:italic;margin:14px 0 8px">
    I do hereby self-certify and affirm that this is the official transcript and record of
    <strong>${student.name}</strong> in the academic studies of ${studyYears}.
  </p>

  <!-- Signatory (signature + issued by / position) -->
  ${signatoryBlockHTML(transcriptMeta?.issuer, transcriptMeta?.title, transcriptMeta?.signature)}

  <!-- Grading scale — forced onto the next page (signatory stays on page 1). -->
  <div style="border-top:1px solid #ccc;padding-top:10px;margin-bottom:14px;page-break-before:always">
    <div style="font-size:11px;font-weight:700;color:#002060;margin-bottom:6px">Grading Scale</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap">
      ${GRADE_SCALE.map(
        ([r, d]) =>
          `<div style="font-size:10px;background:#f0f0f0;border:1px solid #ddd;border-radius:4px;padding:3px 10px"><strong>${r}</strong> — ${d}</div>`,
      ).join("")}
    </div>
  </div>

  <!-- Footer / letterhead banner — fixed so it repeats on every printed page. -->
  <div class="pfooter">${footerBannerHTML()}</div>

  <!-- Print button (hidden when printing) -->
  <div class="no-print" style="text-align:center;margin-top:20px">
    <button onclick="window.print()" style="background:#002060;color:#fff;border:none;padding:10px 28px;font-size:14px;border-radius:6px;cursor:pointer;font-family:Arial">
      🖨️ Print / Save as PDF
    </button>
  </div>

  <script>
    // Auto-trigger print dialog after images load
    window.onload = function() { window.print(); };
  </script>
</body>
</html>`;

  const win = window.open("", "_blank", "width=900,height=700");
  if (!win) {
    alert("Pop-up blocked. Please allow pop-ups for this site to print transcripts.");
    return;
  }
  win.document.write(html);
  win.document.close();
}

// ── Pages ──────────────────────────────────────────────────────────────────────

// ── Transcript signatory editor (Issued By / Position) ───────────────────────
// Global setting applied to every transcript, edited from the page header by
// admin & above.
function IssuerSettingsForm() {
  const { db, toast, closeModal, reloadDb } = useApp();
  const [issuerName, setIssuerName] = useState(db.config.transcriptIssuer || "");
  const [issuerTitle, setIssuerTitle] = useState(db.config.transcriptIssuerTitle || "");
  const [saving, setSaving] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [hasSig, setHasSig] = useState(!!db.config.transcriptSignature);

  // Preload the currently-saved signature onto the canvas so the admin can see
  // and keep it (or clear/replace it).
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#111";
    const existing = db.config.transcriptSignature;
    if (existing) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      img.src = existing;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const posOf = (e: any) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const cx = "touches" in e ? e.touches[0].clientX : e.clientX;
    const cy = "touches" in e ? e.touches[0].clientY : e.clientY;
    return { x: (cx - rect.left) * (canvas.width / rect.width), y: (cy - rect.top) * (canvas.height / rect.height) };
  };
  const startDraw = (e: any) => {
    const ctx = canvasRef.current!.getContext("2d")!;
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    const p = posOf(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    drawing.current = true;
  };
  const moveDraw = (e: any) => {
    if (!drawing.current) return;
    e.preventDefault();
    const ctx = canvasRef.current!.getContext("2d")!;
    const p = posOf(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    setHasSig(true);
  };
  const endDraw = () => {
    drawing.current = false;
  };
  const clearSig = () => {
    const c = canvasRef.current;
    if (c) c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    setHasSig(false);
  };
  const uploadSig = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const c = canvasRef.current!;
        const ctx = c.getContext("2d")!;
        ctx.clearRect(0, 0, c.width, c.height);
        // Fit the uploaded image inside the pad, preserving aspect ratio.
        const scale = Math.min(c.width / img.width, c.height / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        ctx.drawImage(img, (c.width - w) / 2, (c.height - h) / 2, w, h);
        setHasSig(true);
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  };

  const save = async () => {
    const configId = (db.config as any)?.id;
    if (!configId) {
      toast("Config record not found", "error");
      return;
    }
    setSaving(true);
    const signature = hasSig && canvasRef.current ? canvasRef.current.toDataURL("image/png") : null;
    const { error } = await supabase
      .from("school_config")
      .update({
        transcript_issuer: issuerName.trim() || null,
        transcript_issuer_title: issuerTitle.trim() || null,
        transcript_signature: signature,
      } as any)
      .eq("id", configId);
    setSaving(false);
    if (error) {
      toast(error.message, "error");
      return;
    }
    toast("Transcript signatory saved!", "success");
    closeModal();
    reloadDb();
  };

  return (
    <div>
      <div className="form-group">
        <label>Issued By</label>
        <input
          className="form-input"
          value={issuerName}
          placeholder="Boisi Dibuile"
          onChange={(e) => setIssuerName(e.target.value)}
        />
      </div>
      <div className="form-group">
        <label>Position</label>
        <input
          className="form-input"
          value={issuerTitle}
          placeholder="Deputy Principal"
          onChange={(e) => setIssuerTitle(e.target.value)}
        />
      </div>
      <div className="form-group">
        <label>Signature</label>
        <div style={{ border: "1px solid var(--border)", borderRadius: 8, background: "#fff", padding: 6 }}>
          <canvas
            ref={canvasRef}
            width={440}
            height={120}
            style={{ width: "100%", height: 120, touchAction: "none", cursor: "crosshair", display: "block", borderRadius: 4 }}
            onMouseDown={startDraw}
            onMouseMove={moveDraw}
            onMouseUp={endDraw}
            onMouseLeave={endDraw}
            onTouchStart={startDraw}
            onTouchMove={moveDraw}
            onTouchEnd={endDraw}
          />
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: "var(--text2)" }}>Draw above, or</span>
          <label className="btn btn-outline btn-sm" style={{ margin: 0, cursor: "pointer" }}>
            <i className="fa-solid fa-upload" style={{ marginRight: 6 }} />
            Upload image
            <input
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={(e) => e.target.files?.[0] && uploadSig(e.target.files[0])}
            />
          </label>
          <button type="button" className="btn btn-outline btn-sm" onClick={clearSig}>
            <i className="fa-solid fa-eraser" style={{ marginRight: 6 }} />
            Clear
          </button>
        </div>
        <div style={{ fontSize: 11, color: "var(--text2)", marginTop: 4 }}>
          Appears above “Issued By” on every printed transcript. A PNG with a transparent (or white) background looks best.
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button className="btn btn-primary" disabled={saving} onClick={save}>
          {saving ? "Saving…" : "Save"}
        </button>
        <button className="btn btn-outline" disabled={saving} onClick={closeModal}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export default function TranscriptsPage() {
  const { db, currentUser, showModal } = useApp();
  const [search, setSearch] = useState("");
  const [classFilter, setClassFilter] = useState("");
  const role = currentUser?.role;
  const canEditIssuer = CAN_EDIT_ISSUER.includes(role || "");

  if (role === "student") {
    const stu = db.students.find((s) => s.studentId === currentUser?.studentId);
    if (!stu)
      return (
        <div className="card" style={{ textAlign: "center", padding: 40 }}>
          Student record not found.
        </div>
      );
    return <TranscriptView stu={stu} />;
  }

  const filtered = db.students.filter(
    (s) =>
      (!classFilter || s.classId === classFilter) &&
      (!search ||
        s.name.toLowerCase().includes(search.toLowerCase()) ||
        s.studentId.toLowerCase().includes(search.toLowerCase())),
  );

  return (
    <>
      <div className="page-header" style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div className="page-title">Student Transcripts</div>
        {canEditIssuer && (
          <button
            className="btn btn-outline btn-sm"
            onClick={() => showModal("Transcript Signatory — Issued By / Position / Signature", <IssuerSettingsForm />)}
          >
            <i className="fa-solid fa-pen" style={{ marginRight: 6 }} />
            Issued By / Position
          </button>
        )}
      </div>
      <div className="card">
        <div className="search-bar" style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <input
            className="search-input"
            placeholder="Search student…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ flex: 1, minWidth: 200 }}
          />
          <select
            className="form-select"
            value={classFilter}
            onChange={(e) => setClassFilter(e.target.value)}
            style={{ maxWidth: 260 }}
          >
            <option value="">All Classes</option>
            {db.classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Student</th>
                <th>Student ID</th>
                <th>Class</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => {
                const cls = db.classes.find((c) => c.id === s.classId);
                return (
                  <tr key={s.id}>
                    <td className="td-name">{s.name}</td>
                    <td style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11 }}>{s.studentId}</td>
                    <td>{cls?.name}</td>
                    <td style={{ display: "flex", gap: 6 }}>
                      <button
                        className="btn btn-outline btn-sm"
                        onClick={() => showModal("Transcript — " + s.name, <TranscriptView stu={s} />, "large")}
                      >
                        <i className="fa-solid fa-eye" /> View
                      </button>
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={async () => {
                          const prog = db.config.programmes.find((p: any) => p.id === s.programme);
                          const passed = await buildPassedModules(db, s);
                          printTranscript(s, prog, passed, {
                            issuer: db.config.transcriptIssuer,
                            title: db.config.transcriptIssuerTitle,
                          });
                        }}
                      >
                        <i className="fa-solid fa-print" /> Print
                      </button>
                    </td>
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

// ── TranscriptView ─────────────────────────────────────────────────────────────
export function TranscriptView({ stu }: { stu: any }) {
  const { db } = useApp();

  const prog = db.config.programmes.find((p: any) => p.id === stu.programme);
  const [passedModules, setPassedModules] = useState<PassedModule[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    buildPassedModules(db, stu).then((mods) => {
      if (!active) return;
      setPassedModules(mods);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [db, stu]);

  const totalCredits = passedModules.filter((m) => !m.superseded).reduce((s, m) => s + m.credits, 0);
  const cumulativeGpa = computeGPA(passedModules);

  const semGroups: Record<string, PassedModule[]> = {};
  passedModules.forEach((m) => {
    const k = `Year ${m.year} · Semester ${m.semester}`;
    if (!semGroups[k]) semGroups[k] = [];
    semGroups[k].push(m);
  });

  const studyYears = prog?.startYear ? `${prog.startYear}–${prog.startYear + (prog.years || 3)}` : "—";

  const handlePrint = () =>
    printTranscript(stu, prog, passedModules, {
      issuer: db.config.transcriptIssuer,
      title: db.config.transcriptIssuerTitle,
      signature: db.config.transcriptSignature,
    });

  // ── On-screen preview ──────────────────────────────────────────────────────
  return (
    <div className="card" style={{ fontFamily: "Arial, sans-serif", position: "relative", overflow: "hidden" }}>
      {/* Watermark — B monogram outline, overlaid above content (matches print) */}
      <img
        src="/transcript_watermark.svg"
        alt=""
        aria-hidden="true"
        onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          height: "78%",
          maxHeight: 660,
          opacity: 0.14,
          pointerEvents: "none",
          zIndex: 5,
        }}
      />
      <div style={{ position: "relative", zIndex: 1 }}>
      {/* Header (logo lockup) */}
      <div style={{ textAlign: "center", padding: "6px 0 10px", borderBottom: "2px solid #C9A227" }}>
        <img
          src="/transcript_logo.png"
          alt="Boswa Culinary Institute of Botswana"
          onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
          style={{ height: 120, maxWidth: "100%", objectFit: "contain", display: "block", margin: "0 auto" }}
        />
        <div style={{ fontSize: 14, color: "#16233f", marginTop: 6, fontWeight: 600, letterSpacing: 0.3 }}>
          Bosswa Culinary Institute of Botswana
        </div>
      </div>

      {/* Address / contact line */}
      <div style={{ textAlign: "center", fontSize: 10, color: "#555", marginTop: 6 }}>
        {SCHOOL_CONTACT_LINE}
      </div>

      {/* Student info grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "4px 32px",
          margin: "14px 0",
          background: "#f9f9f9",
          padding: 12,
          borderRadius: 6,
          fontSize: 12,
          borderBottom: "2px solid #C9A227",
        }}
      >
        {(
          [
            ["Student Name", stu.name],
            ["Date of Admission", stu.enrolmentDate ? formatDate(stu.enrolmentDate) : "—"],
            ["Student Number", stu.studentId],
            ["Date of Completion", stu.completionDate ? formatDate(stu.completionDate) : "—"],
            ["ID/Passport No.", stu.nationalId || "—"],
            ["Program of Study", prog?.name || "—"],
            ["Gender", stu.gender || "—"],
            ["Level", prog?.level ? `Level ${prog.level}` : "—"],
            ["Nationality", stu.nationality || "—"],
            ["Issue Date", todayStr()],
          ] as [string, string][]
        ).map(([label, value]) => (
          <div key={label}>
            <strong style={{ color: "#002060" }}>{label}:</strong> {value}
          </div>
        ))}
      </div>

      {/* Modules by semester */}
      {loading ? (
        <div style={{ textAlign: "center", padding: 20, color: "var(--text2)", fontSize: 12 }}>
          Loading marks…
        </div>
      ) : passedModules.length === 0 ? (
        <div style={{ textAlign: "center", padding: 20, color: "var(--text2)", fontSize: 12 }}>
          No modules on record yet.
        </div>
      ) : (
        Object.keys(semGroups)
          .map((semKey) => (
            <div key={semKey} style={{ marginBottom: 16 }}>
              <div
                style={{
                  background: "#1F3864",
                  color: "#fff",
                  padding: "6px 12px",
                  fontWeight: 700,
                  fontSize: 12,
                  borderRadius: "4px 4px 0 0",
                }}
              >
                {semKey}
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "#002060", color: "#fff" }}>
                    {["Module Names", "Module Code", "Marks %", "Grade", "Credits"].map((h) => (
                      <th
                        key={h}
                        style={{
                          padding: "6px 10px",
                          textAlign: h === "Module Names" ? "left" : "center",
                          fontWeight: 700,
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {semGroups[semKey].map((m, i) => (
                    <tr
                      key={i}
                      style={{
                        background: i % 2 === 0 ? "#D9D9D9" : "#fff",
                        borderBottom: "1px solid #ccc",
                        color: m.superseded ? "#999" : undefined,
                        textDecoration: m.superseded ? "line-through" : undefined,
                      }}
                    >
                      <td style={{ padding: "5px 10px" }}>
                        {m.name}
                        {m.superseded && (
                          <span style={{ fontSize: 9, fontStyle: "italic", textDecoration: "none", marginLeft: 4 }}>
                            (superseded by retake)
                          </span>
                        )}
                      </td>
                      <td style={{ padding: "5px 10px", textAlign: "center", fontFamily: "monospace", fontSize: 11 }}>
                        {m.code}
                      </td>
                      <td style={{ padding: "5px 10px", textAlign: "center", fontWeight: 700 }}>{m.mark}%</td>
                      <td style={{ padding: "5px 10px", textAlign: "center", fontWeight: 700 }}>{m.grade}</td>
                      <td style={{ padding: "5px 10px", textAlign: "center" }}>{m.superseded ? "—" : m.credits}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  display: "flex",
                  gap: 20,
                  padding: "6px 10px",
                  background: "#f4f4f4",
                  border: "1px solid #ddd",
                  borderRadius: "0 0 4px 4px",
                }}
              >
                <span>Semester GPA = {computeGPA(semGroups[semKey])}</span>
                <span>Credit Hours = {semGroups[semKey].filter((m) => !m.superseded).reduce((s, m) => s + m.credits, 0) * 10} hrs</span>
                <span>Credit Points = {semGroups[semKey].filter((m) => !m.superseded).reduce((s, m) => s + m.credits, 0)} Cr</span>
              </div>
            </div>
          ))
      )}

      {/* Overall summary */}
      {passedModules.length > 0 && (
        <div
          style={{
            display: "flex",
            gap: 24,
            justifyContent: "flex-end",
            alignItems: "center",
            background: "#002060",
            color: "#fff",
            padding: "8px 16px",
            borderRadius: 4,
            marginBottom: 14,
            fontSize: 13,
            fontWeight: 700,
          }}
        >
          <span>Total Credit Points = {totalCredits} Cr</span>
          <span>Total Credit Hours = {totalCredits * 10} hrs</span>
          <span style={{ fontSize: 14 }}>Cumulative GPA = {cumulativeGpa}</span>
        </div>
      )}

      {/* Certification */}
      <p style={{ fontSize: 12, color: "#555", fontStyle: "italic", margin: "14px 0 8px" }}>
        I do hereby self-certify and affirm that this is the official transcript and record of{" "}
        <strong>{stu.name}</strong> in the academic studies of {studyYears}.
      </p>

      {/* Signatory (signature + issued by / position) */}
      <div
        dangerouslySetInnerHTML={{
          __html: signatoryBlockHTML(
            db.config.transcriptIssuer,
            db.config.transcriptIssuerTitle,
            db.config.transcriptSignature,
          ),
        }}
      />

      {/* Grading key */}
      <div style={{ borderTop: "1px solid #ccc", paddingTop: 10, marginBottom: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#002060", marginBottom: 6 }}>Grading Scale</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {GRADE_SCALE.map(([r, d]) => (
            <div
              key={r}
              style={{
                fontSize: 10,
                background: "#f0f0f0",
                border: "1px solid #ddd",
                borderRadius: 4,
                padding: "3px 10px",
              }}
            >
              <strong>{r}</strong> — {d}
            </div>
          ))}
        </div>
      </div>

      {/* Footer / letterhead banner — same markup as the printed version */}
      <div style={{ marginTop: 22 }} dangerouslySetInnerHTML={{ __html: footerBannerHTML() }} />

      {/* Print button */}
      <div className="no-print" style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
        <button className="btn btn-primary" onClick={handlePrint}>
          <i className="fa-solid fa-print" style={{ marginRight: 6 }} />
          Print / Save as PDF
        </button>
      </div>
      </div>
    </div>
  );
}
