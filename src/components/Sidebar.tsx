import { useApp } from '@/context/AppContext';

interface NavItem { id: string; label: string; icon: string; badge?: number; }
interface NavSection { section: string; items: NavItem[]; }

function getNavConfig(role: string, db: any): NavSection[] {
  const configs: Record<string, NavSection[]> = {
    admin: [
      { section: 'Main', items: [
        { id: 'dashboard', label: 'Dashboard', icon: 'fa-solid fa-gauge' },
        { id: 'notifications', label: 'Notifications', icon: 'fa-solid fa-bullhorn', badge: db.notifications.length },
      ]},
      { section: 'Academic', items: [
        { id: 'students', label: 'Students', icon: 'fa-solid fa-user-graduate', badge: db.students.length },
        { id: 'lecturers', label: 'Lecturers', icon: 'fa-solid fa-chalkboard-user' },
        { id: 'classes', label: 'Classes', icon: 'fa-solid fa-school' },
        { id: 'modules', label: 'Modules', icon: 'fa-solid fa-book-open' },
        { id: 'timetable', label: 'Timetable', icon: 'fa-solid fa-calendar-days' },
      ]},
      { section: 'Operations', items: [
        { id: 'attendance', label: 'Attendance', icon: 'fa-solid fa-clipboard-check' },
        { id: 'exams', label: 'Exams', icon: 'fa-solid fa-file-pen' },
        { id: 'assignments', label: 'Assignments', icon: 'fa-solid fa-list-check' },
        { id: 'results', label: 'Results', icon: 'fa-solid fa-chart-line' },
        { id: 'reports', label: 'Reports', icon: 'fa-solid fa-file-lines' },
        { id: 'transcripts', label: 'Transcripts', icon: 'fa-solid fa-scroll' },
      ]},
      { section: 'Management', items: [
        { id: 'admissions', label: 'Admissions', icon: 'fa-solid fa-door-open' },
        { id: 'progression', label: 'Progression', icon: 'fa-solid fa-arrow-up-right-dots' },
        { id: 'usermanagement', label: 'User Management', icon: 'fa-solid fa-users-gear' },
        { id: 'config', label: 'Configuration', icon: 'fa-solid fa-gear' },
      ]},
    ],
    hod: [
      { section: 'Main', items: [{ id: 'dashboard', label: 'Dashboard', icon: 'fa-solid fa-gauge' }] },
      { section: 'Academic', items: [
        { id: 'students', label: 'Students', icon: 'fa-solid fa-user-graduate' },
        { id: 'modules', label: 'Modules', icon: 'fa-solid fa-book-open' },
        { id: 'mapping', label: 'Module Mapping', icon: 'fa-solid fa-diagram-project' },
      ]},
      { section: 'Reports', items: [
        { id: 'exams', label: 'Exams', icon: 'fa-solid fa-file-pen' },
        { id: 'results', label: 'Results', icon: 'fa-solid fa-chart-line' },
        { id: 'reports', label: 'HOD Reports', icon: 'fa-solid fa-file-lines' },
        { id: 'transcripts', label: 'Transcripts', icon: 'fa-solid fa-scroll' },
      ]},
    ],
    hoy: [
      { section: 'Main', items: [{ id: 'dashboard', label: 'Dashboard', icon: 'fa-solid fa-gauge' }] },
      { section: 'Students', items: [
        { id: 'students', label: 'All Students', icon: 'fa-solid fa-user-graduate' },
        { id: 'grades', label: 'Grades Overview', icon: 'fa-solid fa-star-half-stroke' },
        { id: 'progression', label: 'Promotion', icon: 'fa-solid fa-arrow-up-right-dots' },
      ]},
      { section: 'Reports', items: [
        { id: 'reports', label: 'Reports', icon: 'fa-solid fa-file-lines' },
        { id: 'transcripts', label: 'Transcripts', icon: 'fa-solid fa-scroll' },
      ]},
    ],
    lecturer: [
      { section: 'Main', items: [{ id: 'dashboard', label: 'Dashboard', icon: 'fa-solid fa-gauge' }] },
      { section: 'Teaching', items: [
        { id: 'mystudents', label: 'My Students', icon: 'fa-solid fa-users' },
        { id: 'modules', label: 'My Modules', icon: 'fa-solid fa-book-open' },
        { id: 'timetable', label: 'Timetable', icon: 'fa-solid fa-calendar-days' },
        { id: 'attendance', label: 'Mark Attendance', icon: 'fa-solid fa-clipboard-check' },
      ]},
      { section: 'Assessment', items: [
        { id: 'exams', label: 'Exams', icon: 'fa-solid fa-file-pen' },
        { id: 'assignments', label: 'Assignments', icon: 'fa-solid fa-list-check' },
        { id: 'results', label: 'Input Results', icon: 'fa-solid fa-chart-line' },
      ]},
    ],
    student: [
      { section: 'Main', items: [
        { id: 'dashboard', label: 'My Dashboard', icon: 'fa-solid fa-gauge' },
        { id: 'profile', label: 'My Profile', icon: 'fa-solid fa-circle-user' },
      ]},
      { section: 'Academic', items: [
        { id: 'mymodules', label: 'My Modules', icon: 'fa-solid fa-book-open' },
        { id: 'mystudents', label: 'My Timetable', icon: 'fa-solid fa-calendar-days' },
        { id: 'assignments', label: 'Assignments', icon: 'fa-solid fa-list-check' },
        { id: 'results', label: 'My Results', icon: 'fa-solid fa-chart-line' },
        { id: 'transcripts', label: 'My Transcript', icon: 'fa-solid fa-scroll' },
      ]},
    ],
  };
  return configs[role] || configs.admin;
}

export default function Sidebar() {
  const { db, currentUser, activePage, navigate, setCurrentUser } = useApp();
  const role = currentUser?.role || 'admin';
  const navConfig = getNavConfig(role, db);

  return (
    <div className="sidebar">
      <div className="logo">
        <div className="logo-img">B</div>
        <div className="logo-text">
          <div className="name">Boswa CIB SMS</div>
          <div className="sub">School Management</div>
        </div>
      </div>
      <div className="nav-menu">
        {navConfig.map(sec => (
          <div key={sec.section}>
            <div className="nav-section">{sec.section}</div>
            {sec.items.map(item => (
              <div key={item.id} className={`nav-item ${activePage === item.id ? 'active' : ''}`} onClick={() => navigate(item.id)}>
                <span className="ico"><i className={item.icon} /></span>
                {item.label}
                {item.badge !== undefined && <span className={`nav-badge ${item.badge > 0 ? 'new' : ''}`}>{item.badge}</span>}
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="sidebar-footer" onClick={() => navigate('profile')}>
        <div className="s-avatar" style={{ background: 'linear-gradient(135deg,#d4920a,#f0b429)' }}>
          {currentUser?.name?.[0]?.toUpperCase() || 'A'}
        </div>
        <div>
          <div style={{ color: '#e6edf3', fontSize: 11, fontWeight: 600 }}>{currentUser?.name || 'Admin'}</div>
          <div style={{ color: '#484f58', fontSize: 9.5 }}>{role.toUpperCase()}</div>
        </div>
        <i className="fa-solid fa-right-from-bracket" style={{ marginLeft: 'auto', color: '#484f58', fontSize: 12, cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); setCurrentUser(null); }} />
      </div>
    </div>
  );
}
