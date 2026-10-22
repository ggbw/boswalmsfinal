import { ROLE_PAGES, type AppRole } from '@/lib/rolePages';

/**
 * The sidebar menu, as one master tree split into three areas: LMS, SMS and
 * HR & Payroll.
 *
 * Who sees an item comes from ROLE_PAGES — the same table AppLayout uses as
 * the URL guard — so the menu can no longer drift from what a role may
 * actually open. It used to: twelve hand-written per-role menus, one of which
 * pointed a lecturer's "My Modules" at a student-only page that silently fell
 * back to the Dashboard.
 *
 * `roles` on an item exists ONLY to make the menu narrower than ROLE_PAGES
 * (src/lib/__tests__/navAreas.test.ts enforces that). It never grants access;
 * the guard in AppLayout still decides what renders.
 *
 * No React here, so the tree and its filters are unit tested directly.
 */

export type AreaId = 'lms' | 'sms' | 'hr';
export type BadgeKey = 'notifications' | 'students' | 'pendingLeaves' | 'pendingLoans';

export interface NavItem {
  id: string;
  label: string;
  icon: string;
  /** Wording for a specific role, e.g. a lecturer's "My Modules". */
  labelFor?: Partial<Record<AppRole, string>>;
  /** Use only when the menu must be NARROWER than ROLE_PAGES. */
  roles?: readonly AppRole[];
  badge?: BadgeKey;
  children?: NavItem[];
}

export interface NavSection {
  section: string;
  items: NavItem[];
}

export interface NavArea {
  id: AreaId;
  /** Tab text: "LMS", "SMS", "HR & Payroll". */
  label: string;
  /** Logo subtitle: "Learning Management", … */
  fullName: string;
  icon: string;
  sections: NavSection[];
}

export const TOP_SECTIONS: NavSection[] = [
  {
    section: 'Main',
    items: [
      {
        id: 'dashboard',
        label: 'Dashboard',
        icon: 'fa-solid fa-gauge',
        // HR already has "HR Dashboard" in its own area, and HR lands there
        // (App.tsx). The old menu dropped this duplicate on purpose.
        roles: (ROLE_PAGES.dashboard ?? []).filter((r) => r !== 'hr'),
        labelFor: { principal: 'School Overview', deputy_principal: 'Academic Overview' },
      },
      { id: 'notifications', label: 'Notifications', icon: 'fa-solid fa-bullhorn', badge: 'notifications' },
      { id: 'profile', label: 'My Profile', icon: 'fa-solid fa-circle-user' },
    ],
  },
];

const HR_MANAGEMENT_SECTION: NavSection = {
  section: 'HR Management',
  items: [
    { id: 'hr-dashboard', label: 'HR Dashboard', icon: 'fa-solid fa-chart-line' },
    {
      id: 'hr-group-employees',
      label: 'Employees',
      icon: 'fa-solid fa-users',
      children: [
        { id: 'hr-employees', label: 'Employees', icon: 'fa-solid fa-user' },
        { id: 'hr-departments', label: 'HR Departments', icon: 'fa-solid fa-building' },
      ],
    },
    {
      id: 'hr-group-leaves',
      label: 'Leaves',
      icon: 'fa-solid fa-calendar-days',
      children: [
        { id: 'hr-leaves', label: 'Leaves', icon: 'fa-solid fa-calendar-days', badge: 'pendingLeaves' },
        { id: 'hr-leave-types', label: 'Leave Types', icon: 'fa-solid fa-list-check' },
        { id: 'hr-leave-report', label: 'Leave Report', icon: 'fa-solid fa-file-export' },
      ],
    },
    {
      id: 'hr-group-loans',
      label: 'Loans',
      icon: 'fa-solid fa-credit-card',
      children: [
        { id: 'hr-loans', label: 'Loans / Advances', icon: 'fa-solid fa-hand-holding-dollar', badge: 'pendingLoans' },
        { id: 'hr-loan-types', label: 'Loan Types', icon: 'fa-solid fa-tags' },
        { id: 'hr-loan-report', label: 'Loan Report', icon: 'fa-solid fa-file-export' },
      ],
    },
    {
      id: 'hr-group-documents',
      label: 'Documents',
      icon: 'fa-solid fa-folder',
      children: [
        { id: 'hr-documents', label: 'Employee Documents', icon: 'fa-solid fa-folder-open' },
        { id: 'hr-document-expiry', label: 'Document Expiry', icon: 'fa-solid fa-triangle-exclamation' },
        { id: 'hr-document-settings', label: 'Document Settings', icon: 'fa-solid fa-sliders' },
      ],
    },
    {
      id: 'hr-group-attendance',
      label: 'Staff Attendance',
      icon: 'fa-solid fa-clipboard-user',
      children: [
        { id: 'hr-attendance-live', label: 'Live Dashboard', icon: 'fa-solid fa-display' },
        {
          id: 'hr-attendance-report',
          label: 'Attendance Report',
          icon: 'fa-solid fa-clipboard-user',
          // Other staff reach the same page as "My Attendance" in Self Service,
          // where it filters itself to their own punches.
          roles: ['super_admin', 'hr', 'manager'],
        },
        { id: 'hr-attendance-records', label: 'Raw Punches', icon: 'fa-solid fa-list' },
        { id: 'hr-attendance-settings', label: 'Devices & Settings', icon: 'fa-solid fa-sliders' },
      ],
    },
    {
      id: 'hr-group-admin',
      label: 'Administration',
      icon: 'fa-solid fa-gear',
      children: [
        { id: 'hr-user-management', label: 'HR User Management', icon: 'fa-solid fa-user-shield' },
        { id: 'hr-workflows', label: 'Workflow Management', icon: 'fa-solid fa-diagram-project' },
        { id: 'hr-employee-groups', label: 'Employee Groups', icon: 'fa-solid fa-people-group' },
        { id: 'hr-config', label: 'HR Configuration', icon: 'fa-solid fa-gear' },
      ],
    },
  ],
};

/**
 * Payroll and contracts — salary figures and employment terms.
 *
 * Deliberately NOT part of HR Management. HR keeps employees, leave, loans,
 * documents and attendance; this section belongs to the Accountant role, plus
 * admin and super_admin. ROLE_PAGES refuses these pages by URL as well, and
 * the database refuses the rows. A hidden menu item is not an access control.
 */
const PAYROLL_CONTRACTS_SECTION: NavSection = {
  section: 'Payroll & Contracts',
  items: [
    // First, so it reads as the section's home — and it is where an accountant
    // lands, so the highlighted item matches the page on sign-in.
    { id: 'accountant-dashboard', label: 'Accountant Dashboard', icon: 'fa-solid fa-chart-line' },
    {
      id: 'hr-group-payroll',
      label: 'Payroll',
      icon: 'fa-solid fa-money-check-dollar',
      children: [
        { id: 'hr-payslips', label: 'Payslips', icon: 'fa-solid fa-receipt' },
        { id: 'hr-payroll-report', label: 'Payroll Report', icon: 'fa-solid fa-file-invoice-dollar' },
        { id: 'hr-pay-components', label: 'Pay Components', icon: 'fa-solid fa-coins' },
      ],
    },
    {
      id: 'hr-group-contracts',
      label: 'Contracts',
      icon: 'fa-solid fa-file-signature',
      children: [
        { id: 'hr-contracts', label: 'Contracts', icon: 'fa-solid fa-file-signature' },
        { id: 'hr-contract-templates', label: 'Contract Templates', icon: 'fa-solid fa-file-lines' },
      ],
    },
  ],
};

export const NAV_AREAS: NavArea[] = [
  {
    id: 'lms',
    label: 'LMS',
    fullName: 'Learning Management',
    icon: 'fa-solid fa-book-open-reader',
    sections: [
      {
        section: 'Teaching',
        items: [
          { id: 'mystudents', label: 'My Students', icon: 'fa-solid fa-users' },
          { id: 'classes', label: 'Classes', icon: 'fa-solid fa-school' },
          // "modules" is correct for a lecturer — ModulesPage, scoped per role.
          // NOT "mymodules": that is the STUDENT page of their own marks, and
          // ROLE_PAGES.mymodules is ['student'].
          { id: 'modules', label: 'Modules', icon: 'fa-solid fa-book-open', labelFor: { lecturer: 'My Modules' } },
          { id: 'timetable', label: 'Timetable', icon: 'fa-solid fa-calendar-days' },
          { id: 'mapping', label: 'Module Mapping', icon: 'fa-solid fa-diagram-project' },
        ],
      },
      {
        section: 'Learning & Assessment',
        items: [
          { id: 'notes', label: 'Notes & Materials', icon: 'fa-solid fa-folder-open' },
          {
            id: 'assignments',
            label: 'Assignments',
            icon: 'fa-solid fa-list-check',
            // Step 8 read-only check, failed for principal and deputy: the
            // submissions view offers "Grade" to anyone who can open the page
            // (AssignmentsPage.tsx, handleGradeSubmission). Hidden from their
            // menu until that button is gated on canManageAcademics. They can
            // still open the page by URL, as before this change.
            roles: (ROLE_PAGES.assignments ?? []).filter((r) => r !== 'principal' && r !== 'deputy_principal'),
          },
          { id: 'practicals', label: 'Practical & Recipe Assessments', icon: 'fa-solid fa-utensils' },
          { id: 'photogallery', label: 'Photo Gallery', icon: 'fa-solid fa-images' },
        ],
      },
    ],
  },
  {
    id: 'sms',
    label: 'SMS',
    fullName: 'Student Management',
    icon: 'fa-solid fa-building-columns',
    sections: [
      {
        section: 'Enrolment',
        items: [
          { id: 'admissions', label: 'Admissions', icon: 'fa-solid fa-door-open' },
          { id: 'registrations', label: 'Registrations & Enrolment', icon: 'fa-solid fa-clipboard-list' },
          {
            id: 'students',
            label: 'Students',
            icon: 'fa-solid fa-user-graduate',
            labelFor: { principal: 'All Students', deputy_principal: 'All Students', hoa: 'All Students' },
            badge: 'students',
          },
          { id: 'student-accounts', label: 'Student Accounts', icon: 'fa-solid fa-user-lock' },
          {
            id: 'lecturers',
            label: 'Lecturers',
            icon: 'fa-solid fa-chalkboard-user',
            labelFor: { principal: 'All Lecturers', deputy_principal: 'All Lecturers', hoa: 'All Lecturers' },
          },
        ],
      },
      {
        section: 'Records & Results',
        items: [
          { id: 'attendance', label: 'Student Attendance', icon: 'fa-solid fa-clipboard-check' },
          { id: 'exams', label: 'Exams & Marks', icon: 'fa-solid fa-file-pen' },
          { id: 'results', label: 'Results', icon: 'fa-solid fa-chart-line' },
          { id: 'grades', label: 'Grades Overview', icon: 'fa-solid fa-star-half-stroke' },
          { id: 'progression', label: 'Progression', icon: 'fa-solid fa-arrow-up-right-dots', labelFor: { hoa: 'Promotion' } },
          { id: 'transcripts', label: 'Transcripts', icon: 'fa-solid fa-scroll' },
          { id: 'reports', label: 'Academic Reports', icon: 'fa-solid fa-file-lines', labelFor: { hod: 'HOD Reports' } },
        ],
      },
    ],
  },
  {
    id: 'hr',
    label: 'HR & Payroll',
    fullName: 'HR & Payroll',
    icon: 'fa-solid fa-briefcase',
    sections: [HR_MANAGEMENT_SECTION, PAYROLL_CONTRACTS_SECTION],
  },
];

export const BOTTOM_SECTIONS: NavSection[] = [
  {
    section: 'Self Service',
    items: [
      { id: 'my-employee-file', label: 'My File', icon: 'fa-solid fa-id-card' },
      { id: 'hr-attendance-report', label: 'My Attendance', icon: 'fa-solid fa-clipboard-user' },
      { id: 'my-payslips', label: 'My Payslips', icon: 'fa-solid fa-receipt' },
      { id: 'my-leaves', label: 'My Leaves', icon: 'fa-solid fa-calendar-check' },
      { id: 'my-loans', label: 'My Loans', icon: 'fa-solid fa-hand-holding-dollar' },
    ],
  },
  {
    section: 'Administration',
    items: [
      { id: 'usermanagement', label: 'User Management', icon: 'fa-solid fa-users-gear' },
      { id: 'audit', label: 'Audit Trail', icon: 'fa-solid fa-shield-halved' },
      { id: 'backup', label: 'Backup & Restore', icon: 'fa-solid fa-database' },
      { id: 'config', label: 'Configuration', icon: 'fa-solid fa-gear' },
    ],
  },
];

/** A student gets one menu and no switcher. */
export const STUDENT_SECTIONS: NavSection[] = [
  {
    section: 'Main',
    items: [
      { id: 'dashboard', label: 'My Dashboard', icon: 'fa-solid fa-gauge' },
      { id: 'notifications', label: 'Notifications', icon: 'fa-solid fa-bullhorn', badge: 'notifications' },
      { id: 'profile', label: 'My Profile', icon: 'fa-solid fa-circle-user' },
    ],
  },
  {
    section: 'My Learning',
    items: [
      { id: 'mymodules', label: 'My Modules', icon: 'fa-solid fa-book-open' },
      { id: 'mytimetable', label: 'My Timetable', icon: 'fa-solid fa-calendar-days' },
      { id: 'notes', label: 'Notes & Materials', icon: 'fa-solid fa-folder-open' },
      { id: 'assignments', label: 'Assignments', icon: 'fa-solid fa-list-check' },
      { id: 'photogallery', label: 'Photo Gallery', icon: 'fa-solid fa-images' },
    ],
  },
  {
    section: 'My Records',
    items: [
      { id: 'results', label: 'My Results', icon: 'fa-solid fa-chart-line' },
      { id: 'transcripts', label: 'My Transcript', icon: 'fa-solid fa-scroll' },
    ],
  },
];

/** The area a role opens in on first sign-in. */
export const DEFAULT_AREA: Partial<Record<AppRole, AreaId>> = {
  super_admin: 'sms', admin: 'sms', principal: 'sms', deputy_principal: 'sms',
  hoa: 'sms', hod: 'lms', lecturer: 'lms',
  hr: 'hr', manager: 'hr', accountant: 'hr',
};

/** Pages reached from inside another page, never from the menu. */
const DETAIL_PAGE_AREA: Record<string, AreaId> = {
  'hr-employee-detail': 'hr',
  'hr-employee-form': 'hr',
  'hr-payslip-batch': 'hr',
  'hr-contract-detail': 'hr',
  'hr-workflow-editor': 'hr',
  // 'hr-payslip-detail' is deliberately absent: staff open it from My Payslips,
  // a shared section, and the menu must not jump to an area they lack.
};

const visibleTo = (item: NavItem, role: AppRole): boolean =>
  (item.roles ?? ROLE_PAGES[item.id] ?? []).includes(role);

function filterItems(items: NavItem[], role: AppRole): NavItem[] {
  return items.flatMap((item) => {
    if (item.children) {
      const children = filterItems(item.children, role);
      return children.length ? [{ ...item, children }] : [];
    }
    return visibleTo(item, role)
      ? [{ ...item, label: item.labelFor?.[role] ?? item.label }]
      : [];
  });
}

function filterSections(sections: NavSection[], role: AppRole): NavSection[] {
  return sections
    .map((s) => ({ ...s, items: filterItems(s.items, role) }))
    .filter((s) => s.items.length > 0);
}

/** The areas a role has anything in. A student has none: they get one menu. */
export function areasForRole(role: AppRole): AreaId[] {
  if (role === 'student') return [];
  return NAV_AREAS.filter((a) => filterSections(a.sections, role).length > 0).map((a) => a.id);
}

/** The menu for a role: Main, the chosen area, then the shared sections. */
export function buildMenu(role: AppRole, area: AreaId | null): NavSection[] {
  if (role === 'student') return filterSections(STUDENT_SECTIONS, role);
  const middle = NAV_AREAS.find((a) => a.id === area)?.sections ?? [];
  return filterSections([...TOP_SECTIONS, ...middle, ...BOTTOM_SECTIONS], role);
}

function containsPage(items: NavItem[], pageId: string): boolean {
  return items.some((item) =>
    item.children ? containsPage(item.children, pageId) : item.id === pageId,
  );
}

function findLeaf(sections: NavSection[], pageId: string): NavItem | null {
  const walk = (items: NavItem[]): NavItem | null => {
    for (const item of items) {
      if (item.children) {
        const found = walk(item.children);
        if (found) return found;
      } else if (item.id === pageId) {
        return item;
      }
    }
    return null;
  };
  for (const s of sections) {
    const found = walk(s.items);
    if (found) return found;
  }
  return null;
}

/** Which area a page belongs to, or null for shared and unknown pages. */
export function areaOfPage(pageId: string): AreaId | null {
  for (const area of NAV_AREAS) {
    if (area.sections.some((s) => containsPage(s.items, pageId))) return area.id;
  }
  return DETAIL_PAGE_AREA[pageId] ?? null;
}

/**
 * Menu label for the breadcrumb, in the wording this role's menu uses.
 *
 * The role's own area sections are searched first, then its shared sections.
 * hr-attendance-report is in both HR Management and Self Service: HR reads
 * "Attendance Report", while a lecturer, who only has the Self Service copy,
 * reads "My Attendance". Falls back to the unfiltered tree, then null for
 * pages not in the menu.
 */
export function labelOfPage(pageId: string, role: AppRole): string | null {
  const menus: NavSection[][] = role === 'student'
    ? [buildMenu(role, null)]
    : [
        ...areasForRole(role).map((a) => filterSections(getNavArea(a)?.sections ?? [], role)),
        buildMenu(role, null),
      ];
  for (const menu of menus) {
    const leaf = findLeaf(menu, pageId);
    if (leaf) return leaf.label;
  }
  const all = [
    ...TOP_SECTIONS,
    ...NAV_AREAS.flatMap((a) => a.sections),
    ...BOTTOM_SECTIONS,
    ...STUDENT_SECTIONS,
  ];
  const leaf = findLeaf(all, pageId);
  return leaf ? (leaf.labelFor?.[role] ?? leaf.label) : null;
}

/** Every leaf in a list of sections, flattened. Used by the tests. */
export function leavesOf(sections: NavSection[]): NavItem[] {
  const out: NavItem[] = [];
  const walk = (items: NavItem[]) => items.forEach((it) => (it.children ? walk(it.children) : out.push(it)));
  sections.forEach((s) => walk(s.items));
  return out;
}

export function getNavArea(id: AreaId | null): NavArea | undefined {
  return NAV_AREAS.find((a) => a.id === id);
}
