/**
 * The role names the database recognises: public.app_role.
 *
 * Spelled out here rather than read from the generated Supabase types. Those
 * types are regenerated from whichever database the project is connected to,
 * and when that database is empty the enum disappears, AppRole collapses to an
 * error type, and the compile-time check described on ROLE_PAGES silently
 * stops checking anything. A literal union keeps the guard working regardless.
 * Add a role here when a migration adds it to the enum.
 */
export type AppRole =
  | 'admin'
  | 'super_admin'
  | 'principal'
  | 'deputy_principal'
  | 'hoa'
  | 'hod'
  | 'lecturer'
  | 'student'
  | 'hr'
  | 'manager'
  | 'employee'
  | 'accountant';

/** Every role, in the order the menu spec lists them. */
export const APP_ROLES: readonly AppRole[] = [
  'super_admin', 'admin', 'principal', 'deputy_principal', 'hoa', 'hod',
  'lecturer', 'student', 'hr', 'manager', 'accountant', 'employee',
];

/**
 * Which roles may open which page.
 *
 * Typed as AppRole[] rather than string[] deliberately. This table was written
 * with 'hoy' in it — a role renamed to 'hoa' on 12 August and gone ever since.
 * Because the values were plain strings, TypeScript had nothing to check them
 * against, the build passed, and the only symptom was a menu item that
 * silently rendered the Dashboard: a role missing from the allow-list falls
 * back rather than erroring.
 *
 * With AppRole[] the compiler rejects any name that is not in the database
 * enum, so this cannot recur.
 */
export const ROLE_PAGES: Record<string, readonly AppRole[]> = {
  // NOTE: 'hr' was removed from every payroll and contract page below. Salary
  // figures and employment terms now belong to 'accountant', plus admin and
  // super_admin. This list is the URL guard — hiding the menu item alone would
  // leave the pages reachable by typing the address.
  dashboard:      ['admin','super_admin','hr','manager','employee','hod','hoa','lecturer','student','principal','deputy_principal'],
  profile:        ['admin','super_admin','hr','manager','employee','hod','hoa','lecturer','student','principal','deputy_principal'],
  notifications:  ['admin','super_admin','hr','manager','employee','hod','hoa','lecturer','student','principal','deputy_principal'],
  students:       ['admin','super_admin','hod','hoa','lecturer','principal','deputy_principal'],
  // HOA sees all teaching staff; a HOD sees their own department's. The page
  // scopes the list itself — see getScopedFacultyIds.
  lecturers:      ['admin','super_admin','hod','hoa','principal','deputy_principal'],
  classes:        ['admin','super_admin'],
  modules:        ['admin','super_admin','hod','lecturer','principal','deputy_principal'],
  timetable:      ['admin','super_admin','hod','hoa','lecturer','principal','deputy_principal'],
  attendance:     ['admin','super_admin','hod','hoa','lecturer','principal','deputy_principal'],
  exams:          ['admin','super_admin','hod','hoa','lecturer','principal','deputy_principal'],
  assignments:    ['admin','super_admin','hod','hoa','lecturer','student','principal','deputy_principal'],
  results:        ['admin','super_admin','hod','hoa','lecturer','student','principal','deputy_principal'],
  reports:        ['admin','super_admin','hod','hoa','principal','deputy_principal'],
  transcripts:    ['admin','super_admin','hod','hoa','student','principal','deputy_principal'],
  admissions:     ['admin','super_admin','principal'],
  progression:    ['admin','super_admin','hod','hoa','principal','deputy_principal'],
  // Approving a registration is what advances a student, so it is admin-only.
  registrations:  ['admin','super_admin'],
  config:         ['admin','super_admin'],
  grades:         ['admin','super_admin','hod','hoa','principal','deputy_principal'],
  mystudents:     ['hod','hoa','lecturer'],
  mytimetable:    ['student'],
  mymodules:      ['student'],
  mapping:        ['admin','super_admin','hod','principal','deputy_principal'],
  usermanagement: ['admin','super_admin'],
  // The audit trail names every user, their address and what they changed, so
  // it is limited to the two roles that already administer accounts. Everyone
  // else can still see their own entries — that is an RLS policy on
  // audit_logs, not a page.
  audit:          ['admin','super_admin'],
  // Same two roles as the audit trail, for the same reason: this page can put
  // a complete copy of every student, employee and payslip record onto a USB
  // stick. The restore tab inside it is narrower still — the edge function
  // refuses anyone who is not super_admin, whatever this table says.
  backup:         ['admin','super_admin'],
  photogallery:   ['admin','super_admin','hod','hoa','lecturer','student','principal','deputy_principal'],
  notes:          ['admin','super_admin','hod','hoa','lecturer','student','principal','deputy_principal'],

  // HR Management — super_admin/hr full access; manager read-only.
  // 'admin' is intentionally excluded: admin is LMS-only.
  'hr-dashboard':            ['super_admin','hr','manager'],
  'hr-employees':            ['super_admin','hr','manager'],
  'hr-employee-detail':      ['super_admin','hr','manager'],
  'hr-employee-form':        ['super_admin','hr'],
  'hr-departments':          ['super_admin','hr'],
  'accountant-dashboard':    ['super_admin','admin','accountant'],
  'hr-payslips':             ['super_admin','admin','accountant'],
  // Self-service roles open it read-only from My Payslips ("View"). Every field
  // and action on the page is gated on can('payslips','write'), and RLS
  // (payslips_self_select) returns only the viewer's own payslips.
  'hr-payslip-detail':       ['super_admin','admin','accountant','hr','manager','employee','lecturer','hod','hoa','principal','deputy_principal'],
  'hr-payslip-batch':        ['super_admin','admin','accountant'],
  'hr-payroll-report':       ['super_admin','admin','accountant'],
  'hr-pay-components':       ['super_admin','admin','accountant'],
  'hr-contracts':            ['super_admin','admin','accountant'],
  'hr-contract-detail':      ['super_admin','admin','accountant'],
  'hr-contract-templates':   ['super_admin','admin','accountant'],
  'hr-leaves':               ['super_admin','hr','manager'],
  'hr-leave-types':          ['super_admin','hr'],
  'hr-leave-report':         ['super_admin','hr','manager'],
  'hr-loans':                ['super_admin','hr','manager'],
  'hr-loan-types':           ['super_admin','hr'],
  'hr-loan-report':          ['super_admin','hr','manager'],
  'hr-documents':            ['super_admin','hr'],
  'hr-document-expiry':      ['super_admin','hr','manager'],
  'hr-document-settings':    ['super_admin','hr'],
  // Also reachable by individual staff via Self Service → My Attendance,
  // where HRAttendanceReportPage self-filters to just their own punches.
  'hr-attendance-report':    ['super_admin','hr','manager','employee','lecturer','hod','hoa','principal','deputy_principal'],
  'hr-attendance-live':      ['super_admin','hr','manager'],
  'hr-attendance-records':   ['super_admin','hr','manager'],
  'hr-attendance-settings':  ['super_admin','hr'],
  'hr-workflows':            ['super_admin'],
  'hr-workflow-editor':      ['super_admin'],
  'hr-employee-groups':      ['super_admin'],
  'hr-user-management':      ['super_admin'],
  'hr-config':               ['super_admin','hr'],

  // Employee self-service — visible to anyone with an HR self-service role.
  // 'admin' is intentionally excluded: admin is LMS-only. Principal and deputy
  // are staff too, and each user holds exactly one role (useAuth reads it with
  // .single()), so they are listed here rather than given a second role.
  'my-payslips':       ['super_admin','hr','manager','employee','lecturer','hod','hoa','principal','deputy_principal'],
  'my-leaves':         ['super_admin','hr','manager','employee','lecturer','hod','hoa','principal','deputy_principal'],
  'my-loans':          ['super_admin','hr','manager','employee','lecturer','hod','hoa','principal','deputy_principal'],
  'my-employee-file':  ['super_admin','hr','manager','employee','lecturer','hod','hoa','principal','deputy_principal'],
  'my-advance-salary': ['super_admin','hr','manager','employee','lecturer','hod','hoa','principal','deputy_principal'],

  // LMS view of the Exams page, practical and recipe types only. Same
  // rows, same rules, so it has exactly the same audience as 'exams'.
  practicals: ['admin','super_admin','hod','hoa','lecturer','principal','deputy_principal'],
  // SMS view of User Management, pre-filtered to student logins. Same
  // audience as 'usermanagement', because it is that page.
  'student-accounts': ['admin','super_admin'],
};
