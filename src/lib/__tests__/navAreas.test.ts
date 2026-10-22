import { describe, it, expect } from 'vitest';
import { APP_ROLES, ROLE_PAGES, type AppRole } from '@/lib/rolePages';
import {
  BOTTOM_SECTIONS,
  DEFAULT_AREA,
  NAV_AREAS,
  STUDENT_SECTIONS,
  TOP_SECTIONS,
  areaOfPage,
  areasForRole,
  buildMenu,
  labelOfPage,
  leavesOf,
  type AreaId,
  type NavItem,
} from '@/lib/navAreas';

const ALL_SECTIONS = [
  ...TOP_SECTIONS,
  ...NAV_AREAS.flatMap((a) => a.sections),
  ...BOTTOM_SECTIONS,
  ...STUDENT_SECTIONS,
];

const menuIds = (role: AppRole, area: AreaId | null) => leavesOf(buildMenu(role, area)).map((i) => i.id);

describe('navAreas guard', () => {
  // The bug this catches: a lecturer's "My Modules" pointed at a student-only
  // page, failed the AppLayout allow-list and silently rendered the Dashboard.
  it('every menu leaf, for every role and area, is allowed by ROLE_PAGES', () => {
    for (const role of APP_ROLES) {
      const areas: (AreaId | null)[] = [null, ...NAV_AREAS.map((a) => a.id)];
      for (const area of areas) {
        for (const item of leavesOf(buildMenu(role, area))) {
          expect(ROLE_PAGES[item.id], `${item.id} has no ROLE_PAGES entry`).toBeDefined();
          expect(ROLE_PAGES[item.id], `${role} sees ${item.id} in ${area}`).toContain(role);
        }
      }
    }
  });

  it('every roles override is a subset of its ROLE_PAGES entry', () => {
    const withOverride: NavItem[] = leavesOf(ALL_SECTIONS).filter((i) => i.roles);
    expect(withOverride.length).toBeGreaterThan(0);
    for (const item of withOverride) {
      for (const r of item.roles!) {
        expect(ROLE_PAGES[item.id], `${item.id} override grants ${r}`).toContain(r);
      }
    }
  });

  it('every menu page id has a ROLE_PAGES entry', () => {
    for (const item of leavesOf(ALL_SECTIONS)) {
      expect(ROLE_PAGES[item.id], item.id).toBeDefined();
    }
  });

  it('adds the two new page ids with the audiences of the pages they filter', () => {
    expect([...ROLE_PAGES.practicals]).toEqual([...ROLE_PAGES.exams]);
    expect([...ROLE_PAGES['student-accounts']]).toEqual([...ROLE_PAGES.usermanagement]);
  });
});

describe('areas and default area', () => {
  it('opens each role in the agreed area', () => {
    for (const role of ['super_admin', 'admin', 'principal', 'deputy_principal', 'hoa'] as AppRole[]) {
      expect(DEFAULT_AREA[role]).toBe('sms');
      expect(areasForRole(role)).toContain('sms');
    }
    for (const role of ['hod', 'lecturer'] as AppRole[]) {
      expect(DEFAULT_AREA[role]).toBe('lms');
      expect(areasForRole(role)).toContain('lms');
    }
  });

  it('gives HR, Manager and Accountant HR & Payroll only, so no switcher', () => {
    for (const role of ['hr', 'manager', 'accountant'] as AppRole[]) {
      expect(areasForRole(role)).toEqual(['hr']);
    }
  });

  it('gives Student and Employee no areas', () => {
    expect(areasForRole('student')).toEqual([]);
    expect(areasForRole('employee')).toEqual([]);
  });

  it('gives admin all three areas, with Payroll & Contracts only under HR', () => {
    expect(areasForRole('admin')).toEqual(['lms', 'sms', 'hr']);
    const hrSections = buildMenu('admin', 'hr').map((s) => s.section);
    expect(hrSections).toContain('Payroll & Contracts');
    expect(hrSections).not.toContain('HR Management');
  });
});

describe('menus', () => {
  it('gives a student My Learning and My Records', () => {
    const sections = buildMenu('student', null).map((s) => s.section);
    expect(sections).toEqual(['Main', 'My Learning', 'My Records']);
    expect(menuIds('student', null)).toEqual([
      'dashboard', 'notifications', 'profile',
      'mymodules', 'mytimetable', 'notes', 'assignments', 'photogallery',
      'results', 'transcripts',
    ]);
  });

  it('keeps Dashboard out of the HR menu', () => {
    expect(menuIds('hr', 'hr')).not.toContain('dashboard');
    expect(menuIds('hr', 'hr')).toContain('hr-dashboard');
  });

  it('shows the HR Attendance Report only to super_admin, hr and manager, and My Attendance to staff', () => {
    const hrItems = leavesOf(NAV_AREAS.find((a) => a.id === 'hr')!.sections);
    expect(hrItems.find((i) => i.id === 'hr-attendance-report')?.roles).toEqual(['super_admin', 'hr', 'manager']);
    const lecturerSelf = buildMenu('lecturer', 'lms').find((s) => s.section === 'Self Service');
    expect(lecturerSelf?.items.map((i) => i.label)).toContain('My Attendance');
  });

  it('puts Practicals in the LMS and Exams & Marks in the SMS', () => {
    expect(menuIds('lecturer', 'lms')).toContain('practicals');
    expect(menuIds('admin', 'sms')).toContain('exams');
    expect(menuIds('admin', 'sms')).toContain('student-accounts');
    expect(menuIds('admin', 'sms')).not.toContain('practicals');
  });

  // Step 8 override: the Grade button in Assignments is not gated for them.
  it('hides Assignments from principal and deputy, but not from teaching staff', () => {
    expect(menuIds('principal', 'lms')).not.toContain('assignments');
    expect(menuIds('deputy_principal', 'lms')).not.toContain('assignments');
    expect(menuIds('lecturer', 'lms')).toContain('assignments');
    expect(menuIds('student', null)).toContain('assignments');
    // Access by URL is unchanged: this is a menu override, not ROLE_PAGES.
    expect(ROLE_PAGES.assignments).toContain('principal');
  });

  it('gives the accountant Payroll & Contracts and nothing shared', () => {
    expect(buildMenu('accountant', 'hr').map((s) => s.section)).toEqual(['Payroll & Contracts']);
  });

  it('applies the per-role labels', () => {
    expect(labelOfPage('modules', 'lecturer')).toBe('My Modules');
    expect(labelOfPage('reports', 'hod')).toBe('HOD Reports');
    expect(labelOfPage('reports', 'admin')).toBe('Academic Reports');
    expect(labelOfPage('progression', 'hoa')).toBe('Promotion');
    expect(labelOfPage('dashboard', 'principal')).toBe('School Overview');
    expect(labelOfPage('hr-attendance-report', 'lecturer')).toBe('My Attendance');
    expect(labelOfPage('hr-attendance-report', 'hr')).toBe('Attendance Report');
    expect(labelOfPage('hr-employee-detail', 'hr')).toBeNull();
  });
});

describe('areaOfPage', () => {
  it('maps pages to their area, and shared pages to none', () => {
    expect(areaOfPage('practicals')).toBe('lms');
    expect(areaOfPage('exams')).toBe('sms');
    expect(areaOfPage('hr-payslips')).toBe('hr');
    expect(areaOfPage('hr-employee-detail')).toBe('hr');
    expect(areaOfPage('dashboard')).toBeNull();
    expect(areaOfPage('my-payslips')).toBeNull();
    expect(areaOfPage('hr-payslip-detail')).toBeNull();
    expect(areaOfPage('not-a-page')).toBeNull();
  });
});
