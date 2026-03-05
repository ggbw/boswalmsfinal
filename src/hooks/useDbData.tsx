import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { DB } from '@/data/db';

// This hook loads all data from the database and provides it in the same shape
// as the original local DB object for compatibility with existing page components.
export function useDbData() {
  const [db, setDb] = useState<DB | null>(null);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    try {
      const [
        configRes, termsRes, programmesRes, departmentsRes,
        classesRes, modulesRes, moduleClassesRes, studentsRes,
        marksRes, attendanceRes, studentModulesRes, examsRes,
        assignmentsRes, submissionsRes, timetableRes, notificationsRes,
        admissionRes,
      ] = await Promise.all([
        supabase.from('school_config').select('*').single(),
        supabase.from('terms').select('*'), // kept for compat but not used in UI
        supabase.from('programmes').select('*'),
        supabase.from('departments').select('*'),
        supabase.from('classes').select('*'),
        supabase.from('modules').select('*'),
        supabase.from('module_classes').select('*'),
        supabase.from('students').select('*'),
        supabase.from('marks').select('*'),
        supabase.from('attendance').select('*'),
        supabase.from('student_modules').select('*'),
        supabase.from('exams').select('*'),
        supabase.from('assignments').select('*'),
        supabase.from('submissions').select('*'),
        supabase.from('timetable').select('*'),
        supabase.from('notifications').select('*'),
        supabase.from('admission_enquiries').select('*'),
      ]);

      // Build module classes mapping
      const moduleClassMap: Record<string, string[]> = {};
      (moduleClassesRes.data || []).forEach((mc: any) => {
        if (!moduleClassMap[mc.module_id]) moduleClassMap[mc.module_id] = [];
        moduleClassMap[mc.module_id].push(mc.class_id);
      });

      const config = configRes.data;
      const terms = (termsRes.data || []).map((t: any) => ({
        id: t.id, name: t.name, semesterId: t.semester_id,
        startDate: t.start_date, endDate: t.end_date,
      }));
      const programmes = (programmesRes.data || []).map((p: any) => ({
        id: p.id, name: p.name, years: p.years, semesters: p.semesters,
        type: p.type, startYear: p.start_year,
      }));

      const dbData: DB = {
        config: {
          schoolName: config?.school_name || 'Boswa CIB',
          currentYear: config?.current_year || 2026,
          currentSemester: config?.current_semester || 1,
          programmes,
        },
        departments: (departmentsRes.data || []).map((d: any) => ({
          id: d.id, name: d.name, hod: d.hod || '',
        })),
        users: [], // Users are managed through auth now
        classes: (classesRes.data || []).map((c: any) => ({
          id: c.id, name: c.name, programme: c.programme || '',
          year: c.year, semester: c.semester, calYear: c.cal_year,
          division: c.division || '', lecturer: c.lecturer || '',
        })),
        modules: (modulesRes.data || []).map((m: any) => ({
          id: m.id, code: m.code, name: m.name, dept: m.dept || '',
          classes: moduleClassMap[m.id] || [],
        })),
        students: (studentsRes.data || []).map((s: any) => ({
          id: s.id, studentId: s.student_id, name: s.name,
          gender: s.gender || '', dob: s.dob || '',
          mobile: s.mobile || '', classId: s.class_id || '',
          guardian: s.guardian || '', programme: s.programme || '',
          year: s.year, semester: s.semester, status: s.status,
          email: (s as any).email || '', progressionStatus: (s as any).progression_status || 'pending',
          nationalId: (s as any).national_id || '',
        })),
        marks: (marksRes.data || []).map((m: any) => ({
          studentId: m.student_id, moduleId: m.module_id, classId: m.class_id,
          test1: Number(m.test1), test2: Number(m.test2),
          practTest: Number(m.pract_test), indAss: Number(m.ind_ass),
          grpAss: Number(m.grp_ass), finalExam: Number(m.final_exam),
          practical: Number(m.practical), year: m.year, semester: m.semester,
        })),
        attendance: (attendanceRes.data || []).map((a: any) => ({
          studentId: a.student_id, classId: a.class_id,
          date: a.date, status: a.status,
        })),
        studentModules: (studentModulesRes.data || []).map((sm: any) => ({
          studentId: sm.student_id, moduleId: sm.module_id,
          addedBy: sm.added_by || '', addedAt: sm.added_at || '',
        })),
        exams: (examsRes.data || []).map((e: any) => ({
          id: e.id, name: e.name, moduleId: e.module_id || '',
          classId: e.class_id || '', date: e.date || '',
          status: e.status || '', type: e.type || '',
          createdBy: e.created_by || '',
        })),
        assignments: (assignmentsRes.data || []).map((a: any) => ({
          id: a.id, title: a.title, moduleId: a.module_id || '',
          classId: a.class_id || '', dueDate: a.due_date || '',
          marks: a.marks || 0, status: a.status || '',
          description: a.description || '', instructions: a.instructions || '',
          attachmentName: a.attachment_name || null,
          attachmentData: a.attachment_data || null,
          uploadedBy: a.uploaded_by || '', uploadedDate: a.uploaded_date || '',
          submissionType: a.submission_type || 'softcopy',
          createdBy: a.created_by || '',
        })),
        submissions: (submissionsRes.data || []).map((s: any) => ({
          id: s.id, assignmentId: s.assignment_id || '',
          studentId: s.student_id || '', submittedDate: s.submitted_date || '',
          submittedTime: s.submitted_time || '', fileName: s.file_name || '',
          fileData: s.file_data || '', fileSize: s.file_size || '',
          notes: s.notes || '', status: s.status || '',
          grade: s.grade, feedback: s.feedback || '',
        })),
        timetable: (timetableRes.data || []).map((t: any) => ({
          id: t.id, classId: t.class_id || '', day: t.day,
          time: t.time, moduleId: t.module_id || '', room: t.room || '',
        })),
        notifications: (notificationsRes.data || []).map((n: any) => ({
          id: n.id, title: n.title, body: n.body || '',
          date: n.date || '', priority: n.priority || 'normal',
          author: n.author || '',
        })),
        admissionEnquiries: (admissionRes.data || []).map((a: any) => ({
          id: a.id, name: a.name, programme: a.programme || '',
          status: a.status || '', date: a.date || '',
          dob: a.dob || '', gender: a.gender || '', mobile: a.mobile || '',
        })),
      };

      setDb(dbData);
    } catch (err) {
      console.error('Error loading database:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  return { db, loading, reload: loadData, setDb };
}
