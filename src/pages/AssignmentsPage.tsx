import { useState } from 'react';
import { useApp } from '@/context/AppContext';
import { supabase } from '@/integrations/supabase/client';
import { getScopedClassIds, getScopedModuleIds, isUnrestricted, canManageAcademics } from '@/lib/scope';
import { assignmentsForStudent } from '@/lib/studentMarks';
import { ACCEPT_DOCUMENTS, MAX_ASSIGNMENT_BYTES, checkUpload } from '@/lib/uploads';

const BUCKET = 'assignment-files';

/**
 * Download a file that may live in either of two places.
 *
 * New uploads go to Storage and the row keeps a path. Rows created before that
 * still hold the file as base64 in `attachment_data` / `file_data` — columns the
 * bulk loader deliberately does not fetch, because doing so is what made the
 * list query slow enough that they were dropped, which in turn broke every
 * download link. So for those we fetch the one column for the one row, on click.
 *
 * Returns an error string, or null on success.
 */
async function downloadFile(opts: {
  path?: string | null;
  fileName: string;
  legacy?: { table: 'assignments' | 'submissions'; column: string; id: string };
}): Promise<string | null> {
  const { path, fileName, legacy } = opts;

  const save = (href: string, revoke?: boolean) => {
    const a = document.createElement('a');
    a.href = href;
    a.download = fileName || 'download';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    if (revoke) URL.revokeObjectURL(href);
  };

  if (path) {
    const { data, error } = await supabase.storage.from(BUCKET).download(path);
    if (error) return error.message;
    save(URL.createObjectURL(data), true);
    return null;
  }

  if (legacy) {
    const { data, error } = await supabase
      .from(legacy.table)
      .select(legacy.column)
      .eq('id', legacy.id)
      .single();
    if (error) return error.message;
    const b64 = (data as unknown as Record<string, string> | null)?.[legacy.column];
    if (!b64) return 'This file is no longer stored — it may have been uploaded before file storage was set up.';
    save(b64); // already a data: URL
    return null;
  }

  return 'No file is attached.';
}

// Stateful assignment create form. Re-renders the Class dropdown whenever the
// selected Module changes (the previous version froze the class list to the
// first module, leaving admins unable to pick a class for other modules).
function AssignmentFormModal({
  db, currentUser, isAdmin, availableModules, toast, onDone,
}: {
  db: any;
  currentUser: any;
  isAdmin: boolean;
  availableModules: any[];
  toast: (msg: string, type?: string) => void;
  onDone: () => void;
}) {
  const classesForModule = (mid: string) => {
    const mod = db.modules.find((m: any) => m.id === mid);
    const linkedIds: string[] = mod?.classes || [];

    // A lecturer is assigned a module *per class*, so offer exactly the classes
    // where they teach THIS module — not every class they teach anything in.
    if (currentUser?.role === 'lecturer') {
      const taughtHere = db.lecturerModules
        .filter((lm: any) => lm.lecturerId === currentUser?.id && lm.moduleId === mid)
        .map((lm: any) => lm.classId);
      const classes = db.classes.filter((c: any) => taughtHere.includes(c.id));
      if (classes.length > 0) return classes;
    }

    // Everyone else: their scoped classes, narrowed to those taking this module.
    // Previously a HOD fell through to the lecturer branch and was offered only
    // classes they personally teach, rather than their department's.
    const scoped = getScopedClassIds(db, currentUser);
    const available = scoped === null
      ? db.classes
      : db.classes.filter((c: any) => scoped.includes(c.id));
    const linked = available.filter((c: any) => linkedIds.includes(c.id));
    return linked.length > 0 ? linked : available;
  };

  const firstModuleId = availableModules[0]?.id || '';
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [moduleId, setModuleId] = useState(firstModuleId);
  const [classId, setClassId] = useState(classesForModule(firstModuleId)[0]?.id || '');
  const [dueDate, setDueDate] = useState('');
  const [marks, setMarks] = useState(100);
  const [submissionType, setSubmissionType] = useState('softcopy');
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  const classOptions = classesForModule(moduleId);

  const handleModuleChange = (mid: string) => {
    setModuleId(mid);
    const next = classesForModule(mid);
    setClassId(prev => (next.some((c: any) => c.id === prev) ? prev : next[0]?.id || ''));
  };

  const handleSave = async () => {
    if (!title || !moduleId) { toast('Title and module are required', 'error'); return; }
    if (attachmentFile && attachmentFile.size > MAX_ASSIGNMENT_BYTES) { toast('Attachment must be under 10MB', 'error'); return; }
    setSaving(true);

    const id = 'asgn_' + Date.now();

    // Upload to Storage BEFORE inserting the row. If the upload fails we stop
    // here, rather than leaving an assignment that claims an attachment it
    // hasn't got. The old code base64-encoded the file into the row itself,
    // which is what eventually broke every download link.
    let attachmentName: string | null = null;
    let attachmentPath: string | null = null;
    if (attachmentFile) {
      attachmentName = attachmentFile.name;
      attachmentPath = `assignments/${id}/${attachmentFile.name}`;
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(attachmentPath, attachmentFile, { upsert: true });
      if (upErr) { setSaving(false); toast('Attachment upload failed: ' + upErr.message, 'error'); return; }
    }

    const { error } = await supabase.from('assignments').insert({
      id, title, description, module_id: moduleId, class_id: classId || null,
      due_date: dueDate || null, marks, status: 'active',
      submission_type: submissionType, created_by: currentUser?.id || null,
      uploaded_by: currentUser?.name || null, uploaded_date: new Date().toISOString().split('T')[0],
      attachment_name: attachmentName, attachment_path: attachmentPath,
    });
    setSaving(false);
    if (error) {
      // Don't leave the uploaded file orphaned in the bucket.
      if (attachmentPath) await supabase.storage.from(BUCKET).remove([attachmentPath]);
      toast(error.message, 'error');
      return;
    }
    toast('Assignment created!', 'success');
    onDone();
  };

  return (
    <div>
      <div className="form-group"><label>Title *</label><input className="form-input" value={title} onChange={e => setTitle(e.target.value)} /></div>
      <div className="form-group"><label>Description</label><textarea className="form-input" rows={3} value={description} onChange={e => setDescription(e.target.value)} /></div>
      <div className="form-row cols2">
        <div className="form-group"><label>Module *</label>
          <select className="form-select" value={moduleId} onChange={e => handleModuleChange(e.target.value)}>
            {availableModules.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
        <div className="form-group"><label>Class *</label>
          <select className="form-select" value={classId} onChange={e => setClassId(e.target.value)}>
            <option value="">— Select class —</option>
            {classOptions.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </div>
      <div className="form-row cols2">
        <div className="form-group"><label>Due Date</label><input className="form-input" type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} /></div>
        <div className="form-group"><label>Total Marks</label><input className="form-input" type="number" value={marks} onChange={e => setMarks(Number(e.target.value))} /></div>
      </div>
      <div className="form-group"><label>Submission Type *</label>
        <select className="form-select" value={submissionType} onChange={e => setSubmissionType(e.target.value)}>
          <option value="softcopy">Softcopy (Digital Upload)</option>
          <option value="hardcopy">Hardcopy (Physical Submission)</option>
        </select>
      </div>
      <div className="form-group">
        <label>Attach File (optional)</label>
        <input
          className="form-input"
          type="file"
          accept={ACCEPT_DOCUMENTS}
          onChange={e => {
            const f = e.target.files?.[0] || null;
            const err = f && checkUpload(f, MAX_ASSIGNMENT_BYTES);
            if (err) { toast(err, 'error'); e.target.value = ''; setAttachmentFile(null); return; }
            setAttachmentFile(f);
          }}
        />
        <div style={{fontSize:11,color:'var(--text2)',marginTop:4}}>Attach a reference document, rubric, or instructions file (max 10MB)</div>
      </div>
      <button className="btn btn-primary" style={{ marginTop: 12 }} disabled={saving} onClick={handleSave}>Create Assignment</button>
    </div>
  );
}

export default function AssignmentsPage() {
  const { db, currentUser, showModal, closeModal, toast, reloadDb } = useApp();
  const role = currentUser?.role;
  const [selectedAssignment, setSelectedAssignment] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  // Who may CREATE and DELETE — not merely who may see everything. A principal
  // sees the whole school but writes nothing, so they must not be offered
  // buttons the database will refuse.
  const isAdmin = canManageAcademics(role);
  const isTeacher = role === 'lecturer' || role === 'hod' || role === 'hoa';

  let assignments = db.assignments;

  if (isTeacher) {
    // Scoped by what they TEACH, not by who created the record.
    //
    // This used to be `a.createdBy === currentUser?.id`, which meant an
    // assignment set by an admin for a lecturer's own module was invisible to
    // that lecturer; assignments predating the created_by column were invisible
    // to everyone forever; and a recreated account lost sight of all its
    // previous work. HODs and HOAs were caught by the same filter and so could
    // not see their department's or the school's assignments at all.
    const scopedModuleIds = getScopedModuleIds(db, currentUser);
    if (scopedModuleIds !== null) {
      const allowed = new Set(scopedModuleIds);
      assignments = assignments.filter(
        a => allowed.has(a.moduleId) || a.createdBy === currentUser?.id,
      );
    }
  }

  const currentStudent = role === 'student'
    ? db.students.find(s => s.studentId === currentUser?.studentId)
    : null;

  // A student whose record cannot be found must see NOTHING, not everything.
  // Previously the filter block below was simply skipped when currentStudent was
  // null, so a broken profile link showed that student every assignment in the
  // school — the opposite of the intended failure.
  if (role === 'student' && !currentStudent) {
    assignments = [];
  }

  if (role === 'student' && currentStudent) {
    assignments = assignmentsForStudent(db, currentStudent, assignments);
  }


  const handleCreateAssignment = () => {
    // Scope the pickers to what this person may work with. `isAdmin` alone was
    // too narrow: a super_admin or HOA fell through to the lecturer branch and
    // got an empty module list, so they could not create an assignment at all.
    const scopedModuleIds = getScopedModuleIds(db, currentUser);
    const lecModules = scopedModuleIds === null
      ? db.modules
      : db.modules.filter(m => scopedModuleIds.includes(m.id));
    const unrestricted = isUnrestricted(currentUser?.role);

    // A teacher with no modules assigned gets an empty picker and a form that
    // can never be submitted ("Title and module are required" with no module to
    // choose). Say what's actually wrong instead. 6 of 12 teaching staff have no
    // rows in lecturer_modules today, which is the real reason "lecturers can't
    // create assignments" — not a permissions problem.
    if (lecModules.length === 0) {
      showModal('Create Assignment', (
        <div>
          <div style={{ background: 'var(--bg2)', borderLeft: '3px solid var(--accent)', borderRadius: 6, padding: '12px 14px', fontSize: 13, color: 'var(--text2)', lineHeight: 1.6 }}>
            You don't have any modules assigned yet, so there is nothing to create an assignment against.
            <br /><br />
            {currentUser?.role === 'hod'
              ? 'No modules are linked to your department. An administrator can set this up under Configuration → programme mapping.'
              : 'An administrator can assign your modules under Classes → Assign lecturers.'}
          </div>
          <button className="btn btn-primary" style={{ marginTop: 14, width: '100%' }} onClick={closeModal}>Close</button>
        </div>
      ));
      return;
    }

    showModal('Create Assignment', (
      <AssignmentFormModal
        db={db} currentUser={currentUser} isAdmin={unrestricted}
        availableModules={lecModules} toast={toast}
        onDone={() => { closeModal(); reloadDb(); }}
      />
    ));
  };

  const handleDeleteAssignment = async (assignmentId: string) => {
    if (!confirm('Are you sure you want to delete this assignment? This will also remove all submissions.')) return;

    // Remove the stored files too, or the bucket accumulates orphans nobody can
    // reach. Collected before the rows are deleted, since the paths live on them.
    const paths = [
      db.assignments.find(a => a.id === assignmentId)?.attachmentPath,
      ...db.submissions.filter(s => s.assignmentId === assignmentId).map(s => s.filePath),
    ].filter(Boolean) as string[];
    if (paths.length) await supabase.storage.from(BUCKET).remove(paths);

    // Delete submissions first
    await supabase.from('submissions').delete().eq('assignment_id', assignmentId);
    const { error } = await supabase.from('assignments').delete().eq('id', assignmentId);
    if (error) { toast(error.message, 'error'); } else {
      toast('Assignment deleted', 'success');
      setSelectedAssignment(null);
      reloadDb();
    }
  };

  const handleEnterMarks = async (a: typeof assignments[0]) => {
    const students = db.students.filter(s => s.classId === a.classId);
    if (students.length === 0) { toast('No students in this class', 'error'); return; }

    // Surface a load failure: a silent empty result would pre-fill 0 for every
    // student and saving would overwrite real marks with zeros.
    const { data: existing, error: loadErr } = await supabase
      .from('assessment_marks').select('*')
      .eq('assessment_id', a.id).eq('assessment_type', 'assignment');
    if (loadErr) {
      toast('Could not load existing marks — please try again.', 'error');
      return;
    }

    const marksMap: Record<string, number> = {};
    students.forEach(s => {
      const ex = (existing || []).find((x: any) => x.student_id === s.studentId);
      marksMap[s.studentId] = ex ? Number(ex.score) : 0;
    });

    showModal(`Enter Marks — ${a.title}`, (
      <div>
        <div style={{ background: 'var(--bg2)', borderRadius: 8, padding: '8px 14px', marginBottom: 12, fontSize: 12, color: 'var(--text2)' }}>
          Assignment · Out of <strong>{a.marks}</strong> · {students.length} student(s)
        </div>
        <div className="table-wrap" style={{ maxHeight: 400, overflowY: 'auto' }}>
          <table>
            <thead><tr><th>Student</th><th>ID</th><th>Score (0–{a.marks})</th></tr></thead>
            <tbody>
              {students.map(s => (
                <tr key={s.id}>
                  <td className="td-name">{s.name}</td>
                  <td style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11 }}>{s.studentId}</td>
                  <td>
                    <input className="form-input" type="number" min={0} max={a.marks}
                      defaultValue={marksMap[s.studentId] ?? 0} style={{ width: 80 }}
                      onChange={e => { marksMap[s.studentId] = Number(e.target.value); }} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button className="btn btn-primary" style={{ marginTop: 14, width: '100%' }} onClick={async () => {
          // One idempotent upsert for the whole class instead of a per-student
          // insert/update loop. Keyed on the (student_id, assessment_id) unique
          // constraint, so re-saving always works and can't fail by trying to
          // insert over an existing row when the initial lookup came back stale.
          const existingById: Record<string, string> = {};
          (existing || []).forEach((x: any) => { existingById[x.student_id] = x.id; });
          // min/max on a number input are HINTS, not enforcement — they block
          // the spinner arrows and nothing else. Typing 500 or -20 goes
          // straight through Number() into the database, which is how
          // impossible marks were being stored.
          const bad = students
            .map(s => ({ name: s.name, v: marksMap[s.studentId] ?? 0 }))
            .filter(x => !Number.isFinite(x.v) || x.v < 0 || x.v > a.marks);
          if (bad.length > 0) {
            toast(
              `${bad.length} mark(s) are outside 0–${a.marks}: ` +
              bad.slice(0, 3).map(b => `${b.name} (${b.v})`).join(', ') +
              (bad.length > 3 ? `, and ${bad.length - 3} more` : ''),
              'error',
            );
            return;
          }

          const rows = students.map(s => {
            const score = marksMap[s.studentId] ?? 0;
            // Normalise to 0-100
            const normalised = a.marks > 0 ? Math.round((score / a.marks) * 100) : score;
            return {
              id: existingById[s.studentId] || ('am_' + Date.now() + '_' + s.studentId),
              student_id: s.studentId, assessment_id: a.id, assessment_type: 'assignment',
              class_id: a.classId, module_id: a.moduleId, score: normalised,
            };
          });
          const { error } = await supabase
            .from('assessment_marks')
            .upsert(rows, { onConflict: 'student_id,assessment_id' });
          if (error) {
            toast(error.message || 'Marks could not be saved. Please try again.', 'error');
          } else {
            toast('Marks saved!', 'success'); closeModal(); reloadDb();
          }
        }}>Save Marks</button>
      </div>
    ), 'large');
  };

  const handleViewAssignment = (assignmentId: string) => {
    setSelectedAssignment(selectedAssignment === assignmentId ? null : assignmentId);
  };

  const handleGradeSubmission = (submission: any, assignment: any) => {
    let grade = submission.grade ?? '';
    let feedback = submission.feedback ?? '';

    showModal(`Grade: ${db.students.find(s => s.id === submission.studentId)?.name || 'Student'}`, (
      <div>
        <div className="form-row cols2">
          <div className="form-group">
            <label>Grade (out of {assignment.marks})</label>
            <input className="form-input" type="number" min={0} max={assignment.marks} defaultValue={grade} onChange={e => grade = Number(e.target.value)} />
          </div>
          <div className="form-group">
            <label>Status</label>
            <div style={{padding:'8px 0',fontSize:13,color:'var(--text2)'}}>Will be set to "graded"</div>
          </div>
        </div>
        <div className="form-group">
          <label>Feedback</label>
          <textarea className="form-input" rows={3} defaultValue={feedback} placeholder="Provide feedback to the student..." onChange={e => feedback = e.target.value} />
        </div>
        <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={async () => {
          const raw = Number(grade);
          if (!Number.isFinite(raw) || raw < 0 || raw > assignment.marks) {
            toast(`Grade must be between 0 and ${assignment.marks}.`, 'error');
            return;
          }

          const { error } = await supabase.from('submissions').update({
            grade: raw, feedback, status: 'graded'
          }).eq('id', submission.id).select('id');
          if (error) { toast(error.message, 'error'); return; }

          // Grading a submission has to reach assessment_marks as well, or the
          // mark exists only on the submission: it never appears in Marks,
          // Reports, the module mark or progression. That is why soft-copy
          // results "don't appear at marks" — they were being saved to one
          // table and read from another.
          //
          // Two conversions matter here:
          //   • the score is stored as a PERCENTAGE (score >= 50 passes), so a
          //     grade out of assignment.marks must be normalised. 25 out of 30
          //     is 83, not 25.
          //   • assessment_marks keys on the student NUMBER, while
          //     submissions.student_id holds students.id. Writing the wrong one
          //     detaches the mark from the student.
          const stu = db.students.find((st: any) => st.id === submission.studentId);
          if (!stu) {
            toast('Grade saved, but the student record could not be matched — it will not appear in Marks.', 'error');
            closeModal(); reloadDb(); return;
          }
          const normalised = assignment.marks > 0 ? Math.round((raw / assignment.marks) * 100) : raw;

          const { error: amErr } = await supabase.from('assessment_marks').upsert({
            id: 'am_' + Date.now() + '_' + stu.studentId,
            student_id: stu.studentId, assessment_id: assignment.id,
            assessment_type: 'assignment', class_id: assignment.classId,
            module_id: assignment.moduleId, score: normalised,
          }, { onConflict: 'student_id,assessment_id' });

          if (amErr) {
            toast('Grade saved on the submission, but it could not be recorded in Marks: ' + amErr.message, 'error');
          } else {
            toast(`Graded — ${raw}/${assignment.marks} (${normalised}%) recorded in Marks.`, 'success');
          }
          closeModal(); reloadDb();
        }}>Save Grade</button>
      </div>
    ));
  };

  const handleSubmitAssignment = (assignment: typeof assignments[0]) => {
    if (!currentStudent) return;
    let notes = '';
    let selectedFile: File | null = null;

    const existingSubmission = db.submissions.find(
      sub => sub.assignmentId === assignment.id && sub.studentId === currentStudent.id
    );

    if (existingSubmission) {
      toast('You have already submitted this assignment', 'info');
      return;
    }

    showModal(`Submit: ${assignment.title}`, (
      <div>
        <div className="form-group">
          <label>Upload File *</label>
          <input
            className="form-input"
            type="file"
            accept={ACCEPT_DOCUMENTS}
            onChange={e => {
              const f = e.target.files?.[0] || null;
              const err = f && checkUpload(f, MAX_ASSIGNMENT_BYTES);
              if (err) { toast(err, 'error'); e.target.value = ''; selectedFile = null; return; }
              selectedFile = f;
            }}
          />
          <div style={{fontSize:11,color:'var(--text2)',marginTop:4}}>Max file size: 10MB</div>
        </div>
        <div className="form-group">
          <label>Notes (optional)</label>
          <textarea className="form-input" rows={3} placeholder="Any notes for your lecturer..." onChange={e => notes = e.target.value} />
        </div>
        <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={async () => {
          if (!selectedFile) { toast('Please select a file to upload', 'error'); return; }
          if (selectedFile.size > MAX_ASSIGNMENT_BYTES) { toast('File size must be under 10MB', 'error'); return; }

          const now = new Date();
          const id = 'sub_' + Date.now();
          // Folder is the student's record id, which the storage policy checks
          // against their profile — a student can only write into their own.
          const filePath = `submissions/${assignment.id}/${currentStudent.id}/${selectedFile.name}`;

          const { error: upErr } = await supabase.storage
            .from(BUCKET)
            .upload(filePath, selectedFile, { upsert: true });
          if (upErr) { toast('Upload failed: ' + upErr.message, 'error'); return; }

          const { error } = await supabase.from('submissions').insert({
            id,
            assignment_id: assignment.id,
            student_id: currentStudent.id,
            submitted_date: now.toISOString().split('T')[0],
            submitted_time: now.toTimeString().split(' ')[0],
            file_name: selectedFile.name,
            file_path: filePath,
            file_size: `${(selectedFile.size / 1024).toFixed(1)} KB`,
            notes,
            status: 'submitted',
          });
          if (error) {
            await supabase.storage.from(BUCKET).remove([filePath]);
            toast(error.message, 'error');
          } else {
            toast('Assignment submitted successfully!', 'success'); closeModal(); reloadDb();
          }
        }}>Submit Assignment</button>
      </div>
    ));
  };

  // Get submissions for an assignment (for lecturer/admin view)
  const getAssignmentSubmissions = (assignmentId: string) => {
    return db.submissions.filter(sub => sub.assignmentId === assignmentId);
  };

  // Free-text search across title, module, class, submission type, status and due date.
  const q = search.trim().toLowerCase();
  const filteredAssignments = !q
    ? assignments
    : assignments.filter(a => {
        const mod = db.modules.find(m => m.id === a.moduleId);
        const cls = db.classes.find(c => c.id === a.classId);
        return [a.title, a.submissionType, a.status, a.dueDate, mod?.name, cls?.name]
          .some(v => (v || '').toLowerCase().includes(q));
      });

  return (<>
    <div className="page-header">
      <div><div className="page-title"><i className="fa-solid fa-list-check" style={{color:'var(--accent)',marginRight:8}}/>Assignments</div><div className="page-sub">{filteredAssignments.length} of {assignments.length} assignment(s)</div></div>
      {(isAdmin || isTeacher) && <button className="btn btn-primary btn-sm" onClick={handleCreateAssignment}><i className="fa-solid fa-plus" /> Create Assignment</button>}
    </div>
    <div className="card">
      <div className="search-bar">
        <input
          className="search-input"
          placeholder="Search assignments by title, module, class, type, status or due date…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>
      <div className="table-wrap"><table><thead><tr><th>Title</th><th>Module</th><th>Class</th><th>Due Date</th><th style={{textAlign:'center'}}>Marks</th><th>Type</th><th>Status</th>{(isAdmin || isTeacher) && <th>Delete</th>}<th>Submissions</th>{role === 'student' && <th>Action</th>}{(isAdmin || isTeacher) && <th>Actions</th>}</tr></thead>
      <tbody>{filteredAssignments.map(a => {
        const mod = db.modules.find(m => m.id === a.moduleId);
        const cls = db.classes.find(c => c.id === a.classId);
        const mySubmission = currentStudent ? db.submissions.find(sub => sub.assignmentId === a.id && sub.studentId === currentStudent.id) : null;
        const submissionCount = db.submissions.filter(sub => sub.assignmentId === a.id).length;

        return (
          <tr key={a.id} onClick={() => handleViewAssignment(a.id)} style={{cursor:'pointer'}}>
            <td className="td-name">{a.title}</td>
            <td>{mod?.name}</td>
            <td>{cls?.name}</td>
            <td style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11}}>{a.dueDate}</td>
            <td style={{fontFamily:"'JetBrains Mono',monospace",textAlign:'center'}}>{a.marks}</td>
            <td><span className={`badge ${a.submissionType==='hardcopy'?'badge-pending':'badge-active'}`}>{(a.submissionType||'softcopy').charAt(0).toUpperCase()+(a.submissionType||'softcopy').slice(1)}</span></td>
            <td>
              {mySubmission
                ? <span className="badge badge-credit">Submitted</span>
                : <span className={`badge ${a.status==='graded'?'badge-credit':a.status==='active'?'badge-pass':'badge-inactive'}`}>{a.status}</span>
              }
            </td>
            {(isAdmin || isTeacher) && (
              <td onClick={e => e.stopPropagation()}>
                <button className="btn btn-danger btn-sm" onClick={() => handleDeleteAssignment(a.id)}>
                  <i className="fa-solid fa-trash" /> Delete
                </button>
              </td>
            )}
            <td style={{textAlign:'center'}}>{submissionCount}</td>
            {role === 'student' && (
              <td onClick={e => e.stopPropagation()}>
                {a.submissionType === 'softcopy' && !mySubmission && a.status === 'active' && (
                  <button className="btn btn-primary btn-sm" onClick={() => handleSubmitAssignment(a)}>
                    <i className="fa-solid fa-upload" /> Submit
                  </button>
                )}
                {mySubmission && <span style={{fontSize:11,color:'var(--text2)'}}>✓ Submitted</span>}
              </td>
            )}
            {(isAdmin || isTeacher) && (
              <td onClick={e => e.stopPropagation()}>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button className="btn btn-primary btn-sm" onClick={() => handleEnterMarks(a)}>
                    <i className="fa-solid fa-pen-to-square" /> Marks
                  </button>
                </div>
              </td>
            )}
          </tr>
        );
      })}
      {filteredAssignments.length === 0 && (
        <tr>
          <td colSpan={8 + (role === 'student' ? 1 : 0) + ((isAdmin || isTeacher) ? 2 : 0)} style={{ textAlign: 'center', color: 'var(--text2)', padding: 32 }}>
            {assignments.length === 0 ? 'No assignments found.' : 'No assignments match your search.'}
          </td>
        </tr>
      )}</tbody>
    </table></div></div>

    {/* Expanded assignment detail */}
    {selectedAssignment && (() => {
      const a = assignments.find(x => x.id === selectedAssignment);
      if (!a) return null;
      const mod = db.modules.find(m => m.id === a.moduleId);
      const cls = db.classes.find(c => c.id === a.classId);
      const mySubmission = currentStudent ? db.submissions.find(sub => sub.assignmentId === a.id && sub.studentId === currentStudent.id) : null;
      const allSubmissions = getAssignmentSubmissions(a.id);

      return (
        <div className="card" style={{marginTop:16}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
            <div>
              <div className="card-title" style={{margin:0}}>{a.title}</div>
              <div style={{fontSize:12,color:'var(--text2)',marginTop:4}}>{mod?.name} • {cls?.name}</div>
            </div>
            <div style={{display:'flex',gap:8}}>
              {(isAdmin || isTeacher) && (
                <button className="btn btn-outline btn-sm" style={{color:'var(--danger)'}} onClick={() => handleDeleteAssignment(a.id)}>
                  <i className="fa-solid fa-trash" /> Delete
                </button>
              )}
              <button className="btn btn-outline btn-sm" onClick={() => setSelectedAssignment(null)}>
                <i className="fa-solid fa-times" /> Close
              </button>
            </div>
          </div>
          <div style={{marginTop:16,display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
            <div className="info-row"><span className="info-label">Due Date</span><span className="info-val">{a.dueDate || '—'}</span></div>
            <div className="info-row"><span className="info-label">Total Marks</span><span className="info-val">{a.marks}</span></div>
            <div className="info-row"><span className="info-label">Submission Type</span><span className="info-val">{(a.submissionType||'softcopy').charAt(0).toUpperCase()+(a.submissionType||'softcopy').slice(1)}</span></div>
            <div className="info-row"><span className="info-label">Status</span><span className="info-val">{a.status}</span></div>
            {a.uploadedBy && <div className="info-row"><span className="info-label">Created By</span><span className="info-val">{a.uploadedBy}</span></div>}
            {a.uploadedDate && <div className="info-row"><span className="info-label">Created Date</span><span className="info-val">{a.uploadedDate}</span></div>}
          </div>
          {a.description && (
            <div style={{marginTop:16}}>
              <div style={{fontSize:12,fontWeight:600,color:'var(--text2)',marginBottom:4}}>Description</div>
              <div style={{fontSize:13,color:'var(--text1)',lineHeight:1.6,whiteSpace:'pre-wrap'}}>{a.description}</div>
            </div>
          )}
          {a.instructions && (
            <div style={{marginTop:12}}>
              <div style={{fontSize:12,fontWeight:600,color:'var(--text2)',marginBottom:4}}>Instructions</div>
              <div style={{fontSize:13,color:'var(--text1)',lineHeight:1.6,whiteSpace:'pre-wrap'}}>{a.instructions}</div>
            </div>
          )}
          {/* Gated on the NAME only. This used to also require attachmentData,
              which the loader never fetches — so the link never rendered and no
              attachment was ever downloadable. */}
          {a.attachmentName && (
            <div style={{marginTop:12}}>
              <div style={{fontSize:12,fontWeight:600,color:'var(--text2)',marginBottom:4}}>Attachment</div>
              <button
                className="btn btn-outline btn-sm"
                style={{display:'inline-flex',alignItems:'center',gap:6}}
                onClick={async () => {
                  const err = await downloadFile({
                    path: a.attachmentPath,
                    fileName: a.attachmentName!,
                    legacy: { table: 'assignments', column: 'attachment_data', id: a.id },
                  });
                  if (err) toast(err, 'error');
                }}
              >
                <i className="fa-solid fa-paperclip" /> {a.attachmentName}
              </button>
            </div>
          )}

          {/* Student submission status */}
          {role === 'student' && mySubmission && (
            <div style={{marginTop:16,padding:12,background:'var(--bg2)',borderRadius:8}}>
              <div style={{fontSize:12,fontWeight:600,color:'var(--accent)',marginBottom:8}}>Your Submission</div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
                <div className="info-row">
                  <span className="info-label">File</span>
                  <span className="info-val">
                    <button
                      className="btn btn-outline btn-sm"
                      style={{ fontSize: 11 }}
                      onClick={async () => {
                        const err = await downloadFile({
                          path: mySubmission.filePath,
                          fileName: mySubmission.fileName,
                          legacy: { table: 'submissions', column: 'file_data', id: mySubmission.id },
                        });
                        if (err) toast(err, 'error');
                      }}
                    >
                      <i className="fa-solid fa-download" style={{ marginRight: 5 }} />{mySubmission.fileName}
                    </button>
                  </span>
                </div>
                <div className="info-row"><span className="info-label">Size</span><span className="info-val">{mySubmission.fileSize}</span></div>
                <div className="info-row"><span className="info-label">Submitted</span><span className="info-val">{mySubmission.submittedDate} {mySubmission.submittedTime}</span></div>
                <div className="info-row"><span className="info-label">Status</span><span className="info-val"><span className="badge badge-credit">{mySubmission.status}</span></span></div>
                {mySubmission.grade !== null && <div className="info-row"><span className="info-label">Grade</span><span className="info-val">{mySubmission.grade}/{a.marks}</span></div>}
                {mySubmission.feedback && <div className="info-row" style={{gridColumn:'1/-1'}}><span className="info-label">Feedback</span><span className="info-val">{mySubmission.feedback}</span></div>}
              </div>
            </div>
          )}

          {/* Submit button for students */}
          {role === 'student' && a.submissionType === 'softcopy' && !mySubmission && a.status === 'active' && (
            <div style={{marginTop:16}}>
              <button className="btn btn-primary" onClick={() => handleSubmitAssignment(a)}>
                <i className="fa-solid fa-upload" /> Submit Assignment
              </button>
            </div>
          )}

          {/* Lecturer/Admin: Submissions list */}
          {(isAdmin || isTeacher) && (
            <div style={{marginTop:20}}>
              <div style={{fontSize:14,fontWeight:700,color:'var(--text1)',marginBottom:12}}>
                Submissions ({allSubmissions.length})
              </div>
              {allSubmissions.length === 0 ? (
                <div style={{textAlign:'center',padding:20,color:'var(--text2)',fontSize:13}}>No submissions yet.</div>
              ) : (
                <div className="table-wrap"><table>
                  <thead><tr><th>Student</th><th>Student ID</th><th>File</th><th>Submitted</th><th>Status</th><th>Grade</th><th>Actions</th></tr></thead>
                  <tbody>
                    {allSubmissions.map(sub => {
                      const student = db.students.find(s => s.id === sub.studentId);
                      return (
                        <tr key={sub.id}>
                          <td className="td-name">{student?.name || 'Unknown'}</td>
                          <td style={{fontSize:11,fontFamily:"'JetBrains Mono',monospace"}}>{student?.studentId || '—'}</td>
                          <td>
                            {/* Was gated on sub.fileData, which the loader never
                                fetches — so lecturers saw a filename as plain
                                text and could not open any submitted work. */}
                            {sub.fileName ? (
                              <button
                                className="btn btn-outline btn-sm"
                                style={{fontSize:11}}
                                onClick={async e => {
                                  e.stopPropagation();
                                  const err = await downloadFile({
                                    path: sub.filePath,
                                    fileName: sub.fileName,
                                    legacy: { table: 'submissions', column: 'file_data', id: sub.id },
                                  });
                                  if (err) toast(err, 'error');
                                }}
                              >
                                <i className="fa-solid fa-download" /> {sub.fileName}
                              </button>
                            ) : (
                              <span style={{fontSize:11,color:'var(--text2)'}}>—</span>
                            )}
                          </td>
                          <td style={{fontSize:11}}>{sub.submittedDate} {sub.submittedTime}</td>
                          <td>
                            <span className={`badge ${sub.status === 'graded' ? 'badge-credit' : 'badge-pending'}`}>{sub.status}</span>
                          </td>
                          <td style={{fontFamily:"'JetBrains Mono',monospace",textAlign:'center'}}>
                            {sub.grade !== null && sub.grade !== undefined ? `${sub.grade}/${a.marks}` : '—'}
                          </td>
                          <td onClick={e => e.stopPropagation()}>
                            <button className="btn btn-primary btn-sm" onClick={() => handleGradeSubmission(sub, a)}>
                              <i className="fa-solid fa-pen" /> Grade
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table></div>
              )}
            </div>
          )}
        </div>
      );
    })()}
  </>);
}
