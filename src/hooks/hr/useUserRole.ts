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

/**
 * Payroll and contracts — carved OUT of the HR role.
 *
 * These are salary figures and employment terms. They are handled by the
 * Accountant role, plus admin and super_admin. HR keeps every other HR
 * function: employees, leave, loans, documents, attendance, departments.
 *
 * Listed separately rather than removed from HR_KEYS because HR_KEYS is also
 * what a manager gets read access to, and the two need to diverge.
 */
const PAYROLL_KEYS = [
  'payslips',
  'pay_components',
  'pay_components_admin',
  'contracts',
  'contract_templates',
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
  // The Accountant exists for exactly one purpose: payroll and contracts.
  const isAccountant = role === 'accountant';
  // Who may see salary figures and employment terms. Note this is the one
  // place the plain LMS 'admin' role DOES carry an HR permission — everywhere
  // else in this module admin is deliberately LMS-only.
  const isPayrollAdmin = isSuperAdmin || role === 'admin' || isAccountant;
  const isManager = role === 'manager' || role === 'hod' || role === 'hoa';
  // Anyone with a staff or HR role is considered an "employee" for self-service
  const isEmployee =
    role === 'employee' ||
    role === 'lecturer' ||
    role === 'manager' ||
    role === 'hod' ||
    role === 'hoa' ||
    isHR;

  const can = (key: string, action: PermAction = 'read'): boolean => {
    // Payroll and contracts are decided FIRST and on their own terms, before
    // the general admin shortcut. Otherwise HR — which passes the isHR test
    // below — would keep the access this change exists to remove.
    if ((PAYROLL_KEYS as readonly string[]).includes(key)) return isPayrollAdmin;

    // An Accountant has no other HR permissions. Their own payslip and leave
    // remain available, like any member of staff.
    if (isAccountant) {
      return (SELF_KEYS as readonly string[]).includes(key) && action === 'read';
    }

    if (isAdmin) return true;
    if (isHR && (HR_KEYS as readonly string[]).includes(key)) return true;
    if (isManager && action === 'read' && (HR_KEYS as readonly string[]).includes(key)) return true;
    if (isEmployee && (SELF_KEYS as readonly string[]).includes(key) && action === 'read') return true;
    return false;
  };

  // Visibility derivations. Motho2 features (PayslipList, EmployeeList,
  // Sidebar pending badges, LoansAdmin, etc.) gate manager/expat rows behind
  // these flags. HR and above can see manager/expat records; everyone else
  // sees only "regular" employees.
  const canSeeManagers = isAdmin || isHR;
  const canSeeExpats = isAdmin || isHR;
  // Pay-component master data is admin-only — HR can view but not configure.
  const canEditPayComponents = isAdmin;

  // Read first-login flag off the profile when present; default to false so
  // pages without the column behave as today.
  const mustChangePassword = Boolean((profile as { must_change_password?: boolean } | null)?.must_change_password);
  const customRoleName = (profile as { custom_role_name?: string } | null)?.custom_role_name ?? null;

  // Compatibility shape with motho2's RoleContext consumers
  return {
    user,
    profile,
    isAccountant,
    isPayrollAdmin,
    role: role ?? null,
    appRole: role ?? null,
    customRoleId: null as string | null,
    customRoleName,
    isEmployeeRole: isEmployee,
    mustChangePassword,
    isSuperAdmin,
    isAdmin,
    isHR,
    isManager,
    isEmployee,
    canSeeManagers,
    canSeeExpats,
    canEditPayComponents,
    // Fine-grained HR access scope is not modeled in boswalmsfinal; leave null
    // so motho2 consumers that read it get a defined-but-empty value.
    hrAccessScope: null as null,
    can,
    loading: false,
  };
}
