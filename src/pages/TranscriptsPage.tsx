import { useState } from "react";
import { useApp } from "@/context/AppContext";
import { calcModuleMark } from "@/data/db";

// Load docx from CDN via script tag (UMD build sets window.docx)
let _docxLoading: Promise<any> | null = null;
function getDocx(): Promise<any> {
  if ((window as any).docx) return Promise.resolve((window as any).docx);
  if (_docxLoading) return _docxLoading;
  _docxLoading = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.umd.js";
    script.onload = () => resolve((window as any).docx);
    script.onerror = reject;
    document.head.appendChild(script);
  });
  return _docxLoading;
}

// ── Grading ───────────────────────────────────────────────────────────────────
function transcriptGrade(pct: number): string {
  if (pct >= 80) return "Distinction";
  if (pct >= 65) return "Pass with Credit";
  if (pct >= 50) return "Pass";
  return "Fail";
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

// ── Fetch images as ArrayBuffer ───────────────────────────────────────────────
async function fetchImage(path: string): Promise<ArrayBuffer> {
  const res = await fetch(path);
  return res.arrayBuffer();
}

// ── DOCX builder ──────────────────────────────────────────────────────────────
interface PassedModule {
  name: string;
  code: string;
  mark: number;
  grade: string;
  credits: number;
  year: number;
  semester: number;
}

async function buildTranscriptDocx(student: any, programme: any, passedModules: PassedModule[]): Promise<Blob> {
  // Load docx library and images in parallel
  const [docxMod, logoData, footerData] = await Promise.all([
    getDocx(),
    fetchImage("/transcript_logo.png"),
    fetchImage("/transcript_footer.png"),
  ]);

  const {
    Document,
    Packer,
    Paragraph,
    TextRun,
    Table,
    TableRow,
    TableCell,
    AlignmentType,
    BorderStyle,
    WidthType,
    ShadingType,
    VerticalAlign,
    ImageRun,
    Header,
    Footer,
  } = docxMod;

  // ── Constants ──────────────────────────────────────────────────────────────
  const DARK_BLUE = "002060";
  const MID_BLUE = "1F3864";
  const GOLD = "C9A227";
  const LIGHT_GREY = "D9D9D9";
  const WHITE = "FFFFFF";

  const A4_W = 11906;
  const A4_H = 16838;
  const MARGIN = 1080;
  const CONTENT_W = A4_W - MARGIN * 2; // 9746

  const NO_BDR = { style: BorderStyle.NONE, size: 0, color: WHITE };
  const THIN = { style: BorderStyle.SINGLE, size: 4, color: "AAAAAA" };
  const noBorders = { top: NO_BDR, bottom: NO_BDR, left: NO_BDR, right: NO_BDR };
  const thinBorders = { top: THIN, bottom: THIN, left: THIN, right: THIN };
  const hdrBdr = { style: BorderStyle.SINGLE, size: 4, color: WHITE };
  const hdrBorders = { top: hdrBdr, bottom: hdrBdr, left: hdrBdr, right: hdrBdr };

  const R = (text: string, opts: any = {}) => new TextRun({ text, font: "Arial", size: 20, ...opts });
  const RB = (text: string, opts: any = {}) => R(text, { bold: true, ...opts });

  const sp = (before = 0, after = 0) => new Paragraph({ spacing: { before, after }, children: [] });

  // ── Header section (logo centered) ────────────────────────────────────────
  const docHeader = new Header({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 0 },
        children: [
          new ImageRun({
            data: logoData,
            transformation: { width: 101, height: 70 },
            type: "png",
          } as any),
        ],
      }),
    ],
  });

  // ── Footer section (full-width contact banner) ────────────────────────────
  const docFooter = new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 0 },
        indent: { left: -1080, right: -1080 },
        children: [
          new ImageRun({
            data: footerData,
            transformation: { width: 793, height: 70 },
            type: "png",
          } as any),
        ],
      }),
    ],
  });

  // ── Helper: make a table cell ─────────────────────────────────────────────
  const mkCell = (content: string | string[], w: number, opts: any = {}) => {
    const lines = Array.isArray(content) ? content : [content];
    return new TableCell({
      borders: opts.borders || noBorders,
      shading: opts.fill ? { fill: opts.fill, type: ShadingType.CLEAR } : undefined,
      width: { size: w, type: WidthType.DXA },
      margins: { top: opts.padV || 80, bottom: opts.padV || 80, left: 120, right: 120 },
      verticalAlign: opts.vAlign || VerticalAlign.CENTER,
      columnSpan: opts.span,
      children: lines.map(
        (line) =>
          new Paragraph({
            alignment: opts.align || AlignmentType.LEFT,
            children: [
              opts.bold
                ? RB(line, { size: opts.size || 20, color: opts.color || "000000" })
                : R(line, { size: opts.size || 20, color: opts.color || "000000" }),
            ],
          }),
      ),
    });
  };

  // ── Title header table (dark blue band) ───────────────────────────────────
  const titleTable = new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: [CONTENT_W],
    borders: {
      top: NO_BDR,
      left: NO_BDR,
      right: NO_BDR,
      insideH: NO_BDR,
      insideV: NO_BDR,
      bottom: { style: BorderStyle.SINGLE, size: 12, color: GOLD },
    },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            borders: noBorders,
            shading: { fill: DARK_BLUE, type: ShadingType.CLEAR },
            width: { size: CONTENT_W, type: WidthType.DXA },
            margins: { top: 160, bottom: 160, left: 200, right: 200 },
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [RB("BOSSWA CULINARY INSTITUTE OF BOTSWANA", { size: 32, color: WHITE })],
              }),
              new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { before: 60 },
                children: [R("Official Academic Transcript", { size: 22, color: GOLD, italics: true })],
              }),
            ],
          }),
        ],
      }),
    ],
  });

  // ── Student info table (2-column) ─────────────────────────────────────────
  const COL_L = Math.round(CONTENT_W * 0.5);
  const COL_R = CONTENT_W - COL_L;

  const infoRow = (lLabel: string, lVal: string, rLabel: string, rVal: string) =>
    new TableRow({
      children: [
        new TableCell({
          borders: noBorders,
          width: { size: COL_L, type: WidthType.DXA },
          margins: { top: 60, bottom: 60, left: 80, right: 80 },
          children: [
            new Paragraph({ children: [RB(lLabel + " : ", { size: 19, color: DARK_BLUE }), R(lVal, { size: 19 })] }),
          ],
        }),
        new TableCell({
          borders: noBorders,
          width: { size: COL_R, type: WidthType.DXA },
          margins: { top: 60, bottom: 60, left: 80, right: 80 },
          children: [
            new Paragraph({ children: [RB(rLabel + " : ", { size: 19, color: DARK_BLUE }), R(rVal, { size: 19 })] }),
          ],
        }),
      ],
    });

  const issueDate = todayStr();
  const studyYears = programme?.startYear
    ? `${programme.startYear}–${programme.startYear + (programme.years || 3)}`
    : "—";

  const studentInfoTable = new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: [COL_L, COL_R],
    borders: {
      top: NO_BDR,
      left: NO_BDR,
      right: NO_BDR,
      insideH: NO_BDR,
      insideV: NO_BDR,
      bottom: { style: BorderStyle.SINGLE, size: 6, color: GOLD },
    },
    rows: [
      infoRow("Student Name", student.name, "Date of Admission", formatDate(student.dob)),
      infoRow("Student Number", student.studentId, "Date of Completion", "—"),
      infoRow("ID/Passport No.", student.nationalId || "—", "Program of Study", programme?.name || "—"),
      infoRow("Gender", student.gender || "—", "Level", programme?.level ? `Level ${programme.level}` : "—"),
      infoRow("Nationality", "Motswana", "Issue Date", issueDate),
    ],
  });

  // ── Semester heading bar ───────────────────────────────────────────────────
  const semHeading = (label: string) =>
    new Table({
      width: { size: CONTENT_W, type: WidthType.DXA },
      columnWidths: [CONTENT_W],
      rows: [
        new TableRow({
          children: [
            new TableCell({
              borders: noBorders,
              shading: { fill: MID_BLUE, type: ShadingType.CLEAR },
              width: { size: CONTENT_W, type: WidthType.DXA },
              margins: { top: 100, bottom: 100, left: 160, right: 160 },
              children: [
                new Paragraph({
                  children: [RB(label, { size: 22, color: WHITE })],
                }),
              ],
            }),
          ],
        }),
      ],
    });

  // ── Module table ───────────────────────────────────────────────────────────
  const modColW = [
    Math.round(CONTENT_W * 0.44),
    Math.round(CONTENT_W * 0.22),
    Math.round(CONTENT_W * 0.1),
    Math.round(CONTENT_W * 0.1),
    CONTENT_W - Math.round(CONTENT_W * 0.44) - Math.round(CONTENT_W * 0.22) - Math.round(CONTENT_W * 0.1) * 2,
  ];

  const modHeaderRow = new TableRow({
    tableHeader: true,
    children: [
      ["Module Names", "Module Code", "Marks %", "Grade", "Credits"].map(
        (h, i) =>
          new TableCell({
            borders: hdrBorders,
            shading: { fill: DARK_BLUE, type: ShadingType.CLEAR },
            width: { size: modColW[i], type: WidthType.DXA },
            margins: { top: 100, bottom: 100, left: 120, right: 120 },
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [RB(h, { size: 20, color: WHITE })],
              }),
            ],
          }),
      ),
    ],
  });

  // Group modules by year+semester
  const semGroups: Record<string, PassedModule[]> = {};
  passedModules.forEach((m) => {
    const k = `Year ${m.year} Semester ${m.semester}`;
    if (!semGroups[k]) semGroups[k] = [];
    semGroups[k].push(m);
  });

  const buildModuleTable = (items: PassedModule[]) => {
    const rows: any[] = [modHeaderRow];
    items.forEach((m, i) => {
      const shd = i % 2 === 0 ? { fill: LIGHT_GREY, type: ShadingType.CLEAR } : undefined;
      const cc: any = { borders: thinBorders, shading: shd };
      const dataCell = (text: string, w: number, align = AlignmentType.LEFT, bold = false) =>
        new TableCell({
          ...cc,
          width: { size: w, type: WidthType.DXA },
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
          children: [
            new Paragraph({
              alignment: align,
              children: [bold ? RB(text, { size: 19 }) : R(text, { size: 19 })],
            }),
          ],
        });
      rows.push(
        new TableRow({
          children: [
            dataCell(m.name, modColW[0]),
            dataCell(m.code || "—", modColW[1]),
            dataCell(`${m.mark}%`, modColW[2], AlignmentType.CENTER, true),
            dataCell(m.grade, modColW[3], AlignmentType.CENTER, true),
            dataCell(`${m.credits}`, modColW[4], AlignmentType.CENTER),
          ],
        }),
      );
    });
    return new Table({
      width: { size: CONTENT_W, type: WidthType.DXA },
      columnWidths: modColW,
      rows,
    });
  };

  // ── Totals helper ──────────────────────────────────────────────────────────
  const totalCredits = passedModules.reduce((s, m) => s + (m.credits || 10), 0);
  const totalHours = totalCredits * 10;

  // Simple GPA from mark averages
  const avgMark = passedModules.length
    ? Math.round(passedModules.reduce((s, m) => s + m.mark, 0) / passedModules.length)
    : 0;
  const gpa = passedModules.length
    ? avgMark >= 80
      ? "4.00"
      : avgMark >= 65
        ? "3.50"
        : avgMark >= 50
          ? "3.00"
          : "0.00"
    : "—";

  const totalRow = (text: string, fill: string) =>
    new Table({
      width: { size: CONTENT_W, type: WidthType.DXA },
      columnWidths: [CONTENT_W],
      rows: [
        new TableRow({
          children: [
            new TableCell({
              borders: thinBorders,
              shading: { fill, type: ShadingType.CLEAR },
              width: { size: CONTENT_W, type: WidthType.DXA },
              margins: { top: 60, bottom: 60, left: 120, right: 120 },
              children: [new Paragraph({ children: [RB(text, { size: 19 })] })],
            }),
          ],
        }),
      ],
    });

  // ── Grading scale table ────────────────────────────────────────────────────
  const gsColW = [Math.round(CONTENT_W * 0.3), CONTENT_W - Math.round(CONTENT_W * 0.3)];
  const gradeScaleTable = new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: gsColW,
    rows: [
      new TableRow({
        children: [
          mkCell("Grade (%)", gsColW[0], {
            fill: MID_BLUE,
            bold: true,
            size: 19,
            color: WHITE,
            borders: hdrBorders,
            align: AlignmentType.CENTER,
          }),
          mkCell("Description", gsColW[1], {
            fill: MID_BLUE,
            bold: true,
            size: 19,
            color: WHITE,
            borders: hdrBorders,
            align: AlignmentType.CENTER,
          }),
        ],
      }),
      new TableRow({
        children: [
          mkCell("80 – 100%", gsColW[0], {
            fill: LIGHT_GREY,
            borders: thinBorders,
            bold: true,
            size: 19,
            align: AlignmentType.CENTER,
          }),
          mkCell("Distinction", gsColW[1], { fill: LIGHT_GREY, borders: thinBorders, size: 19 }),
        ],
      }),
      new TableRow({
        children: [
          mkCell("65 – 79%", gsColW[0], { borders: thinBorders, bold: true, size: 19, align: AlignmentType.CENTER }),
          mkCell("Pass with Credit", gsColW[1], { borders: thinBorders, size: 19 }),
        ],
      }),
      new TableRow({
        children: [
          mkCell("50 – 64%", gsColW[0], {
            fill: LIGHT_GREY,
            borders: thinBorders,
            bold: true,
            size: 19,
            align: AlignmentType.CENTER,
          }),
          mkCell("Pass", gsColW[1], { fill: LIGHT_GREY, borders: thinBorders, size: 19 }),
        ],
      }),
      new TableRow({
        children: [
          mkCell("0 – 49%", gsColW[0], { borders: thinBorders, bold: true, size: 19, align: AlignmentType.CENTER }),
          mkCell("Fail", gsColW[1], { borders: thinBorders, size: 19 }),
        ],
      }),
    ],
  });

  // ── Award classification table ─────────────────────────────────────────────
  const awColW = [
    Math.round(CONTENT_W * 0.3),
    Math.round(CONTENT_W * 0.2),
    CONTENT_W - Math.round(CONTENT_W * 0.3) - Math.round(CONTENT_W * 0.2),
  ];

  const awMulti = (lines: string[], w: number, fill?: string) =>
    new TableCell({
      borders: thinBorders,
      shading: fill ? { fill, type: ShadingType.CLEAR } : undefined,
      width: { size: w, type: WidthType.DXA },
      margins: { top: 60, bottom: 60, left: 120, right: 120 },
      children: lines.map((l) => new Paragraph({ children: [R(l, { size: 18 })] })),
    });

  const awardTable = new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: awColW,
    rows: [
      new TableRow({
        children: ["Award", "Classification", "Remarks"].map((h, i) =>
          mkCell(h, awColW[i], {
            fill: MID_BLUE,
            bold: true,
            size: 19,
            color: WHITE,
            borders: hdrBorders,
            align: AlignmentType.CENTER,
          }),
        ),
      }),
      new TableRow({
        children: [
          awMulti(["Short courses (HRDC)", "Distinction", "Pass with merit", "Pass", "Fail"], awColW[0], LIGHT_GREY),
          awMulti(["", "3.75-4.00", "2.75-3.74", "2.00-2.74", "Below 2.00"], awColW[1], LIGHT_GREY),
          awMulti(
            ["", "An award is confirmed by official transcript and a Certificate letter."],
            awColW[2],
            LIGHT_GREY,
          ),
        ],
      }),
      new TableRow({
        children: [
          awMulti(["Certificate", "Distinction", "Pass with merit", "Pass", "Fail"], awColW[0]),
          awMulti(["", "3.75-4.00", "2.75-3.74", "2.00-2.74", "Below 2.00"], awColW[1]),
          awMulti(
            ["", "An award is confirmed by official transcript, Certificate and student confirmation letter."],
            awColW[2],
          ),
        ],
      }),
      new TableRow({
        children: [
          awMulti(["Diploma", "Distinction", "Pass with merit", "Pass", "Fail"], awColW[0], LIGHT_GREY),
          awMulti(["", "3.75-4.00", "2.75-3.74", "2.00-2.74", "Below 2.00"], awColW[1], LIGHT_GREY),
          awMulti(
            ["", "An award is confirmed by official transcript, diploma and Reference/confirmation letter."],
            awColW[2],
            LIGHT_GREY,
          ),
        ],
      }),
    ],
  });

  // ── Certification + signature ──────────────────────────────────────────────
  const certText = `I do hereby self-certify and affirm that this is the official transcript and record of ${student.name} in the academic studies of ${studyYears}.`;

  // ── Assemble body ──────────────────────────────────────────────────────────
  const bodyChildren: any[] = [titleTable, sp(140, 100), studentInfoTable, sp(120, 80)];

  // One section per year/semester, each with its own heading + table
  Object.keys(semGroups)
    .sort()
    .forEach((semKey) => {
      bodyChildren.push(semHeading(semKey), sp(80, 40));
      bodyChildren.push(buildModuleTable(semGroups[semKey]), sp(40, 40));
      bodyChildren.push(
        totalRow(`GPA = ${gpa}`, LIGHT_GREY),
        totalRow(`Total Credit Hours = ${totalHours} hours`, WHITE),
        totalRow(`Total Credit Points = ${totalCredits} Cr`, LIGHT_GREY),
      );
      bodyChildren.push(sp(100, 60));
    });

  // Certification
  bodyChildren.push(
    new Paragraph({
      alignment: AlignmentType.LEFT,
      spacing: { before: 60, after: 60 },
      children: [R(certText, { size: 19, italics: true, color: "333333" })],
    }),
    sp(80, 60),
    new Paragraph({ spacing: { before: 0, after: 0 }, children: [RB("Issued By: "), R("Boisi Dibuile")] }),
    new Paragraph({ spacing: { before: 0, after: 0 }, children: [RB("Position   : "), R("Deputy Principal")] }),
    new Paragraph({ spacing: { before: 0, after: 0 }, children: [RB("Date         : "), R(issueDate)] }),
    sp(160, 80),
    new Paragraph({
      spacing: { before: 0, after: 60 },
      children: [RB("Award Classification", { size: 22, color: DARK_BLUE })],
    }),
    gradeScaleTable,
    sp(100, 60),
    awardTable,
    sp(60, 0),
  );

  // ── Build document ─────────────────────────────────────────────────────────
  const doc = new Document({
    styles: { default: { document: { run: { font: "Arial", size: 20 } } } },
    sections: [
      {
        properties: {
          page: {
            size: { width: A4_W, height: A4_H },
            margin: { top: MARGIN, right: MARGIN, bottom: 1440, left: MARGIN },
          },
        },
        headers: { default: docHeader },
        footers: { default: docFooter },
        children: bodyChildren,
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  return new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}

// ── Pages ──────────────────────────────────────────────────────────────────────

export default function TranscriptsPage() {
  const { db, currentUser, showModal } = useApp();
  const [search, setSearch] = useState("");
  const role = currentUser?.role;

  if (role === "student") {
    const stu = db.students.find(
      (s) =>
        s.studentId === currentUser?.studentId ||
        s.name.split(" ")[0].toLowerCase() === (currentUser?.name || "").split(" ")[0].toLowerCase(),
    );
    if (!stu)
      return (
        <div className="card" style={{ textAlign: "center", padding: 40 }}>
          Student record not found.
        </div>
      );
    return <TranscriptView stu={stu} />;
  }

  const filtered = db.students.filter((s) => !search || s.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <>
      <div className="page-header">
        <div className="page-title">Student Transcripts</div>
      </div>
      <div className="card">
        <div className="search-bar">
          <input
            className="search-input"
            placeholder="Search student…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
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
                    <td>
                      <button
                        className="btn btn-outline btn-sm"
                        onClick={() => showModal("Transcript — " + s.name, <TranscriptView stu={s} />, "large")}
                      >
                        <i className="fa-solid fa-eye" /> View
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
  const [downloading, setDownloading] = useState(false);

  const prog = db.config.programmes.find((p: any) => p.id === stu.programme);
  const cls = db.classes.find((c: any) => c.id === stu.classId);
  const allMarks = db.marks.filter((m: any) => m.studentId === stu.studentId);

  const passedModules: PassedModule[] = allMarks
    .map((m: any) => {
      const mod = db.modules.find((mo: any) => mo.id === m.moduleId);
      const mark = calcModuleMark(m);
      return { mark, module: mod, markRecord: m };
    })
    .filter((x) => x.mark >= 50 && x.module)
    .map((x) => ({
      name: x.module.name as string,
      code: x.module.code as string,
      mark: x.mark,
      grade: transcriptGrade(x.mark),
      credits: 10,
      year: x.markRecord.year as number,
      semester: x.markRecord.semester as number,
    }));

  const totalCredits = passedModules.reduce((s, m) => s + m.credits, 0);
  const avgMark = passedModules.length
    ? Math.round(passedModules.reduce((s, m) => s + m.mark, 0) / passedModules.length)
    : 0;
  const gpa = passedModules.length
    ? avgMark >= 80
      ? "4.00"
      : avgMark >= 65
        ? "3.50"
        : avgMark >= 50
          ? "3.00"
          : "0.00"
    : "—";

  const semGroups: Record<string, PassedModule[]> = {};
  passedModules.forEach((m) => {
    const k = `Year ${m.year} · Semester ${m.semester}`;
    if (!semGroups[k]) semGroups[k] = [];
    semGroups[k].push(m);
  });

  const studyYears = prog?.startYear ? `${prog.startYear}–${prog.startYear + (prog.years || 3)}` : "—";

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const blob = await buildTranscriptDocx(stu, prog, passedModules);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Transcript_${stu.name.replace(/\s+/g, "_")}_${new Date().toISOString().split("T")[0]}.docx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      alert("Download failed. Please try again.");
    } finally {
      setDownloading(false);
    }
  };

  // ── On-screen preview ──────────────────────────────────────────────────────
  return (
    <div className="card" style={{ fontFamily: "Arial, sans-serif" }}>
      {/* Title band */}
      <div
        style={{
          background: "#002060",
          borderRadius: 6,
          padding: "14px 20px",
          textAlign: "center",
          marginBottom: 0,
          borderBottom: "3px solid #C9A227",
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 800, color: "#fff", letterSpacing: 0.5 }}>
          BOSSWA CULINARY INSTITUTE OF BOTSWANA
        </div>
        <div style={{ fontSize: 13, color: "#C9A227", marginTop: 4, fontStyle: "italic" }}>
          Official Academic Transcript
        </div>
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
            ["Date of Admission", formatDate(stu.dob)],
            ["Student Number", stu.studentId],
            ["Date of Completion", "—"],
            ["ID/Passport No.", stu.nationalId || "—"],
            ["Program of Study", prog?.name || "—"],
            ["Gender", stu.gender || "—"],
            ["Level", prog?.level ? `Level ${prog.level}` : "—"],
            ["Nationality", "Motswana"],
            ["Issue Date", todayStr()],
          ] as [string, string][]
        ).map(([label, value]) => (
          <div key={label}>
            <strong style={{ color: "#002060" }}>{label}:</strong> {value}
          </div>
        ))}
      </div>

      {/* Modules by semester */}
      {passedModules.length === 0 ? (
        <div style={{ textAlign: "center", padding: 20, color: "var(--text2)", fontSize: 12 }}>
          No passed modules on record yet.
        </div>
      ) : (
        Object.keys(semGroups)
          .sort()
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
                      style={{ background: i % 2 === 0 ? "#D9D9D9" : "#fff", borderBottom: "1px solid #ccc" }}
                    >
                      <td style={{ padding: "5px 10px" }}>{m.name}</td>
                      <td style={{ padding: "5px 10px", textAlign: "center", fontFamily: "monospace", fontSize: 11 }}>
                        {m.code}
                      </td>
                      <td style={{ padding: "5px 10px", textAlign: "center", fontWeight: 700 }}>{m.mark}%</td>
                      <td style={{ padding: "5px 10px", textAlign: "center", fontWeight: 700 }}>{m.grade}</td>
                      <td style={{ padding: "5px 10px", textAlign: "center" }}>{m.credits}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {/* Totals */}
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  display: "flex",
                  gap: 20,
                  marginTop: 6,
                  padding: "6px 10px",
                  background: "#f4f4f4",
                  border: "1px solid #ddd",
                  borderRadius: "0 0 4px 4px",
                }}
              >
                <span>GPA = {gpa}</span>
                <span>Total Credit Hours = {totalCredits * 10} hrs</span>
                <span>Total Credit Points = {totalCredits} Cr</span>
              </div>
            </div>
          ))
      )}

      {/* Certification */}
      <p style={{ fontSize: 12, color: "#555", fontStyle: "italic", margin: "14px 0 8px" }}>
        I do hereby self-certify and affirm that this is the official transcript and record of{" "}
        <strong>{stu.name}</strong> in the academic studies of {studyYears}.
      </p>
      <div style={{ fontSize: 12, marginBottom: 14 }}>
        <div>
          <strong>Issued By:</strong> Boisi Dibuile
        </div>
        <div>
          <strong>Position:</strong> Deputy Principal
        </div>
        <div>
          <strong>Date:</strong> {todayStr()}
        </div>
      </div>

      {/* Grading key */}
      <div style={{ borderTop: "1px solid #ccc", paddingTop: 10, marginBottom: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#002060", marginBottom: 6 }}>Grading Scale</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {[
            ["80–100%", "Distinction"],
            ["65–79%", "Pass with Credit"],
            ["50–64%", "Pass"],
            ["0–49%", "Fail"],
          ].map(([r, d]) => (
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

      {/* Download button */}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button className="btn btn-primary" onClick={handleDownload} disabled={downloading}>
          <i className="fa-solid fa-file-word" style={{ marginRight: 6 }} />
          {downloading ? "Generating..." : "Download Transcript (.docx)"}
        </button>
      </div>
    </div>
  );
}
