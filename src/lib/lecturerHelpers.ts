import type { LecturerModule, Module, ClassItem } from '@/data/db';

/** All class IDs where a lecturer teaches at least one module */
export function getLecturerClassIds(
  lecturerModules: LecturerModule[],
  lecturerId: string,
): string[] {
  return [...new Set(
    lecturerModules
      .filter(lm => lm.lecturerId === lecturerId)
      .map(lm => lm.classId),
  )];
}

/** All modules a lecturer teaches (across all classes) */
export function getLecturerModulesList(
  lecturerModules: LecturerModule[],
  modules: Module[],
  lecturerId: string,
): Module[] {
  const moduleIds = [...new Set(
    lecturerModules
      .filter(lm => lm.lecturerId === lecturerId)
      .map(lm => lm.moduleId),
  )];
  return modules.filter(m => moduleIds.includes(m.id));
}

/** Modules a lecturer teaches in a specific class */
export function getLecturerModulesForClass(
  lecturerModules: LecturerModule[],
  modules: Module[],
  lecturerId: string,
  classId: string,
): Module[] {
  const moduleIds = lecturerModules
    .filter(lm => lm.lecturerId === lecturerId && lm.classId === classId)
    .map(lm => lm.moduleId);
  return modules.filter(m => moduleIds.includes(m.id));
}

/** All classes a lecturer teaches in */
export function getLecturerClasses(
  lecturerModules: LecturerModule[],
  classes: ClassItem[],
  lecturerId: string,
): ClassItem[] {
  const classIds = getLecturerClassIds(lecturerModules, lecturerId);
  return classes.filter(c => classIds.includes(c.id));
}

/** Lecturer ID for a specific module+class combination (used for timetable display) */
export function getLecturerForModuleClass(
  lecturerModules: LecturerModule[],
  moduleId: string,
  classId: string,
): string | undefined {
  return lecturerModules.find(
    lm => lm.moduleId === moduleId && lm.classId === classId,
  )?.lecturerId;
}
