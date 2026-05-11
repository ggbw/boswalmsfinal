// Adapter hook that provides the motho2 RoleContext API surface
// (isAdmin, isHR, isManager, isEmployee, can()) on top of boswalms's
// existing role enum from useAuth(). Lets ported HR pages compile
// with a single import-path change.
import { useAuth } from '@/hooks/useAuth';

const HR_KEYS = [
  'employees',
  'payslips',
  'leaves',
  'loans',
  'contracts',
  'pay_components',
  'reports',
  'documents',
  'departments',
  'pay_components_admin',
  'leave_types',
  'loan_types',
  'contract_templates',
  'attendance',
  'admin_users',
] as const;

const SELF_KEYS = [
  'my_payslips',
  'my_leaves',
  'my_loans',
  'my_employee_file',
  'my_advance_salary',
  'my_dashboard',
  'my_profile',
] as const;

export type PermAction = 'read' | 'write' | 'delete';

export function useUserRole() {
  const { user, profile, role } = useAuth();

  const isSuperAdmin = role === 'super_admin';
  // HR-context admin: only super_admin counts. The plain LMS 'admin' role is
  // intentionally LMS-only and must not grant HR write/admin permissions.
  const isAdmin = isSuperAdmin;
  const isHR = isAdmin || role === 'hr';
  const isManager = role === 'manager' || role === 'hod' || role === 'hoy';
  // Anyone with a staff or HR role is considered an "employee" for self-service
  const isEmployee =
    role === 'employee' ||
    role === 'lecturer' ||
    role === 'manager' ||
    role === 'hod' ||
    role === 'hoy' ||
    isHR;

  const can = (key: string, action: PermAction = 'read'): boolean => {
    if (isAdmin) return true;
    if (isHR && (HR_KEYS as readonly string[]).includes(key)) return true;
    if (isManager && action === 'read' && (HR_KEYS as readonly string[]).includes(key)) return true;
    if (isEmployee && (SELF_KEYS as readonly string[]).includes(key) && action === 'read') return true;
    return false;
  };

  // Compatibility shape with motho2's RoleContext consumers
  return {
    user,
    profile,
    role: role ?? null,
    appRole: role ?? null,
    customRoleId: null as string | null,
    isEmployeeRole: isEmployee,
    mustChangePassword: false,
    isSuperAdmin,
    isAdmin,
    isHR,
    isManager,
    isEmployee,
    can,
    loading: false,
  };
}
