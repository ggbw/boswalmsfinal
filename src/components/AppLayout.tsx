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
  usermanagement: UserManagementPage, photogallery: PhotoGalleryPage, notes: NotesPage,
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
  dashboard:      ['admin','super_admin','hr','manager','employee','hod','hoy','lecturer','student'],
  profile:        ['admin','super_admin','hr','manager','employee','hod','hoy','lecturer','student'],
  notifications:  ['admin','super_admin','hr','manager','employee','hod','hoy','lecturer','student'],
  students:       ['admin','hod','hoy','lecturer'],
  lecturers:      ['admin'],
  classes:        ['admin'],
  modules:        ['admin','hod','lecturer'],
  timetable:      ['admin','hod','hoy','lecturer'],
  attendance:     ['admin','hod','hoy','lecturer'],
  exams:          ['admin','hod','hoy','lecturer'],
  assignments:    ['admin','hod','hoy','lecturer','student'],
  results:        ['admin','hod','hoy','lecturer','student'],
  reports:        ['admin','hod','hoy'],
  transcripts:    ['admin','hod','hoy','student'],
  admissions:     ['admin'],
  progression:    ['admin','hod','hoy'],
  config:         ['admin'],
  grades:         ['admin','hod','hoy'],
  mystudents:     ['hod','hoy','lecturer'],
  mytimetable:    ['student'],
  mymodules:      ['student'],
  mapping:        ['admin','hod'],
  usermanagement: ['admin'],
  photogallery:   ['admin','hod','hoy','lecturer','student'],
  notes:          ['admin','hod','hoy','lecturer','student'],

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
  'my-payslips':       ['super_admin','hr','manager','employee','lecturer','hod','hoy'],
  'my-leaves':         ['super_admin','hr','manager','employee','lecturer','hod','hoy'],
  'my-loans':          ['super_admin','hr','manager','employee','lecturer','hod','hoy'],
  'my-employee-file':  ['super_admin','hr','manager','employee','lecturer','hod','hoy'],
  'my-advance-salary': ['super_admin','hr','manager','employee','lecturer','hod','hoy'],
};

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
