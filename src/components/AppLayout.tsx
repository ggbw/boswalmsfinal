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
};

const ROLE_PAGES: Record<string, string[]> = {
  dashboard:      ['admin','hod','hoy','lecturer','student'],
  profile:        ['admin','hod','hoy','lecturer','student'],
  notifications:  ['admin','hod','hoy','lecturer','student'],
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
};

export default function AppLayout() {
  const { db, activePage, currentUser, toasts, modalContent, closeModal } = useApp();
  const role = currentUser?.role || 'admin';
  const allowed = ROLE_PAGES[activePage] ?? ['admin'];
  const PageComponent = allowed.includes(role)
    ? (pageComponents[activePage] || Dashboard)
    : Dashboard;
  // Removed term reference - semester only

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <Sidebar />
      <div className="main-area">
        <div className="topbar">
          <div className="breadcrumb">
            <span>Boswa CIB</span>
            <span style={{ color: 'var(--border)' }}>›</span>
            <span className="current">{activePage.charAt(0).toUpperCase() + activePage.slice(1).replace(/([A-Z])/g, ' $1')}</span>
          </div>
          <div className="topbar-right">
            <span className="tb-badge">{db.config.currentYear} · Semester {db.config.currentSemester}</span>
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
    </div>
  );
}
