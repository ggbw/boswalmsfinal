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

const pageComponents: Record<string, React.ComponentType> = {
  dashboard: Dashboard, students: StudentsPage, lecturers: LecturersPage,
  classes: ClassesPage, modules: ModulesPage, timetable: TimetablePage,
  attendance: AttendancePage, exams: ExamsPage, assignments: AssignmentsPage,
  results: ResultsPage, reports: ReportsPage, transcripts: TranscriptsPage,
  admissions: AdmissionsPage, progression: ProgressionPage, config: ConfigPage,
  notifications: NotificationsPage, profile: ProfilePage, grades: GradesPage,
  mystudents: MyStudentsPage, mymodules: MyModulesPage, mapping: MappingPage,
};

export default function AppLayout() {
  const { db, activePage, toasts, modalContent, closeModal } = useApp();
  const PageComponent = pageComponents[activePage] || Dashboard;
  const currentTerm = db.config.terms.find(t => t.id === 't' + db.config.currentTerm) || db.config.terms[0];

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
            <span className="tb-badge">{db.config.currentYear} · {currentTerm?.name || 'Term 1'} · Sem {db.config.currentSemester}</span>
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
