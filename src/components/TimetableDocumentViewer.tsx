/**
 * Read-only renderer for an uploaded timetable.
 *
 * Excel is rendered as a real React table built from the cell values, honouring
 * merged cells — NOT via SheetJS's sheet_to_html. Building the table ourselves
 * means no file-derived HTML is ever injected into the page, and the styling
 * matches the rest of the app.
 *
 * Word has to go through HTML, because a timetable in Word is a table and the
 * plain-text extraction would throw the structure away. Mammoth's output is
 * sanitised before rendering: uploads are admin-only, so the risk is low, but
 * "only an admin can do it" is an access control, not a reason to trust file
 * contents.
 *
 * Nothing here can edit the document. It renders what was uploaded, and the
 * Download button hands over the original file untouched.
 */

import { useEffect, useState } from 'react';
import * as XLSX from 'xlsx';
import mammoth from 'mammoth';
import DOMPurify from 'dompurify';
import { docKind, downloadTimetableBlob, type TimetableDoc } from '@/lib/timetableDocs';

interface Cell { value: string; colSpan: number; rowSpan: number }

/** One sheet, flattened into rows of cells with merges applied. */
function sheetToGrid(sheet: XLSX.WorkSheet): Cell[][] {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    blankrows: false,
    defval: '',
    raw: false,
  }) as unknown[][];

  const grid: Cell[][] = rows.map(r =>
    (r || []).map(v => ({ value: v == null ? '' : String(v), colSpan: 1, rowSpan: 1 })),
  );

  // Merged ranges: the top-left cell spans the block, the rest are removed.
  // Without this a merged "Monday" header would repeat or shift the columns.
  const merges = sheet['!merges'] || [];
  const dropped = new Set<string>();
  for (const m of merges) {
    const { s, e } = m;
    const head = grid[s.r]?.[s.c];
    if (!head) continue;
    head.colSpan = e.c - s.c + 1;
    head.rowSpan = e.r - s.r + 1;
    for (let r = s.r; r <= e.r; r++) {
      for (let c = s.c; c <= e.c; c++) {
        if (r === s.r && c === s.c) continue;
        dropped.add(`${r}:${c}`);
      }
    }
  }

  return grid.map((row, r) => row.filter((_, c) => !dropped.has(`${r}:${c}`)));
}

export default function TimetableDocumentViewer({ doc }: { doc: TimetableDoc }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sheets, setSheets] = useState<{ name: string; grid: Cell[][] }[]>([]);
  const [activeSheet, setActiveSheet] = useState(0);
  const [html, setHtml] = useState<string>('');

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      setSheets([]);
      setHtml('');

      const { blob, error: dlErr } = await downloadTimetableBlob(doc.filePath);
      if (cancelled) return;
      if (dlErr || !blob) {
        setError(dlErr || 'Could not load the timetable file.');
        setLoading(false);
        return;
      }

      try {
        const buffer = await blob.arrayBuffer();
        const kind = docKind(doc.fileName);

        if (kind === 'excel') {
          const wb = XLSX.read(buffer, { type: 'array' });
          const parsed = wb.SheetNames.map(name => ({
            name,
            grid: sheetToGrid(wb.Sheets[name]),
          })).filter(s => s.grid.length > 0);
          if (cancelled) return;
          setSheets(parsed);
          setActiveSheet(0);
        } else if (kind === 'word') {
          const { value } = await mammoth.convertToHtml({ arrayBuffer: buffer });
          if (cancelled) return;
          setHtml(DOMPurify.sanitize(value, { USE_PROFILES: { html: true } }));
        } else {
          setError('This file type cannot be previewed. Use Download to open it.');
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? `Could not read the file: ${err.message}`
              : 'Could not read the file.',
          );
        }
      }
      if (!cancelled) setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [doc.filePath, doc.fileName]);

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--text2)' }}>
        <i className="fa-solid fa-spinner fa-spin" style={{ marginRight: 8 }} />
        Loading timetable…
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: 'var(--text2)' }}>
        <i className="fa-solid fa-triangle-exclamation" style={{ marginRight: 8, color: '#9a6700' }} />
        {error}
      </div>
    );
  }

  // ── Word ────────────────────────────────────────────────────────────────
  if (html) {
    return (
      <div className="timetable-doc" style={{ overflowX: 'auto' }}>
        {/* Sanitised above; uploads are admin-only and the markup is escaped. */}
        <div dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    );
  }

  // ── Excel ───────────────────────────────────────────────────────────────
  if (sheets.length === 0) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: 'var(--text2)' }}>
        This file has no readable content. Use Download to open it.
      </div>
    );
  }

  const sheet = sheets[Math.min(activeSheet, sheets.length - 1)];

  return (
    <div>
      {sheets.length > 1 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
          {sheets.map((s, i) => (
            <button
              key={s.name}
              className={`btn btn-sm ${i === activeSheet ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => setActiveSheet(i)}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}

      <div className="table-wrap" style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
          <tbody>
            {sheet.grid.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => {
                  // Treat the first row as headers — timetables almost always
                  // lead with day or period labels.
                  const isHeader = r === 0;
                  const Tag = (isHeader ? 'th' : 'td') as 'th' | 'td';
                  return (
                    <Tag
                      key={c}
                      colSpan={cell.colSpan > 1 ? cell.colSpan : undefined}
                      rowSpan={cell.rowSpan > 1 ? cell.rowSpan : undefined}
                      style={{
                        border: '1px solid var(--border)',
                        padding: '6px 10px',
                        textAlign: 'left',
                        verticalAlign: 'top',
                        whiteSpace: 'pre-wrap',
                        background: isHeader ? 'var(--bg2)' : undefined,
                        fontWeight: isHeader ? 700 : undefined,
                      }}
                    >
                      {cell.value}
                    </Tag>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
