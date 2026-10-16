/**
 * Bulk student import: the template, parsing an uploaded sheet, and checking
 * each row before anything is written.
 *
 * Rows are validated up front and shown to the person importing, so a bad
 * row is fixed in the spreadsheet rather than discovered half-way through an
 * import. Only rows with no errors are written, in a single insert.
 */

import * as XLSX from 'xlsx-js-style';

import type { DB } from '@/data/db';

/** Column headings, in template order. The first two are required. */
export const IMPORT_COLUMNS = [
  'Student ID', 'Full Name', 'Gender', 'Date of Birth', 'Nationality', 'National ID',
  'Mobile', 'Email', 'Guardian Name', 'Guardian Mobile', 'Guardian Email', 'Class', 'Enrolment Date',
] as const;

export const IMPORT_ERRORS = {
  missingId: 'Student ID is required',
  missingName: 'Full name is required',
  duplicateInFile: 'Student ID appears more than once in this file',
  existingId: 'A student with this ID already exists',
  unknownClass: 'Class not found — use the class name exactly as it appears in the system',
  badDate: 'Dates must be YYYY-MM-DD',
  badGender: 'Gender must be Female, Male or Other',
} as const;

export interface ImportRow {
  line: number;
  studentId: string;
  name: string;
  gender: string;
  dob: string;
  nationality: string;
  nationalId: string;
  mobile: string;
  email: string;
  guardian: string;
  guardianMobile: string;
  guardianEmail: string;
  className: string;
  classId: string | null;
  enrolmentDate: string;
  errors: string[];
}

export function downloadImportTemplate() {
  const ws = XLSX.utils.aoa_to_sheet([
    [...IMPORT_COLUMNS],
    ['BCI2026D-99', 'Example Student', 'Female', '2005-03-14', 'Motswana', '123456789',
     '71234567', 'student@example.com', 'Parent Name', '72345678', 'parent@example.com', '', '2026-01-15'],
  ]);
  IMPORT_COLUMNS.forEach((_, c) => {
    const ref = XLSX.utils.encode_cell({ r: 0, c });
    ws[ref].s = { font: { bold: true, color: { rgb: 'FFFFFF' } }, fill: { patternType: 'solid', fgColor: { rgb: '3D0000' } } } as XLSX.CellStyle;
  });
  ws['!cols'] = IMPORT_COLUMNS.map(h => ({ wch: Math.max(14, h.length + 4) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Students');
  XLSX.writeFile(wb, 'student-import-template.xlsx');
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Excel stores dates as serial numbers; normalise either form to YYYY-MM-DD. */
function toIsoDate(v: unknown): string {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'number') {
    const d = XLSX.SSF.parse_date_code(v);
    if (d) return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
  }
  return String(v).trim();
}

const text = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());

/** Read the first sheet of an .xlsx / .xls / .csv file into checked rows. */
export async function parseImportFile(file: File, db: DB): Promise<ImportRow[]> {
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '', raw: true });

  // Match headings loosely: case and spacing don't matter.
  const norm = (h: string) => h.toLowerCase().replace(/[^a-z]/g, '');
  const get = (r: Record<string, unknown>, col: string) => {
    const key = Object.keys(r).find(k => norm(k) === norm(col));
    return key ? r[key] : '';
  };

  const existingIds = new Set(db.students.map(s => s.studentId.trim().toLowerCase()));
  const classByName = new Map(db.classes.map(c => [c.name.trim().toLowerCase(), c.id]));
  const seen = new Map<string, number>();

  const rows: ImportRow[] = raw
    .map((r, i) => {
      const className = text(get(r, 'Class'));
      const genderRaw = text(get(r, 'Gender'));
      const gender = genderRaw ? genderRaw.charAt(0).toUpperCase() + genderRaw.slice(1).toLowerCase() : 'Female';
      return {
        line: i + 2,
        studentId: text(get(r, 'Student ID')),
        name: text(get(r, 'Full Name')),
        gender,
        dob: toIsoDate(get(r, 'Date of Birth')),
        nationality: text(get(r, 'Nationality')) || 'Motswana',
        nationalId: text(get(r, 'National ID')),
        mobile: text(get(r, 'Mobile')),
        email: text(get(r, 'Email')),
        guardian: text(get(r, 'Guardian Name')),
        guardianMobile: text(get(r, 'Guardian Mobile')),
        guardianEmail: text(get(r, 'Guardian Email')),
        className,
        classId: className ? classByName.get(className.toLowerCase()) ?? null : null,
        enrolmentDate: toIsoDate(get(r, 'Enrolment Date')),
        errors: [] as string[],
      };
    })
    // Skip rows that are entirely blank.
    .filter(r => r.studentId || r.name);

  rows.forEach(r => seen.set(r.studentId.toLowerCase(), (seen.get(r.studentId.toLowerCase()) || 0) + 1));

  rows.forEach(r => {
    if (!r.studentId) r.errors.push(IMPORT_ERRORS.missingId);
    if (!r.name) r.errors.push(IMPORT_ERRORS.missingName);
    if (r.studentId && (seen.get(r.studentId.toLowerCase()) || 0) > 1) r.errors.push(IMPORT_ERRORS.duplicateInFile);
    if (r.studentId && existingIds.has(r.studentId.toLowerCase())) r.errors.push(IMPORT_ERRORS.existingId);
    if (r.className && !r.classId) r.errors.push(IMPORT_ERRORS.unknownClass);
    if ((r.dob && !DATE_RE.test(r.dob)) || (r.enrolmentDate && !DATE_RE.test(r.enrolmentDate))) r.errors.push(IMPORT_ERRORS.badDate);
    if (!['Female', 'Male', 'Other'].includes(r.gender)) r.errors.push(IMPORT_ERRORS.badGender);
  });
  return rows;
}

/** The students-table row for a checked import row. */
export function toStudentInsert(r: ImportRow, db: DB, index: number) {
  const cls = db.classes.find(c => c.id === r.classId);
  return {
    id: `s${Date.now()}${String(index).padStart(3, '0')}`,
    student_id: r.studentId,
    name: r.name,
    gender: r.gender,
    dob: r.dob || null,
    mobile: r.mobile,
    email: r.email,
    national_id: r.nationalId,
    nationality: r.nationality,
    class_id: r.classId,
    guardian: r.guardian,
    guardian_email: r.guardianEmail,
    guardian_mobile: r.guardianMobile,
    programme: cls?.programme || '',
    year: cls?.year || 1,
    semester: cls?.semester || 1,
    status: 'active',
    enrolment_date: r.enrolmentDate || null,
  };
}

/** Photo file name (without extension) → student, matched on the student number. */
export function matchPhotoToStudent(fileName: string, db: DB) {
  const base = fileName.replace(/\.[^.]+$/, '').trim().toLowerCase();
  return db.students.find(s => s.studentId.trim().toLowerCase() === base) || null;
}
