/**
 * Who can see whose data.
 *
 * These rules used to be re-implemented inline on every page, and they had
 * drifted apart — StudentsPage filtered `lecturer` but left `hoa` unfiltered by
 * accident, AssignmentsPage filtered on who *created* a record rather than who
 * teaches it, and MyStudentsPage used a third variation. One person would see
 * everything and their colleague nothing, which is what the day-to-day
 * inconsistency reports were describing.
 *
 * Agreed scope:
 *   admin / super_admin  everything
 *   hoa (HOA)            everything — all students, all lecturers
 *   hod                  their own department: its modules, classes, students
 *   lecturer             only what they teach, via lecturer_modules
 *   anyone else          nothing
 *
 * `null` means UNRESTRICTED, and is deliberately distinct from `[]`, which means
 * "nothing". Collapsing the two is how a failed lookup turns into either an
 * empty screen or a full one, depending on which way the caller guesses.
 */

import type { ClassItem, DB, Department, Student, User } from '@/data/db';
import { getLecturerClassIds, getLecturerModulesList } from './lecturerHelpers';

const norm = (s?: string | null) => (s || '').trim().toLowerCase();

/** Roles that see the whole school. */
export function isUnrestricted(role?: string | null): boolean {
  return role === 'admin' || role === 'super_admin' || role === 'hoa';
}

/**
 * Which department a member of staff heads.
 *
 * Tries the department's own `hod` field first, which is a person's display
 * name — brittle, because any difference in spelling or a later rename silently
 * breaks the match, and a HOD who matched nothing previously fell through to
 * seeing every student in the school. So it falls back to the department
 * recorded on their profile, matching either the name or the id, because
 * `profiles.dept` stores the NAME while `modules.dept` stores the ID.
 */
export function resolveDepartment(db: DB, user: User | null): Department | null {
  if (!user) return null;

  const byHodName = db.departments.find(
    d => norm(d.hod) !== '' && norm(d.hod) === norm(user.name),
  );
  if (byHodName) return byHodName;

  const dept = norm(user.dept);
  if (!dept) return null;
  return db.departments.find(d => norm(d.name) === dept || norm(d.id) === dept) || null;
}

/** Modules belonging to a department. Tolerates `modules.dept` holding id or name. */
export function getDepartmentModuleIds(db: DB, dept: Department): string[] {
  const targets = [norm(dept.id), norm(dept.name)].filter(Boolean);
  return db.modules.filter(m => targets.includes(norm(m.dept))).map(m => m.id);
}

/** Module ids this user may work with. `null` = all. */
export function getScopedModuleIds(db: DB, user: User | null): string[] | null {
  if (isUnrestricted(user?.role)) return null;
  if (!user) return [];

  if (user.role === 'hod') {
    const dept = resolveDepartment(db, user);
    return dept ? getDepartmentModuleIds(db, dept) : [];
  }
  if (user.role === 'lecturer') {
    return getLecturerModulesList(db.lecturerModules, db.modules, user.id).map(m => m.id);
  }
  return [];
}

/** Class ids this user may work with. `null` = all. */
export function getScopedClassIds(db: DB, user: User | null): string[] | null {
  if (isUnrestricted(user?.role)) return null;
  if (!user) return [];

  if (user.role === 'hod') {
    const dept = resolveDepartment(db, user);
    if (!dept) return [];
    const moduleIds = new Set(getDepartmentModuleIds(db, dept));
    return [...new Set(
      db.modules.filter(m => moduleIds.has(m.id)).flatMap(m => m.classes),
    )];
  }
  if (user.role === 'lecturer') {
    return getLecturerClassIds(db.lecturerModules, user.id);
  }
  return [];
}

/** Students this user may see. */
export function getScopedStudents(db: DB, user: User | null): Student[] {
  const classIds = getScopedClassIds(db, user);
  if (classIds === null) return db.students;
  const allowed = new Set(classIds);
  return db.students.filter(s => allowed.has(s.classId));
}

/** Classes this user may see. */
export function getScopedClasses(db: DB, user: User | null): ClassItem[] {
  const classIds = getScopedClassIds(db, user);
  if (classIds === null) return db.classes;
  const allowed = new Set(classIds);
  return db.classes.filter(c => allowed.has(c.id));
}

/**
 * Teaching staff this user may see.
 * HOA and admins see everyone; a HOD sees whoever teaches a module in their
 * department; a lecturer sees only themselves.
 */
export function getScopedFacultyIds(db: DB, user: User | null): string[] | null {
  if (isUnrestricted(user?.role)) return null;
  if (!user) return [];

  if (user.role === 'hod') {
    const moduleIds = getScopedModuleIds(db, user);
    if (moduleIds === null) return null;
    const allowed = new Set(moduleIds);
    return [...new Set(
      db.lecturerModules.filter(lm => allowed.has(lm.moduleId)).map(lm => lm.lecturerId),
    )];
  }
  return [user.id];
}
