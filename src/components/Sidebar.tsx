import { useEffect, useState } from "react";
import { useApp } from "@/context/AppContext";
import { useUserRole } from "@/hooks/hr/useUserRole";
import { supabase } from "@/integrations/supabase/client";

// Counts of pending HR approvals shown as badges next to the Leaves / Loans
// menu items. Returns zeros when the user lacks HR access — the query is
// skipped entirely so non-HR roles don't poke at HR tables.
//
// Note: boswalmsfinal's employees table does not have an `employee_type`
// column, so we don't try to embed it (doing so returns 400 from PostgREST).
// The hook only runs for HR/admin, which already implies canSeeManagers, so
// the manager-vs-regular filtering motho2 used here is a no-op anyway.
function useHrPendingCounts(isHR: boolean): HrPendingCounts {
  const [counts, setCounts] = useState<HrPendingCounts>({ pendingLeaves: 0, pendingLoans: 0 });
  useEffect(() => {
    if (!isHR) {
      setCounts({ pendingLeaves: 0, pendingLoans: 0 });
      return;
    }
    let alive = true;
    void (async () => {
      const [leavesRes, loansRes] = await Promise.all([
        supabase.from('leave_requests').select('id').eq('status', 'pending'),
        supabase.from('advance_salaries').select('id').eq('status', 'Submitted'),
      ]);
      if (!alive) return;
      setCounts({
        pendingLeaves: (leavesRes.data ?? []).length,
        pendingLoans:  (loansRes.data  ?? []).length,
      });
    })();
    return () => { alive = false; };
  }, [isHR]);
  return counts;
}

interface NavItem {
  id: string;
  label: string;
  icon: string;
  badge?: number;
  children?: NavItem[];
}
interface NavSection {
  section: string;
  items: NavItem[];
}

interface HrPendingCounts {
  pendingLeaves: number;
  pendingLoans: number;
}

const buildHrManagementSection = (pending: HrPendingCounts): NavSection => ({
  section: "HR Management",
  items: [
    { id: "hr-dashboard", label: "HR Dashboard", icon: "fa-solid fa-chart-line" },
    {
      id: "hr-group-employees",
      label: "Employees",
      icon: "fa-solid fa-users",
      children: [
        { id: "hr-employees", label: "Employees", icon: "fa-solid fa-user" },
        { id: "hr-departments", label: "HR Departments", icon: "fa-solid fa-building" },
      ],
    },
    {
      id: "hr-group-payroll",
      label: "Payroll",
      icon: "fa-solid fa-money-check-dollar",
      children: [
        { id: "hr-payslips", label: "Payslips", icon: "fa-solid fa-receipt" },
        { id: "hr-payroll-report", label: "Payroll Report", icon: "fa-solid fa-file-invoice-dollar" },
        { id: "hr-pay-components", label: "Pay Components", icon: "fa-solid fa-coins" },
      ],
    },
    {
      id: "hr-group-contracts",
      label: "Contracts",
      icon: "fa-solid fa-file-signature",
      children: [
        { id: "hr-contracts", label: "Contracts", icon: "fa-solid fa-file-signature" },
        { id: "hr-contract-templates", label: "Contract Templates", icon: "fa-solid fa-file-lines" },
      ],
    },
    {
      id: "hr-group-leaves",
      label: "Leaves",
      icon: "fa-solid fa-calendar-days",
      children: [
        {
          id: "hr-leaves",
          label: "Leaves",
          icon: "fa-solid fa-calendar-days",
          badge: pending.pendingLeaves > 0 ? pending.pendingLeaves : undefined,
        },
        { id: "hr-leave-types", label: "Leave Types", icon: "fa-solid fa-list-check" },
        { id: "hr-leave-report", label: "Leave Report", icon: "fa-solid fa-file-export" },
      ],
    },
    {
      id: "hr-group-loans",
      label: "Loans",
      icon: "fa-solid fa-credit-card",
      children: [
        {
          id: "hr-loans",
          label: "Loans / Advances",
          icon: "fa-solid fa-hand-holding-dollar",
          badge: pending.pendingLoans > 0 ? pending.pendingLoans : undefined,
        },
        { id: "hr-loan-types", label: "Loan Types", icon: "fa-solid fa-tags" },
        { id: "hr-loan-report", label: "Loan Report", icon: "fa-solid fa-file-export" },
      ],
    },
    {
      id: "hr-group-documents",
      label: "Documents",
      icon: "fa-solid fa-folder",
      children: [
        { id: "hr-documents", label: "Employee Documents", icon: "fa-solid fa-folder-open" },
        { id: "hr-document-expiry", label: "Document Expiry", icon: "fa-solid fa-triangle-exclamation" },
        { id: "hr-document-settings", label: "Document Settings", icon: "fa-solid fa-sliders" },
      ],
    },
    {
      id: "hr-group-attendance",
      label: "Attendance",
      icon: "fa-solid fa-clipboard-user",
      children: [
        { id: "hr-attendance-live",    label: "Live Dashboard",    icon: "fa-solid fa-display" },
        { id: "hr-attendance-report",  label: "Attendance Report", icon: "fa-solid fa-clipboard-user" },
        { id: "hr-attendance-records", label: "Raw Punches",       icon: "fa-solid fa-list" },
        { id: "hr-attendance-settings", label: "Devices & Settings", icon: "fa-solid fa-sliders" },
      ],
    },
    {
      id: "hr-group-admin",
      label: "Administration",
      icon: "fa-solid fa-gear",
      children: [
        { id: "hr-user-management", label: "HR User Management", icon: "fa-solid fa-user-shield" },
        { id: "hr-workflows", label: "Workflow Management", icon: "fa-solid fa-diagram-project" },
        { id: "hr-employee-groups", label: "Employee Groups", icon: "fa-solid fa-people-group" },
        { id: "hr-config", label: "HR Configuration", icon: "fa-solid fa-gear" },
      ],
    },
  ],
});

const SELF_SERVICE_SECTION: NavSection = {
  section: "Self Service",
  items: [
    { id: "my-employee-file", label: "My File", icon: "fa-solid fa-id-card" },
    { id: "my-payslips", label: "My Payslips", icon: "fa-solid fa-receipt" },
    { id: "my-leaves", label: "My Leaves", icon: "fa-solid fa-calendar-check" },
    { id: "my-loans", label: "My Loans", icon: "fa-solid fa-hand-holding-dollar" },
  ],
};

function getNavConfig(role: string, db: any, hrPending: HrPendingCounts): NavSection[] {
  const HR_MANAGEMENT_SECTION = buildHrManagementSection(hrPending);
  const adminLmsSections: NavSection[] = [
    {
      section: "Main",
      items: [
        { id: "dashboard", label: "Dashboard", icon: "fa-solid fa-gauge" },
        { id: "notifications", label: "Notifications", icon: "fa-solid fa-bullhorn", badge: db.notifications.length },
      ],
    },
    {
      section: "Academic",
      items: [
        { id: "students", label: "Students", icon: "fa-solid fa-user-graduate", badge: db.students.length },
        { id: "lecturers", label: "Lecturers", icon: "fa-solid fa-chalkboard-user" },
        { id: "classes", label: "Classes", icon: "fa-solid fa-school" },
        { id: "timetable", label: "Timetable", icon: "fa-solid fa-calendar-days" },
      ],
    },
    {
      section: "Operations",
      items: [
        { id: "attendance", label: "Attendance", icon: "fa-solid fa-clipboard-check" },
        { id: "exams", label: "Exams", icon: "fa-solid fa-file-pen" },
        { id: "assignments", label: "Assignments", icon: "fa-solid fa-list-check" },
        { id: "notes", label: "Notes", icon: "fa-solid fa-folder-open" },
        { id: "reports", label: "Reports", icon: "fa-solid fa-file-lines" },
        { id: "transcripts", label: "Transcripts", icon: "fa-solid fa-scroll" },
      ],
    },
    {
      section: "Management",
      items: [
        { id: "admissions", label: "Admissions", icon: "fa-solid fa-door-open" },
        { id: "progression", label: "Progression", icon: "fa-solid fa-arrow-up-right-dots" },
        { id: "photogallery", label: "Photo Gallery", icon: "fa-solid fa-images" },
        { id: "usermanagement", label: "User Management", icon: "fa-solid fa-users-gear" },
        { id: "config", label: "Configuration", icon: "fa-solid fa-gear" },
      ],
    },
  ];

  const configs: Record<string, NavSection[]> = {
    admin: adminLmsSections,
    super_admin: [...adminLmsSections, HR_MANAGEMENT_SECTION],
    hod: [
      { section: "Main", items: [{ id: "dashboard", label: "Dashboard", icon: "fa-solid fa-gauge" }] },
      {
        section: "Academic",
        items: [
          { id: "students", label: "Students", icon: "fa-solid fa-user-graduate" },
          { id: "mapping", label: "Module Mapping", icon: "fa-solid fa-diagram-project" },
        ],
      },
      {
        section: "Teaching",
        items: [
          { id: "mystudents", label: "My Students", icon: "fa-solid fa-users" },
          { id: "timetable", label: "Timetable", icon: "fa-solid fa-calendar-days" },
          { id: "attendance", label: "Mark Attendance", icon: "fa-solid fa-clipboard-check" },
          { id: "notes", label: "Notes", icon: "fa-solid fa-folder-open" },
        ],
      },
      {
        section: "Assessment",
        items: [
          { id: "exams", label: "Exams", icon: "fa-solid fa-file-pen" },
          { id: "assignments", label: "Assignments", icon: "fa-solid fa-list-check" },
          { id: "reports", label: "HOD Reports", icon: "fa-solid fa-file-lines" },
          { id: "transcripts", label: "Transcripts", icon: "fa-solid fa-scroll" },
        ],
      },
    ],
    hoy: [
      { section: "Main", items: [{ id: "dashboard", label: "Dashboard", icon: "fa-solid fa-gauge" }] },
      {
        section: "Students",
        items: [
          { id: "students", label: "All Students", icon: "fa-solid fa-user-graduate" },
          { id: "grades", label: "Grades Overview", icon: "fa-solid fa-star-half-stroke" },
          { id: "progression", label: "Promotion", icon: "fa-solid fa-arrow-up-right-dots" },
        ],
      },
      {
        section: "Teaching",
        items: [
          { id: "mystudents", label: "My Students", icon: "fa-solid fa-users" },
          { id: "timetable", label: "Timetable", icon: "fa-solid fa-calendar-days" },
          { id: "attendance", label: "Mark Attendance", icon: "fa-solid fa-clipboard-check" },
          { id: "notes", label: "Notes", icon: "fa-solid fa-folder-open" },
        ],
      },
      {
        section: "Assessment",
        items: [
          { id: "exams", label: "Exams", icon: "fa-solid fa-file-pen" },
          { id: "assignments", label: "Assignments", icon: "fa-solid fa-list-check" },
          { id: "reports", label: "Reports", icon: "fa-solid fa-file-lines" },
          { id: "transcripts", label: "Transcripts", icon: "fa-solid fa-scroll" },
        ],
      },
    ],
    lecturer: [
      { section: "Main", items: [{ id: "dashboard", label: "Dashboard", icon: "fa-solid fa-gauge" }] },
      {
        section: "Teaching",
        items: [
          { id: "mystudents", label: "My Students", icon: "fa-solid fa-users" },
          { id: "modules", label: "My Modules", icon: "fa-solid fa-book-open" },
          { id: "timetable", label: "Timetable", icon: "fa-solid fa-calendar-days" },
          { id: "attendance", label: "Mark Attendance", icon: "fa-solid fa-clipboard-check" },
        ],
      },
      {
        section: "Assessment",
        items: [
          { id: "exams", label: "Exams", icon: "fa-solid fa-file-pen" },
          { id: "assignments", label: "Assignments", icon: "fa-solid fa-list-check" },
          { id: "notes", label: "Notes", icon: "fa-solid fa-folder-open" },
          { id: "photogallery", label: "Photo Gallery", icon: "fa-solid fa-images" },
        ],
      },
    ],
    student: [
      {
        section: "Main",
        items: [
          { id: "dashboard", label: "My Dashboard", icon: "fa-solid fa-gauge" },
          { id: "profile", label: "My Profile", icon: "fa-solid fa-circle-user" },
        ],
      },
      {
        section: "Academic",
        items: [
          { id: "mymodules", label: "My Modules", icon: "fa-solid fa-book-open" },
          { id: "mytimetable", label: "My Timetable", icon: "fa-solid fa-calendar-days" },
          { id: "notes", label: "Notes", icon: "fa-solid fa-folder-open" },
          { id: "assignments", label: "Assignments", icon: "fa-solid fa-list-check" },
          { id: "results", label: "My Results", icon: "fa-solid fa-chart-line" },
          { id: "transcripts", label: "My Transcript", icon: "fa-solid fa-scroll" },
        ],
      },
    ],
    hr: [
      {
        section: "Main",
        items: [
          { id: "hr-dashboard", label: "Dashboard", icon: "fa-solid fa-gauge" },
          { id: "profile", label: "My Profile", icon: "fa-solid fa-circle-user" },
          { id: "notifications", label: "Notifications", icon: "fa-solid fa-bullhorn", badge: db.notifications.length },
        ],
      },
      HR_MANAGEMENT_SECTION,
      SELF_SERVICE_SECTION,
    ],
    manager: [
      {
        section: "Main",
        items: [
          { id: "dashboard", label: "Dashboard", icon: "fa-solid fa-gauge" },
          { id: "profile", label: "My Profile", icon: "fa-solid fa-circle-user" },
        ],
      },
      SELF_SERVICE_SECTION,
    ],
    employee: [
      {
        section: "Main",
        items: [
          { id: "dashboard", label: "Dashboard", icon: "fa-solid fa-gauge" },
          { id: "profile", label: "My Profile", icon: "fa-solid fa-circle-user" },
        ],
      },
      SELF_SERVICE_SECTION,
    ],
  };
  return configs[role] || configs.admin;
}

function hasActiveDescendant(item: NavItem, activeId: string): boolean {
  if (!item.children) return false;
  return item.children.some((c) => c.id === activeId || hasActiveDescendant(c, activeId));
}

export default function Sidebar() {
  const { db, currentUser, activePage, navigate, setCurrentUser } = useApp();
  const { isHR } = useUserRole();
  const role = currentUser?.role || "admin";
  const hrPending = useHrPendingCounts(isHR);
  const navConfig = getNavConfig(role, db, hrPending);

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const open: Record<string, boolean> = {};
    const walk = (items: NavItem[]) => {
      items.forEach((it) => {
        if (it.children) {
          if (hasActiveDescendant(it, activePage)) open[it.id] = true;
          walk(it.children);
        }
      });
    };
    navConfig.forEach((sec) => walk(sec.items));
    if (Object.keys(open).length) {
      setExpanded((prev) => ({ ...prev, ...open }));
    }
  }, [activePage, role]);

  const toggleGroup = (id: string) =>
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));

  const renderItem = (item: NavItem, depth: number) => {
    const isGroup = !!item.children && item.children.length > 0;
    const indentStyle = depth > 0 ? { paddingLeft: 16 + depth * 14 } : undefined;

    if (isGroup) {
      const open = !!expanded[item.id];
      const activeInside = hasActiveDescendant(item, activePage);
      return (
        <div key={item.id}>
          <div
            className={`nav-item nav-group ${activeInside ? "has-active" : ""}`}
            style={indentStyle}
            onClick={() => toggleGroup(item.id)}
          >
            <span className="ico">
              <i className={item.icon} />
            </span>
            {item.label}
            <i
              className={`nav-caret fa-solid ${open ? "fa-chevron-down" : "fa-chevron-right"}`}
            />
          </div>
          {open && (
            <div className="nav-children">
              {item.children!.map((child) => renderItem(child, depth + 1))}
            </div>
          )}
        </div>
      );
    }

    return (
      <div
        key={item.id}
        className={`nav-item ${activePage === item.id ? "active" : ""} ${depth > 0 ? "nav-child" : ""}`}
        style={indentStyle}
        onClick={() => navigate(item.id)}
      >
        <span className="ico">
          <i className={item.icon} />
        </span>
        {item.label}
        {item.badge !== undefined && (
          <span className={`nav-badge ${item.badge > 0 ? "new" : ""}`}>{item.badge}</span>
        )}
      </div>
    );
  };

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
        {navConfig.map((sec) => (
          <div key={sec.section}>
            <div className="nav-section">{sec.section}</div>
            {sec.items.map((item) => renderItem(item, 0))}
          </div>
        ))}
      </div>
      <div className="sidebar-footer" onClick={() => navigate("profile")}>
        <div className="s-avatar" style={{ background: "linear-gradient(135deg,#d4920a,#f0b429)" }}>
          {currentUser?.name?.[0]?.toUpperCase() || "A"}
        </div>
        <div>
          <div style={{ color: "#e6edf3", fontSize: 11, fontWeight: 600 }}>{currentUser?.name || "Admin"}</div>
          <div style={{ color: "#484f58", fontSize: 9.5 }}>{role === "hoy" ? "HOA" : role.toUpperCase()}</div>
        </div>
        <i
          className="fa-solid fa-right-from-bracket"
          title="Sign out"
          aria-label="Sign out"
          role="button"
          tabIndex={0}
          style={{ marginLeft: "auto", color: "#484f58", fontSize: 12, cursor: "pointer" }}
          onClick={(e) => {
            e.stopPropagation();
            setCurrentUser(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              e.stopPropagation();
              setCurrentUser(null);
            }
          }}
        />
      </div>
    </div>
  );
}
