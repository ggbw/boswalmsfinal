import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { DB } from "@/data/db";

/** A query that came back with an error rather than rows. */
export interface LoadFailure { table: string; message: string }

/**
 * PostgREST caps a response at 1,000 rows by default. Every query here used to
 * be unbounded AND unordered, so once a table passed that cap the response was
 * silently truncated — and with no ORDER BY, *which* rows came back was not
 * guaranteed to be the same twice. That is how a report could show forty
 * registers one day and twelve the next with no error anywhere.
 *
 * This pages through explicitly, ordered, so the result is complete and stable.
 */
const PAGE = 1000;
const HARD_CAP = 100_000; // stop runaway paging rather than hang the browser

async function fetchAll(
  table: string,
  columns = "*",
  orderColumn = "id",
): Promise<{ data: any[]; error: { message: string } | null }> {
  const rows: any[] = [];
  for (let from = 0; from < HARD_CAP; from += PAGE) {
    const { data, error } = await (supabase.from(table as any) as any)
      .select(columns)
      .order(orderColumn, { ascending: true })
      .range(from, from + PAGE - 1);
    // Return what we have alongside the error: a partial page is still better
    // than nothing, and the caller reports the failure either way.
    if (error) return { data: rows, error: { message: error.message } };
    rows.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return { data: rows, error: null };
}

/** Turn a single-query result into rows, recording any error instead of hiding it. */
function take(
  table: string,
  res: { data: any; error: any },
  failures: LoadFailure[],
): any[] {
  if (res?.error) {
    failures.push({ table, message: res.error.message });
    return [];
  }
  return res?.data || [];
}

export function useDbData() {
  const [db, setDb] = useState<DB | null>(null);
  const [loading, setLoading] = useState(true);
  // Surfaced to the user. Previously every result was read as `(res.data || [])`,
  // so a failed query and a genuinely empty table were indistinguishable — the
  // screen just said "No students in this class".
  const [failures, setFailures] = useState<LoadFailure[]>([]);

  const loadData = useCallback(async () => {
    const failed: LoadFailure[] = [];
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
        lecturerModulesRes,
        profilesRes,
        userRolesRes,
        programmeModulesRes,
      ] = await Promise.all([
        supabase.from("school_config").select("*").single(),
        supabase.from("programmes").select("*"),
        supabase.from("departments").select("*"),
        supabase.from("classes").select("*"),
        supabase.from("modules").select("id,code,name,dept,has_practical"),
        supabase.from("module_classes").select("module_id,class_id"),
        supabase.from("students").select("id,student_id,name,gender,dob,mobile,class_id,guardian,programme,year,semester,status,email,progression_status,national_id,nationality,guardian_email,guardian_mobile,enrolment_date,completion_date"),
        supabase.from("notifications").select("*").order("date", { ascending: false }).limit(50),
        supabase.from("rooms").select("*"),
        supabase.from("lecturer_modules").select("id,lecturer_id,module_id,class_id"),
        supabase.from("profiles").select("user_id,name,email,dept,code,student_id"),
        supabase.from("user_roles").select("user_id,role"),
        supabase.from("programme_modules" as any).select("programme_id,module_id,year,semester"),
      ]);

      const moduleClassMap: Record<string, string[]> = {};
      take("module_classes", moduleClassesRes, failed).forEach((mc: any) => {
        if (!moduleClassMap[mc.module_id]) moduleClassMap[mc.module_id] = [];
        moduleClassMap[mc.module_id].push(mc.class_id);
      });

      if (configRes.error) failed.push({ table: "school_config", message: configRes.error.message });
      const config = (configRes.data ?? null) as {
        school_name?: string | null;
        current_year?: number | null;
        current_semester?: number | null;
        semester_start_date?: string | null;
        semester_end_date?: string | null;
        transcript_issuer?: string | null;
        transcript_issuer_title?: string | null;
        transcript_signature?: string | null;
        offer_letter_signatory?: string | null;
        offer_letter_signatory_title?: string | null;
        offer_letter_signature_url?: string | null;
        letter_date?: string | null;
        wl_uniform_open?: string | null;
        wl_uniform_close?: string | null;
        wl_reg_start?: string | null;
        wl_reg_end?: string | null;
        wl_induction?: string | null;
        wl_classes_start?: string | null;
        welcome_letter_signatory?: string | null;
        welcome_letter_signatory_title?: string | null;
        welcome_letter_signature_url?: string | null;
      } | null;
      const programmes = take("programmes", programmesRes, failed).map((p: any) => ({
        id: p.id, name: p.name, years: p.years, semesters: p.semesters,
        type: p.type, startYear: p.start_year, level: p.level ?? null,
        intakeMonth: p.intake_month ?? 7,
        // Falls back to the single intake_month when the intakes column is
        // absent (e.g. before the merge migration is applied).
        intakes: Array.isArray(p.intakes) && p.intakes.length > 0 ? p.intakes : [p.intake_month ?? 7],
      }));

      const initialDb: DB = {
        config: {
          id: (config as any)?.id,
          schoolName: config?.school_name || "Boswa CIB",
          currentYear: config?.current_year || 2026,
          currentSemester: config?.current_semester || 1,
          semesterStartDate: config?.semester_start_date || "",
          semesterEndDate: config?.semester_end_date || "",
          programmes,
          transcriptIssuer: config?.transcript_issuer || "Boisi Dibuile",
          transcriptIssuerTitle: config?.transcript_issuer_title || "Deputy Principal",
          transcriptSignature: config?.transcript_signature || "",
          offerLetterSignatory: config?.offer_letter_signatory || "Ms Claudette Latifa Ziteyo",
          offerLetterSignatoryTitle: config?.offer_letter_signatory_title || "School Administration Manager",
          offerLetterSignatureUrl: config?.offer_letter_signature_url || "",
          letterDate: config?.letter_date || "",
          wlUniformOpen:  config?.wl_uniform_open  || "",
          wlUniformClose: config?.wl_uniform_close || "",
          wlRegStart:     config?.wl_reg_start     || "",
          wlRegEnd:       config?.wl_reg_end       || "",
          wlInduction:    config?.wl_induction     || "",
          wlClassesStart: config?.wl_classes_start || "",
          welcomeLetterSignatory:      config?.welcome_letter_signatory       || "",
          welcomeLetterSignatoryTitle: config?.welcome_letter_signatory_title || "",
          welcomeLetterSignatureUrl:   config?.welcome_letter_signature_url   || "",
        },
        departments: take("departments", departmentsRes, failed).map((d: any) => ({
          id: d.id, name: d.name, hod: d.hod || "",
        })),
        users: (() => {
          const roleMap: Record<string, string> = {};
          take("user_roles", userRolesRes, failed).forEach((r: any) => { roleMap[r.user_id] = r.role; });
          return take("profiles", profilesRes, failed).map((p: any) => ({
            id: p.user_id, username: p.email || "", password: "",
            role: roleMap[p.user_id] || "", name: p.name || "",
            changed: false, email: p.email || "", dept: p.dept || "",
            code: p.code || "", studentId: p.student_id || "",
          }));
        })(),
        classes: take("classes", classesRes, failed).map((c: any) => ({
          id: c.id, name: c.name, programme: c.programme || "",
          year: c.year, semester: c.semester, calYear: c.cal_year,
          division: c.division || "", lecturer: c.lecturer || "",
        })),
        modules: take("modules", modulesRes, failed).map((m: any) => ({
          id: m.id, code: m.code, name: m.name, dept: m.dept || "",
          classes: moduleClassMap[m.id] || [],
          hasPractical: m.has_practical ?? true,
        })),
        students: take("students", studentsRes, failed).map((s: any) => ({
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
        lecturerModules: take("lecturer_modules", lecturerModulesRes, failed).map((lm: any) => ({
          id: lm.id, lecturerId: lm.lecturer_id, moduleId: lm.module_id, classId: lm.class_id,
        })),
        programmeModules: take("programme_modules", programmeModulesRes, failed).map((pm: any) => ({
          programmeId: pm.programme_id, moduleId: pm.module_id, year: pm.year, semester: pm.semester,
        })),
        // placeholders — filled in by background load
        marks: [], attendance: [], studentModules: [], exams: [],
        assignments: [], submissions: [], timetable: [],
        notifications: take("notifications", notificationsRes, failed).map((n: any) => ({
          id: n.id, title: n.title, body: n.body || "",
          date: n.date || "", priority: n.priority || "normal", author: n.author || "",
        })),
        admissionEnquiries: [],
        rooms: take("rooms", roomsRes, failed).map((r: any) => ({
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
        // These are the tables that grow without bound — attendance alone will
        // add ~1,400 rows a week once registers are being taken. fetchAll pages
        // through them in a stable order; a plain select() would silently stop
        // at 1,000 rows and return a different subset each time.
        fetchAll("marks"),
        fetchAll("attendance"),
        fetchAll("student_modules", "student_id,module_id,added_by,added_at"),
        supabase.from("exams").select("*"),
        // attachment_data / file_data are deliberately NOT selected: they hold
        // base64 file contents and would bloat this bulk load. The paths are
        // cheap, and the detail view fetches legacy base64 one row at a time.
        supabase.from("assignments").select("id,title,module_id,class_id,due_date,marks,status,description,instructions,attachment_name,attachment_path,uploaded_by,uploaded_date,submission_type,created_by"),
        fetchAll("submissions", "id,assignment_id,student_id,submitted_date,submitted_time,file_name,file_path,file_size,notes,status,grade,feedback"),
        fetchAll("timetable"),
        supabase.from("admission_enquiries").select("*"),
      ]);

      setDb((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          marks: take("marks", marksRes, failed).map((m: any) => ({
            studentId: m.student_id, moduleId: m.module_id, classId: m.class_id,
            test1: Number(m.test1), test2: Number(m.test2), practTest: Number(m.pract_test),
            indAss: Number(m.ind_ass), grpAss: Number(m.grp_ass),
            finalExam: Number(m.final_exam), practical: Number(m.practical),
            year: m.year, semester: m.semester,
          })),
          attendance: take("attendance", attendanceRes, failed).map((a: any) => ({
            studentId: a.student_id, classId: a.class_id, moduleId: a.module_id || "",
            date: a.date, status: a.status, session: a.session || "start",
          })),
          studentModules: take("student_modules", studentModulesRes, failed).map((sm: any) => ({
            studentId: sm.student_id, moduleId: sm.module_id,
            addedBy: sm.added_by || "", addedAt: sm.added_at || "",
          })),
          exams: take("exams", examsRes, failed).map((e: any) => ({
            id: e.id, name: e.name, moduleId: e.module_id || "",
            classId: e.class_id || "", date: e.date || "",
            status: e.status || "", type: e.type || "", startTime: e.start_time || "", endTime: e.end_time || "", room: e.room || "", createdBy: e.created_by || "",
          })),
          assignments: take("assignments", assignmentsRes, failed).map((a: any) => ({
            id: a.id, title: a.title, moduleId: a.module_id || "",
            classId: a.class_id || "", dueDate: a.due_date || "",
            marks: a.marks || 0, status: a.status || "",
            description: a.description || "", instructions: a.instructions || "",
            attachmentName: a.attachment_name || null,
            attachmentPath: a.attachment_path || null,
            attachmentData: null, // fetched on demand — see AssignmentsPage
            uploadedBy: a.uploaded_by || "", uploadedDate: a.uploaded_date || "",
            submissionType: a.submission_type || "softcopy", createdBy: a.created_by || "",
          })),
          submissions: take("submissions", submissionsRes, failed).map((s: any) => ({
            id: s.id, assignmentId: s.assignment_id || "",
            studentId: s.student_id || "", submittedDate: s.submitted_date || "",
            submittedTime: s.submitted_time || "", fileName: s.file_name || "",
            filePath: s.file_path || null,
            fileData: "", // fetched on demand — see AssignmentsPage
            fileSize: s.file_size || "",
            notes: s.notes || "", status: s.status || "",
            grade: s.grade, feedback: s.feedback || "",
          })),
          timetable: take("timetable", timetableRes, failed).map((t: any) => ({
            id: t.id, classId: t.class_id || "", day: t.day,
            time: t.time, moduleId: t.module_id || "", room: t.room || "",
            date: t.date || "", sessionId: t.session_id || "",
          })),
          admissionEnquiries: take("admission_enquiries", admissionRes, failed).map((a: any) => ({
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

      // Report anything that failed. An empty list clears a previous warning,
      // so a successful retry removes the banner.
      setFailures(failed);
      if (failed.length) {
        console.error("Some data could not be loaded:", failed);
      }
    } catch (err) {
      console.error("Error loading database:", err);
      const message = err instanceof Error ? err.message : "Unknown error";
      setFailures([...failed, { table: "(load)", message }]);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  return { db, loading, failures, reload: loadData, setDb };
}
