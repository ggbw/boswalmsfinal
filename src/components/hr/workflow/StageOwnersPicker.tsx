/**
 * StageOwnersPicker — assign approvers to a workflow stage by role or by user.
 *
 * Boswalmsfinal adaptations vs motho2:
 *   - Roles are the app_role enum values (super_admin, hr, manager, ...), not
 *     rows from a `custom_roles` table.
 *   - Users come from the `profiles` table joined to `employees` for an
 *     employee name (motho2 joined `user_profiles` to `employees`).
 *   - Owner rows store `role_name` (TEXT) instead of `role_id` (UUID).
 */

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Plus, X, UserCircle, Shield } from 'lucide-react';
import type { WorkflowStageOwner } from '@/lib/hr/workflowEngine';

// Roles available for stage ownership. Matches the app_role enum values the
// rest of the app already exercises through useAuth + useUserRole.
const AVAILABLE_ROLES: Array<{ value: string; label: string }> = [
  { value: 'super_admin', label: 'Super Admin' },
  { value: 'hr', label: 'HR' },
  { value: 'admin', label: 'Admin' },
  { value: 'manager', label: 'Manager' },
  { value: 'hod', label: 'Head of Department' },
  { value: 'hoy', label: 'Head of Year' },
];

interface UserRow {
  userId: string;
  name: string;
  email: string | null;
  employeeName: string | null;
}

interface Props {
  stageId: string;
  owners: WorkflowStageOwner[];
  onChange: () => void;
  disabled?: boolean;
}

export default function StageOwnersPicker({
  stageId,
  owners,
  onChange,
  disabled,
}: Props) {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState<'role' | 'user' | null>(null);
  const [userQuery, setUserQuery] = useState('');

  const { data: users = [] } = useQuery({
    queryKey: ['workflow-owners:users'],
    queryFn: async (): Promise<UserRow[]> => {
      const { data: profs } = await supabase
        .from('profiles')
        .select('user_id, name, email')
        .order('name');
      const userIds = ((profs ?? []) as Array<{ user_id: string }>).map((p) => p.user_id);
      const empMap = new Map<string, string>();
      if (userIds.length > 0) {
        const { data: emps } = await supabase
          .from('employees')
          .select('auth_user_id, employee_name')
          .in('auth_user_id', userIds);
        ((emps ?? []) as Array<{ auth_user_id: string; employee_name: string }>).forEach((e) => {
          if (e.auth_user_id) empMap.set(e.auth_user_id, e.employee_name);
        });
      }
      return ((profs ?? []) as Array<{ user_id: string; name: string | null; email: string | null }>)
        .map((p) => ({
          userId: p.user_id,
          name: p.name ?? '',
          email: p.email,
          employeeName: empMap.get(p.user_id) ?? null,
        }));
    },
    staleTime: 5 * 60 * 1000,
  });

  const roleLabelByName = (name: string) =>
    AVAILABLE_ROLES.find((r) => r.value === name)?.label ?? name;
  const userLabelById = (id: string) => {
    const u = users.find((u) => u.userId === id);
    if (!u) return 'Unknown user';
    return u.employeeName ?? u.name ?? u.email ?? 'User';
  };

  const assignedRoleNames = new Set(
    owners.filter((o) => o.owner_type === 'role').map((o) => o.role_name),
  );
  const assignedUserIds = new Set(
    owners.filter((o) => o.owner_type === 'user').map((o) => o.user_id),
  );

  const filteredUsers = users.filter((u) => {
    if (assignedUserIds.has(u.userId)) return false;
    if (!userQuery.trim()) return true;
    const q = userQuery.toLowerCase();
    return (
      u.name?.toLowerCase().includes(q) ||
      u.email?.toLowerCase().includes(q) ||
      u.employeeName?.toLowerCase().includes(q)
    );
  });

  const addRole = async (roleName: string) => {
    if (assignedRoleNames.has(roleName)) {
      toast.error('That role is already assigned.');
      return;
    }
    const { error } = await (supabase.from('workflow_stage_owners' as never) as never as {
      insert: (v: unknown) => Promise<{ error: { message: string } | null }>;
    }).insert({
      stage_id: stageId,
      owner_type: 'role',
      role_name: roleName,
      user_id: null,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    setAdding(null);
    onChange();
    queryClient.invalidateQueries({ queryKey: ['workflow-stages'] });
  };

  const addUser = async (userId: string) => {
    if (assignedUserIds.has(userId)) {
      toast.error('That user is already assigned.');
      return;
    }
    const { error } = await (supabase.from('workflow_stage_owners' as never) as never as {
      insert: (v: unknown) => Promise<{ error: { message: string } | null }>;
    }).insert({
      stage_id: stageId,
      owner_type: 'user',
      role_name: null,
      user_id: userId,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    setAdding(null);
    setUserQuery('');
    onChange();
    queryClient.invalidateQueries({ queryKey: ['workflow-stages'] });
  };

  const removeOwner = async (ownerId: string) => {
    const { error } = await (supabase.from('workflow_stage_owners' as never) as never as {
      delete: () => { eq: (col: string, val: string) => Promise<{ error: { message: string } | null }> };
    })
      .delete()
      .eq('id', ownerId);
    if (error) {
      toast.error(error.message);
      return;
    }
    onChange();
    queryClient.invalidateQueries({ queryKey: ['workflow-stages'] });
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {owners.length === 0 && (
          <span className="text-xs text-gray-400 italic">
            No approvers yet — add at least one role or user.
          </span>
        )}
        {owners.map((o) => {
          const isRole = o.owner_type === 'role';
          return (
            <span
              key={o.id}
              className={`inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-full border ${
                isRole
                  ? 'bg-blue-50 border-blue-200 text-blue-700'
                  : 'bg-purple-50 border-purple-200 text-purple-700'
              }`}
            >
              {isRole ? <Shield size={11} /> : <UserCircle size={11} />}
              <span className="font-medium">
                {isRole ? roleLabelByName(o.role_name ?? '') : userLabelById(o.user_id ?? '')}
              </span>
              {!disabled && (
                <button
                  onClick={() => void removeOwner(o.id)}
                  className="ml-0.5 text-gray-400 hover:text-red-600"
                  aria-label="Remove owner"
                >
                  <X size={11} />
                </button>
              )}
            </span>
          );
        })}
      </div>

      {!disabled && (
        <div className="flex flex-wrap items-center gap-2">
          {adding === null && (
            <>
              <button
                onClick={() => setAdding('role')}
                className="text-xs flex items-center gap-1 px-2 py-1 border border-gray-200 rounded hover:bg-gray-50 text-gray-700"
              >
                <Plus size={11} /> Add Role
              </button>
              <button
                onClick={() => setAdding('user')}
                className="text-xs flex items-center gap-1 px-2 py-1 border border-gray-200 rounded hover:bg-gray-50 text-gray-700"
              >
                <Plus size={11} /> Add User
              </button>
            </>
          )}

          {adding === 'role' && (
            <div className="flex items-center gap-2">
              <select
                autoFocus
                onChange={(e) => {
                  if (e.target.value) void addRole(e.target.value);
                }}
                defaultValue=""
                className="text-xs border border-gray-300 rounded px-2 py-1 bg-white"
              >
                <option value="" disabled>
                  Pick a role…
                </option>
                {AVAILABLE_ROLES.filter((r) => !assignedRoleNames.has(r.value)).map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
              <button
                onClick={() => setAdding(null)}
                className="text-xs text-gray-500 hover:text-gray-800"
              >
                Cancel
              </button>
            </div>
          )}

          {adding === 'user' && (
            <div className="flex items-center gap-2 relative">
              <input
                autoFocus
                value={userQuery}
                onChange={(e) => setUserQuery(e.target.value)}
                placeholder="Search by name, email or employee name…"
                className="text-xs border border-gray-300 rounded px-2 py-1 w-56"
              />
              <button
                onClick={() => {
                  setAdding(null);
                  setUserQuery('');
                }}
                className="text-xs text-gray-500 hover:text-gray-800"
              >
                Cancel
              </button>
              {userQuery.trim() !== '' && (
                <div className="absolute top-full left-0 mt-1 z-10 w-72 max-h-56 overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-lg">
                  {filteredUsers.length === 0 ? (
                    <div className="text-xs text-gray-400 px-3 py-2">
                      No matching users.
                    </div>
                  ) : (
                    filteredUsers.slice(0, 30).map((u) => (
                      <button
                        key={u.userId}
                        onClick={() => void addUser(u.userId)}
                        className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 border-b border-gray-100 last:border-0"
                      >
                        <div className="font-medium">
                          {u.employeeName ?? u.name ?? u.email ?? 'User'}
                        </div>
                        <div className="text-gray-400">{u.email ?? ''}</div>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
