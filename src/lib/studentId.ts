/**
 * Normalise a student number.
 *
 * A student ID typed with a stray space is a DIFFERENT string to the database,
 * and assessment_marks keys on this value rather than on students.id. So one
 * space entered at registration detaches a student from their own marks — they
 * see nothing, progression sees nothing, and the marks sit under an ID that
 * matches no student. Migration 20260812180000 repaired the rows this had
 * already produced.
 *
 * Every write of a student number goes through here. It lived as a private
 * function inside StudentsPage and was called from UserManagementPage without
 * being exported, which is what broke the build.
 */
export function cleanStudentId(v: string): string {
  return (v || "").trim().replace(/\s+/g, "");
}
