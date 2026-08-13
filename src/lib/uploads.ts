/**
 * What the app accepts on upload.
 *
 * Before this, none of the academic file inputs carried an `accept` attribute,
 * so the picker offered every file on the machine — executables included — and
 * the only size check was a JavaScript `if` with nothing behind it. The buckets
 * now carry real `file_size_limit` values, so these constants exist to keep the
 * browser-side experience honest about what the server will actually take:
 * rejecting a 30 MB file before the upload starts is kinder than failing
 * halfway.
 *
 * Extensions rather than MIME types, deliberately. Browsers report content
 * types for Office documents inconsistently — a .docx can arrive as
 * application/octet-stream — so a MIME allow-list rejects legitimate
 * coursework. The buckets are left without `allowed_mime_types` for the same
 * reason; this is a usability guard, not a security boundary.
 */

/** Documents and images — coursework, briefs, lecture notes. */
export const ACCEPT_DOCUMENTS =
  '.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.csv,.rtf,.odt,.zip,' +
  '.png,.jpg,.jpeg,.gif,.webp,.heic';

/** Matches the `assignment-files` bucket's file_size_limit. */
export const MAX_ASSIGNMENT_BYTES = 10 * 1024 * 1024;

/** Matches the `module-notes` bucket's file_size_limit. */
export const MAX_NOTE_BYTES = 20 * 1024 * 1024;

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * Returns an error message, or null if the file is acceptable.
 * Checks size and extension — the same two things the bucket enforces.
 */
export function checkUpload(file: File, maxBytes: number): string | null {
  if (file.size > maxBytes) {
    return `"${file.name}" is ${formatBytes(file.size)}. The limit is ${formatBytes(maxBytes)}.`;
  }
  const ext = '.' + (file.name.split('.').pop() || '').toLowerCase();
  if (!ACCEPT_DOCUMENTS.split(',').includes(ext)) {
    return `"${file.name}" is not an accepted file type. Allowed: documents, spreadsheets, presentations, images and zip archives.`;
  }
  return null;
}
