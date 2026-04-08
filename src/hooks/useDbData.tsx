import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { DB } from "@/data/db";

export function useDbData() {
  const [db, setDb] = useState<DB | null>(null);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    try {
      // ── FAST BATCH: critical data needed to render the UI ──────────────────
      const [
        configRes,
        programmesRes,
        departmentsRes,
        classesRes,
        modulesRes,
        moduleClassesRes,
        studentsRes,
        notificationsRes,
        roomsRes,
      ] = await Promise.all([
        supabase.from("school_config").select("*").single(),
        supabase.from("programmes").select("*"),
        supabase.from("departments").select("*"),
        supabase.from("classes").select("*"),
        supabase.from("modules").select("id,code,name,dept"),
        supabase.from("module_classes").select("module_id,class_id"),
        supabase.from("students").select("id,student_id,name,gender,dob,mobile,class_id,guardian,programme,year,semester,status,email,progression_status,national_id,nationality,guardian_email,guardian_mobile,enrolment_date,completion_date"),
        supabase.from("notifications").select("*").order("date", { ascending: false }).limit(50),
        supabase.from("rooms").select("*"),
      ]);

      const moduleClassMap: Record<string, string[]> = {};
      (moduleClassesRes.data || []).forEach((mc: any) => {
        if (!moduleClassMap[mc.module_id]) moduleClassMap[mc.module_id] = [];
        moduleClassMap[mc.module_id].push(mc.class_id);
      });

      const config = (configRes.data ?? null) as {
        school_name?: string | null;
        current_year?: number | null;
        current_semester?: number | null;
        semester_start_date?: string | null;
        semester_end_date?: string | null;
        transcript_issuer?: string | null;
        transcript_issuer_title?: string | null;
        offer_letter_signatory?: string | null;
        offer_letter_signatory_title?: string | null;
        offer_letter_signature_url?: string | null;
      } | null;
      const programmes = (programmesRes.data || []).map((p: any) => ({
        id: p.id, name: p.name, years: p.years, semesters: p.semesters,
        type: p.type, startYear: p.start_year, level: p.level ?? null,
        intakeMonth: p.intake_month ?? 7,
      }));

      const initialDb: DB = {
        config: {
          schoolName: config?.school_name || "Boswa CIB",
          currentYear: config?.current_year || 2026,
          currentSemester: config?.current_semester || 1,
          semesterStartDate: config?.semester_start_date || "",
          semesterEndDate: config?.semester_end_date || "",
          programmes,
          transcriptIssuer: config?.transcript_issuer || "Boisi Dibuile",
          transcriptIssuerTitle: config?.transcript_issuer_title || "Deputy Principal",
          offerLetterSignatory: config?.offer_letter_signatory || "Ms Claudette Latifa Ziteyo",
          offerLetterSignatoryTitle: config?.offer_letter_signatory_title || "School Administration Manager",
          offerLetterSignatureUrl: config?.offer_letter_signature_url || "",
        },
        departments: (departmentsRes.data || []).map((d: any) => ({
          id: d.id, name: d.name, hod: d.hod || "",
        })),
        users: [],
        classes: (classesRes.data || []).map((c: any) => ({
          id: c.id, name: c.name, programme: c.programme || "",
          year: c.year, semester: c.semester, calYear: c.cal_year,
          division: c.division || "", lecturer: c.lecturer || "",
        })),
        modules: (modulesRes.data || []).map((m: any) => ({
          id: m.id, code: m.code, name: m.name, dept: m.dept || "",
          classes: moduleClassMap[m.id] || [],
        })),
        students: (studentsRes.data || []).map((s: any) => ({
          id: s.id, studentId: s.student_id, name: s.name,
          gender: s.gender || "", dob: s.dob || "", mobile: s.mobile || "",
          classId: s.class_id || "", guardian: s.guardian || "",
          programme: s.programme || "", year: s.year, semester: s.semester,
          status: s.status, email: s.email || "",
          progressionStatus: s.progression_status || "pending",
          nationalId: s.national_id || "", nationality: s.nationality || "",
          guardianEmail: s.guardian_email || "", guardianMobile: s.guardian_mobile || "",
          enrolmentDate: s.enrolment_date || "", completionDate: s.completion_date || "",
        })),
        // placeholders — filled in by background load
        marks: [], attendance: [], studentModules: [], exams: [],
        assignments: [], submissions: [], timetable: [],
        notifications: (notificationsRes.data || []).map((n: any) => ({
          id: n.id, title: n.title, body: n.body || "",
          date: n.date || "", priority: n.priority || "normal", author: n.author || "",
        })),
        admissionEnquiries: [],
        rooms: (roomsRes.data || []).map((r: any) => ({
          id: r.id, name: r.name, type: r.type || "Classroom",
          capacity: r.capacity || 0, notes: r.notes || "",
        })),
      };

      setDb(initialDb);
      setLoading(false); // ← show UI immediately

      // ── BACKGROUND BATCH: heavy data loaded after UI is visible ───────────
      const [
        termsRes,
        marksRes,
        attendanceRes,
        studentModulesRes,
        examsRes,
        assignmentsRes,
        submissionsRes,
        timetableRes,
        admissionRes,
      ] = await Promise.all([
        supabase.from("terms").select("*"),
        supabase.from("marks").select("*"),
        supabase.from("attendance").select("student_id,class_id,date,status"),
        supabase.from("student_modules").select("student_id,module_id,added_by,added_at"),
        supabase.from("exams").select("*"),
        supabase.from("assignments").select("id,title,module_id,class_id,due_date,marks,status,description,instructions,attachment_name,uploaded_by,uploaded_date,submission_type,created_by"),
        supabase.from("submissions").select("id,assignment_id,student_id,submitted_date,submitted_time,file_name,file_size,notes,status,grade,feedback"),
        supabase.from("timetable").select("*"),
        supabase.from("admission_enquiries").select("*"),
      ]);

      setDb((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          marks: (marksRes.data || []).map((m: any) => ({
            studentId: m.student_id, moduleId: m.module_id, classId: m.class_id,
            test1: Number(m.test1), test2: Number(m.test2), practTest: Number(m.pract_test),
            indAss: Number(m.ind_ass), grpAss: Number(m.grp_ass),
            finalExam: Number(m.final_exam), practical: Number(m.practical),
            year: m.year, semester: m.semester,
          })),
          attendance: (attendanceRes.data || []).map((a: any) => ({
            studentId: a.student_id, classId: a.class_id, date: a.date, status: a.status,
          })),
          studentModules: (studentModulesRes.data || []).map((sm: any) => ({
            studentId: sm.student_id, moduleId: sm.module_id,
            addedBy: sm.added_by || "", addedAt: sm.added_at || "",
          })),
          exams: (examsRes.data || []).map((e: any) => ({
            id: e.id, name: e.name, moduleId: e.module_id || "",
            classId: e.class_id || "", date: e.date || "",
            status: e.status || "", type: e.type || "", startTime: e.start_time || "", endTime: e.end_time || "", room: e.room || "", createdBy: e.created_by || "",
          })),
          assignments: (assignmentsRes.data || []).map((a: any) => ({
            id: a.id, title: a.title, moduleId: a.module_id || "",
            classId: a.class_id || "", dueDate: a.due_date || "",
            marks: a.marks || 0, status: a.status || "",
            description: a.description || "", instructions: a.instructions || "",
            attachmentName: a.attachment_name || null, attachmentData: null,
            uploadedBy: a.uploaded_by || "", uploadedDate: a.uploaded_date || "",
            submissionType: a.submission_type || "softcopy", createdBy: a.created_by || "",
          })),
          submissions: (submissionsRes.data || []).map((s: any) => ({
            id: s.id, assignmentId: s.assignment_id || "",
            studentId: s.student_id || "", submittedDate: s.submitted_date || "",
            submittedTime: s.submitted_time || "", fileName: s.file_name || "",
            fileData: "", fileSize: s.file_size || "",
            notes: s.notes || "", status: s.status || "",
            grade: s.grade, feedback: s.feedback || "",
          })),
          timetable: (timetableRes.data || []).map((t: any) => ({
            id: t.id, classId: t.class_id || "", day: t.day,
            time: t.time, moduleId: t.module_id || "", room: t.room || "",
          })),
          admissionEnquiries: (admissionRes.data || []).map((a: any) => ({
            id: a.id, name: a.name, programme: a.programme || "",
            status: a.status || "", date: a.date || "", dob: a.dob || "",
            gender: a.gender || "", nationality: a.nationality || "",
            nationalId: a.national_id || "", mobile: a.mobile || "",
            email: a.email || "", guardianName: a.guardian_name || "",
            guardianMobile: a.guardian_mobile || "", guardianEmail: a.guardian_email || "",
            message: a.message || "",
          })),
        };
      });
    } catch (err) {
      console.error("Error loading database:", err);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  return { db, loading, reload: loadData, setDb };
}
