import { useState } from 'react';
import { useApp } from '@/context/AppContext';
import Sidebar from '@/components/Sidebar';
import Dashboard from '@/pages/DashboardPage';
import StudentsPage from '@/pages/StudentsPage';
import LecturersPage from '@/pages/LecturersPage';
import ClassesPage from '@/pages/ClassesPage';
import ModulesPage from '@/pages/ModulesPage';
import TimetablePage from '@/pages/TimetablePage';
import AttendancePage from '@/pages/AttendancePage';
import ExamsPage from '@/pages/ExamsPage';
import AssignmentsPage from '@/pages/AssignmentsPage';
import ResultsPage from '@/pages/ResultsPage';
import ReportsPage from '@/pages/ReportsPage';
import TranscriptsPage from '@/pages/TranscriptsPage';
import AdmissionsPage from '@/pages/AdmissionsPage';
import ProgressionPage from '@/pages/ProgressionPage';
import ConfigPage from '@/pages/ConfigPage';
import NotificationsPage from '@/pages/NotificationsPage';
import ProfilePage from '@/pages/ProfilePage';
import GradesPage from '@/pages/GradesPage';
import MyStudentsPage from '@/pages/MyStudentsPage';
import MyModulesPage from '@/pages/MyModulesPage';
import MappingPage from '@/pages/MappingPage';
import UserManagementPage from '@/pages/UserManagementPage';
import RegistrationsPage from '@/pages/RegistrationsPage';
import PhotoGalleryPage from '@/pages/PhotoGalleryPage';
import NotesPage from '@/pages/NotesPage';
import HRComingSoonPage from '@/pages/hr/HRComingSoonPage';
import EmployeesPage from '@/pages/hr/EmployeesPage';
import EmployeeFormPage from '@/pages/hr/EmployeeFormPage';
import EmployeeDetailPage from '@/pages/hr/EmployeeDetailPage';
import HrDepartmentsPage from '@/pages/hr/HrDepartmentsPage';
import PayComponentsPage from '@/pages/hr/PayComponentsPage';
import LeaveTypesPage from '@/pages/hr/LeaveTypesPage';
import LoanTypesPage from '@/pages/hr/LoanTypesPage';
import LeavesPage from '@/pages/hr/LeavesPage';
import LoansPage from '@/pages/hr/LoansPage';
import HRDashboardPage from '@/pages/hr/HRDashboardPage';
import HRConfigPage from '@/pages/hr/HRConfigPage';
import ContractsPage from '@/pages/hr/ContractsPage';
import ContractDetailPage from '@/pages/hr/ContractDetailPage';
import ContractTemplatesPage from '@/pages/hr/ContractTemplatesPage';
import PayslipsPage from '@/pages/hr/PayslipsPage';
import PayslipDetailPage from '@/pages/hr/PayslipDetailPage';
import PayslipBatchPage from '@/pages/hr/PayslipBatchPage';
import HRReportsPage from '@/pages/hr/HRReportsPage';
import HRLeaveReportPage from '@/pages/hr/HRLeaveReportPage';
import HRDocumentsPage from '@/pages/hr/HRDocumentsPage';
import HRAttendanceReportPage from '@/pages/hr/HRAttendanceReportPage';
import HRLiveAttendancePage from '@/pages/hr/HRLiveAttendancePage';
import HRAttendanceRecordsPage from '@/pages/hr/HRAttendanceRecordsPage';
import AttendanceSettingsPage from '@/pages/hr/AttendanceSettingsPage';
import WorkflowsPage from '@/pages/hr/WorkflowsPage';
import WorkflowEditorPage from '@/pages/hr/WorkflowEditorPage';
import EmployeeGroupsPage from '@/pages/hr/EmployeeGroupsPage';
import HRUserManagementPage from '@/pages/hr/HRUserManagementPage';
import DocumentSettingsPage from '@/pages/hr/DocumentSettingsPage';
import MyLeavesPage from '@/pages/hr/self-service/MyLeavesPage';
import MyLoansPage from '@/pages/hr/self-service/MyLoansPage';
import MyPayslipsPage from '@/pages/hr/self-service/MyPayslipsPage';
import MyEmployeeFilePage from '@/pages/hr/self-service/MyEmployeeFilePage';
import ForcePasswordChange from '@/components/hr/ForcePasswordChange';
import NotificationBell from '@/components/hr/NotificationBell';
import ImpersonationBanner from '@/components/hr/ImpersonationBanner';
import { useAuth } from '@/hooks/useAuth';

const HR_PAGE_IDS = [
  'hr-dashboard',
  'hr-departments',
  'hr-payslips',
  'hr-payslip-detail',
  'hr-payslip-batch',
  'hr-payroll-report',
  'hr-pay-components',
  'hr-contracts',
  'hr-contract-detail',
  'hr-contract-templates',
  'hr-leaves',
  'hr-leave-types',
  'hr-leave-report',
  'hr-loans',
  'hr-loan-types',
  'hr-loan-report',
  'hr-documents',
  'hr-document-expiry',
  'hr-document-settings',
  'hr-attendance-report',
  'hr-attendance-live',
  'hr-attendance-records',
  'hr-attendance-settings',
  'hr-workflows',
  'hr-workflow-editor',
  'hr-employee-groups',
  'hr-user-management',
  'hr-config',
  'my-payslips',
  'my-leaves',
  'my-loans',
  'my-employee-file',
  'my-advance-salary',
] as const;

const hrPlaceholders: Record<string, React.ComponentType> = HR_PAGE_IDS.reduce(
  (acc, id) => ({ ...acc, [id]: HRComingSoonPage }),
  {} as Record<string, React.ComponentType>,
);

const pageComponents: Record<string, React.ComponentType> = {
  dashboard: Dashboard, students: StudentsPage, lecturers: LecturersPage,
  classes: ClassesPage, modules: ModulesPage, timetable: TimetablePage,
  attendance: AttendancePage, exams: ExamsPage, assignments: AssignmentsPage,
  results: ResultsPage, reports: ReportsPage, transcripts: TranscriptsPage,
  admissions: AdmissionsPage, progression: ProgressionPage, config: ConfigPage,
  notifications: NotificationsPage, profile: ProfilePage, grades: GradesPage,
  mystudents: MyStudentsPage, mytimetable: MyStudentsPage,
  mymodules: MyModulesPage, mapping: MappingPage,
  usermanagement: UserManagementPage, registrations: RegistrationsPage, photogallery: PhotoGalleryPage, notes: NotesPage,
  ...hrPlaceholders,
  // Real HR pages override the placeholders
  'hr-dashboard': HRDashboardPage,
  'hr-employees': EmployeesPage,
  'hr-employee-form': EmployeeFormPage,
  'hr-employee-detail': EmployeeDetailPage,
  'hr-departments': HrDepartmentsPage,
  'hr-pay-components': PayComponentsPage,
  'hr-leave-types': LeaveTypesPage,
  'hr-loan-types': LoanTypesPage,
  'hr-leaves': LeavesPage,
  'hr-loans': LoansPage,
  'hr-config': HRConfigPage,
  'hr-contracts': ContractsPage,
  'hr-contract-detail': ContractDetailPage,
  'hr-contract-templates': ContractTemplatesPage,
  'hr-payslips': PayslipsPage,
  'hr-payslip-detail': PayslipDetailPage,
  'hr-payslip-batch': PayslipBatchPage,
  'hr-payroll-report': HRReportsPage,
  'hr-leave-report': HRLeaveReportPage,
  'hr-loan-report': HRReportsPage,
  'hr-documents': HRDocumentsPage,
  'hr-document-expiry': HRDocumentsPage,
  'hr-document-settings': DocumentSettingsPage,
  'hr-attendance-report': HRAttendanceReportPage,
  'hr-attendance-live': HRLiveAttendancePage,
  'hr-attendance-records': HRAttendanceRecordsPage,
  'hr-attendance-settings': AttendanceSettingsPage,
  'hr-workflows': WorkflowsPage,
  'hr-workflow-editor': WorkflowEditorPage,
  'hr-employee-groups': EmployeeGroupsPage,
  'hr-user-management': HRUserManagementPage,
  'my-leaves': MyLeavesPage,
  'my-loans': MyLoansPage,
  'my-payslips': MyPayslipsPage,
  'my-employee-file': MyEmployeeFilePage,
  'my-advance-salary': MyLoansPage,
};

const ROLE_PAGES: Record<string, string[]> = {
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
  photogallery:   ['admin','super_admin','hod','hoa','lecturer','student','principal','deputy_principal'],
  notes:          ['admin','super_admin','hod','hoa','lecturer','student','principal','deputy_principal'],

  // HR Management — super_admin/hr full access; manager read-only.
  // 'admin' is intentionally excluded: admin is LMS-only.
  'hr-dashboard':            ['super_admin','hr','manager'],
  'hr-employees':            ['super_admin','hr','manager'],
  'hr-employee-detail':      ['super_admin','hr','manager'],
  'hr-employee-form':        ['super_admin','hr'],
  'hr-departments':          ['super_admin','hr'],
  'hr-payslips':             ['super_admin','hr'],
  'hr-payslip-detail':       ['super_admin','hr'],
  'hr-payslip-batch':        ['super_admin','hr'],
  'hr-payroll-report':       ['super_admin','hr','manager'],
  'hr-pay-components':       ['super_admin','hr'],
  'hr-contracts':            ['super_admin','hr'],
  'hr-contract-detail':      ['super_admin','hr'],
  'hr-contract-templates':   ['super_admin','hr'],
  'hr-leaves':               ['super_admin','hr','manager'],
  'hr-leave-types':          ['super_admin','hr'],
  'hr-leave-report':         ['super_admin','hr','manager'],
  'hr-loans':                ['super_admin','hr','manager'],
  'hr-loan-types':           ['super_admin','hr'],
  'hr-loan-report':          ['super_admin','hr','manager'],
  'hr-documents':            ['super_admin','hr'],
  'hr-document-expiry':      ['super_admin','hr','manager'],
  'hr-document-settings':    ['super_admin','hr'],
  'hr-attendance-report':    ['super_admin','hr','manager'],
  'hr-attendance-live':      ['super_admin','hr','manager'],
  'hr-attendance-records':   ['super_admin','hr','manager'],
  'hr-attendance-settings':  ['super_admin','hr'],
  'hr-workflows':            ['super_admin'],
  'hr-workflow-editor':      ['super_admin'],
  'hr-employee-groups':      ['super_admin'],
  'hr-user-management':      ['super_admin'],
  'hr-config':               ['super_admin','hr'],

  // Employee self-service — visible to anyone with an HR self-service role.
  // 'admin' is intentionally excluded: admin is LMS-only.
  'my-payslips':       ['super_admin','hr','manager','employee','lecturer','hod','hoa'],
  'my-leaves':         ['super_admin','hr','manager','employee','lecturer','hod','hoa'],
  'my-loans':          ['super_admin','hr','manager','employee','lecturer','hod','hoa'],
  'my-employee-file':  ['super_admin','hr','manager','employee','lecturer','hod','hoa'],
  'my-advance-salary': ['super_admin','hr','manager','employee','lecturer','hod','hoa'],
};

/**
 * Shown when part of the last data load failed.
 *
 * Without this, a failed query renders as an empty list — so "the database
 * refused this request" and "there is genuinely nothing here" look identical.
 * That is the single biggest reason faults in this system were hard to
 * reproduce: nobody, including the person reporting them, could tell which
 * one they were looking at.
 */
function LoadFailureBanner() {
  const { failures, reloadDb } = useApp();
  const [dismissed, setDismissed] = useState(false);
  if (!failures.length || dismissed) return null;

  return (
    <div
      role="alert"
      style={{
        background: '#fff8c5', borderBottom: '1px solid #ffe07c', color: '#7a4f00',
        padding: '10px 18px', fontSize: 12.5, lineHeight: 1.55,
        display: 'flex', alignItems: 'flex-start', gap: 12,
      }}
    >
      <i className="fa-solid fa-triangle-exclamation" style={{ marginTop: 2 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <strong>Some data could not be loaded.</strong> What you see below is incomplete —
        please don't rely on it for reporting or marking until this is resolved.
        <div style={{ marginTop: 4, fontFamily: "'JetBrains Mono',monospace", fontSize: 11, opacity: 0.85 }}>
          {failures.map(f => `${f.table}: ${f.message}`).join(' · ')}
        </div>
      </div>
      <button className="btn btn-outline btn-sm" onClick={() => reloadDb()}>Retry</button>
      <button
        className="btn btn-outline btn-sm"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  );
}

export default function AppLayout() {
  const { db, activePage, currentUser, toasts, modalContent, closeModal } = useApp();
  const { user, profile } = useAuth();
  // First-login password reset. Inert when the profile column is absent
  // (older schemas) because the read coerces to false.
  const mustChangePassword = Boolean(
    (profile as { must_change_password?: boolean } | null)?.must_change_password,
  );
  // Default to the most restrictive role if none is set, so an unset role
  // cannot accidentally land on an admin-gated page.
  const role = currentUser?.role || 'student';
  const allowed = ROLE_PAGES[activePage] ?? [];
  const PageComponent = allowed.includes(role)
    ? (pageComponents[activePage] || Dashboard)
    : Dashboard;
  // Removed term reference - semester only

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <Sidebar />
      <div className="main-area" style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <ImpersonationBanner />
        <LoadFailureBanner />
        <div className="topbar">
          <div className="breadcrumb">
            <span>Boswa CIB</span>
            <span style={{ color: 'var(--border)' }}>›</span>
            <span className="current">{activePage.charAt(0).toUpperCase() + activePage.slice(1).replace(/([A-Z])/g, ' $1')}</span>
          </div>
          <div className="topbar-right" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span className="tb-badge">{db.config.currentYear} · Semester {db.config.currentSemester}</span>
            <NotificationBell />
          </div>
        </div>
        <div className="content-area">
          <PageComponent />
        </div>
      </div>

      {/* Toast */}
      <div className="toast-wrap">
        {toasts.map(t => (
          <div key={t.id} className={`toast-item ${t.type}`}>{t.msg}</div>
        ))}
      </div>

      {/* Modal */}
      {modalContent && (
        <div className="modal-overlay open" onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}>
          <div className="modal" style={{ maxWidth: modalContent.size === 'large' ? 780 : 560 }}>
            <div className="modal-header">
              <div className="modal-title">{modalContent.title}</div>
              <button className="modal-close" onClick={closeModal}>✕</button>
            </div>
            <div>{modalContent.body}</div>
          </div>
        </div>
      )}

      {/* First-login password reset (full-screen blocking modal). Renders only
          when profile.must_change_password === true; inert otherwise. */}
      {mustChangePassword && user?.id && (
        <ForcePasswordChange userId={user.id} onDone={() => { /* refreshProfile inside flips the flag */ }} />
      )}
    </div>
  );
}
