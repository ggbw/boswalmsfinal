import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

// No real backend: the sidebar's only network call is the HR pending-count
// hook, and the app context is replaced with a fixed user.
const app = {
  db: { notifications: [], students: [{ id: 's1' }, { id: 's2' }] },
  currentUser: { id: 'u1', name: 'Test User', role: 'admin' },
  activePage: 'dashboard',
  navigate: vi.fn(),
  setCurrentUser: vi.fn(),
};

vi.mock('@/context/AppContext', () => ({ useApp: () => app }));
vi.mock('@/hooks/hr/useUserRole', () => ({ useUserRole: () => ({ isHR: false }) }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) }),
  },
}));

import Sidebar from '@/components/Sidebar';

const mountAs = (role: string) => {
  app.currentUser = { id: `u-${role}`, name: 'Test User', role };
  return render(createElement(Sidebar));
};

describe('sidebar areas (smoke)', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    try { localStorage.clear(); } catch { /* jsdom always has it */ }
    consoleError = vi.spyOn(console, 'error');
  });

  afterEach(() => {
    cleanup();
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('mounts for admin with three tabs, SMS selected and Students present', () => {
    mountAs('admin');
    expect(screen.getByTestId('sidebar-area-tablist')).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(3);
    expect(screen.getByTestId('sidebar-area-sms-tab')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('sidebar-nav-students')).toBeInTheDocument();
  });

  it('switches to the LMS and shows Practical & Recipe Assessments', () => {
    mountAs('admin');
    expect(screen.queryByTestId('sidebar-nav-practicals')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('sidebar-area-lms-tab'));
    expect(screen.getByTestId('sidebar-area-lms-tab')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('sidebar-nav-practicals')).toBeInTheDocument();
    // Only the menu changes: the open page is never navigated away from.
    expect(app.navigate).not.toHaveBeenCalled();
  });

  it('remembers the chosen area for the same user', () => {
    mountAs('admin');
    fireEvent.click(screen.getByTestId('sidebar-area-lms-tab'));
    cleanup();
    mountAs('admin');
    expect(screen.getByTestId('sidebar-area-lms-tab')).toHaveAttribute('aria-selected', 'true');
  });

  it('mounts for a student with no tablist and the student menu', () => {
    mountAs('student');
    expect(screen.queryByTestId('sidebar-area-tablist')).not.toBeInTheDocument();
    expect(screen.getByText('My Learning')).toBeInTheDocument();
    expect(screen.getByText('My Records')).toBeInTheDocument();
  });

  it('mounts for the accountant with no tablist', () => {
    mountAs('accountant');
    expect(screen.queryByTestId('sidebar-area-tablist')).not.toBeInTheDocument();
    expect(screen.getByTestId('sidebar-nav-accountant-dashboard')).toBeInTheDocument();
  });
});
