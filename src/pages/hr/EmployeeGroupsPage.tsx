/**
 * EmployeeGroupsPage — manage employee groups used as a workflow assignment
 * scope. Each group is a set of employees that a workflow can target.
 *
 * Boswalmsfinal addition (motho2 had this; boswalmsfinal didn't until the
 * 20260514000006_workflow_management.sql migration).
 */

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useApp } from '@/context/AppContext';
import { useUserRole } from '@/hooks/hr/useUserRole';
import { useEmployees } from '@/hooks/hr/useEmployees';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Plus, Trash2, Pencil, Users, X } from 'lucide-react';

interface EmployeeGroup {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
}

interface EmployeeGroupMember {
  id: string;
  group_id: string;
  employee_id: string;
}

const wfFrom = (table: string) => (supabase.from(table as never) as never) as {
  select: (sel: string) => any;
  insert: (v: unknown) => any;
  update: (v: unknown) => any;
  delete: () => any;
};

export default function EmployeeGroupsPage() {
  const { navigate } = useApp();
  const queryClient = useQueryClient();
  const { can, isSuperAdmin } = useUserRole();
  const { employees } = useEmployees();
  const canWrite = isSuperAdmin || can('admin_users', 'write');

  const [showDialog, setShowDialog] = useState(false);
  const [editing, setEditing] = useState<EmployeeGroup | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const { data: groups = [], isLoading } = useQuery({
    queryKey: ['employee_groups'],
    queryFn: async (): Promise<EmployeeGroup[]> => {
      const { data, error } = await wfFrom('employee_groups')
        .select('*')
        .order('name');
      if (error) {
        toast.error((error as { message: string }).message);
        return [];
      }
      return (data ?? []) as EmployeeGroup[];
    },
    staleTime: 60 * 1000,
  });

  const { data: members = [], refetch: refetchMembers } = useQuery({
    queryKey: ['employee_group_members', activeGroupId],
    queryFn: async (): Promise<EmployeeGroupMember[]> => {
      if (!activeGroupId) return [];
      const { data, error } = await wfFrom('employee_group_members')
        .select('*')
        .eq('group_id', activeGroupId);
      if (error) return [];
      return (data ?? []) as EmployeeGroupMember[];
    },
    enabled: !!activeGroupId,
    staleTime: 30 * 1000,
  });

  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter((g) =>
      g.name.toLowerCase().includes(q) || (g.description ?? '').toLowerCase().includes(q),
    );
  }, [groups, search]);

  const openAdd = () => {
    setEditing(null);
    setName('');
    setDescription('');
    setShowDialog(true);
  };

  const openEdit = (g: EmployeeGroup) => {
    setEditing(g);
    setName(g.name);
    setDescription(g.description ?? '');
    setShowDialog(true);
  };

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error('Name is required.');
      return;
    }
    setSaving(true);
    const payload = {
      name: name.trim(),
      description: description.trim() || null,
    };
    let error;
    if (editing) {
      ({ error } = await wfFrom('employee_groups').update(payload).eq('id', editing.id));
    } else {
      ({ error } = await wfFrom('employee_groups').insert({ ...payload, is_active: true }));
    }
    setSaving(false);
    if (error) {
      toast.error((error as { message: string }).message);
      return;
    }
    toast.success(editing ? 'Group updated.' : 'Group created.');
    setShowDialog(false);
    queryClient.invalidateQueries({ queryKey: ['employee_groups'] });
  };

  const handleDelete = async (g: EmployeeGroup) => {
    if (!window.confirm(`Delete group "${g.name}"? Its members and any workflow assignments referencing it will be removed.`)) return;
    const { error } = await wfFrom('employee_groups').delete().eq('id', g.id);
    if (error) {
      toast.error((error as { message: string }).message);
      return;
    }
    toast.success('Group deleted.');
    if (activeGroupId === g.id) setActiveGroupId(null);
    queryClient.invalidateQueries({ queryKey: ['employee_groups'] });
  };

  const addMember = async (employeeId: string) => {
    if (!activeGroupId) return;
    if (members.some((m) => m.employee_id === employeeId)) {
      toast.error('That employee is already in this group.');
      return;
    }
    const { error } = await wfFrom('employee_group_members').insert({
      group_id: activeGroupId,
      employee_id: employeeId,
    });
    if (error) {
      toast.error((error as { message: string }).message);
      return;
    }
    void refetchMembers();
  };

  const removeMember = async (memberId: string) => {
    const { error } = await wfFrom('employee_group_members').delete().eq('id', memberId);
    if (error) {
      toast.error((error as { message: string }).message);
      return;
    }
    void refetchMembers();
  };

  const activeGroup = groups.find((g) => g.id === activeGroupId) ?? null;
  const memberIds = new Set(members.map((m) => m.employee_id));
  const memberEmployees = employees.filter((e) => memberIds.has(e.id));
  const availableEmployees = employees.filter((e) => !memberIds.has(e.id));

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-gray-400 mb-1">HR Management › Employee Groups</p>
          <h1 className="text-2xl font-bold text-gray-900">Employee Groups</h1>
          <p className="text-sm text-gray-500 mt-1">
            Group employees to target specific workflows. A workflow assignment with
            the &ldquo;Employee Group&rdquo; scope routes requests from every member of that
            group through that workflow.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => navigate('hr-workflows')}
            className="text-xs text-gray-700 border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-50"
          >
            Workflows
          </button>
          {canWrite && (
            <button
              onClick={openAdd}
              className="flex items-center gap-2 bg-[#1E3A5F] hover:bg-[#162d4a] text-white text-sm font-medium px-4 py-2 rounded-lg"
            >
              <Plus size={16} /> New Group
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200 text-sm font-semibold text-gray-700 flex items-center justify-between gap-2">
            <span>Groups</span>
            <input
              className="text-xs border border-gray-200 rounded-md px-2 py-1 outline-none focus:border-gray-400"
              placeholder="Search…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: 160 }}
            />
          </div>
          {isLoading ? (
            <div className="text-center py-12 text-gray-400">Loading…</div>
          ) : filteredGroups.length === 0 ? (
            <div className="text-center py-12 text-gray-400 text-sm">
              {groups.length === 0 ? 'No groups yet.' : 'No matches.'}
            </div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {filteredGroups.map((g) => (
                <li
                  key={g.id}
                  className={`px-4 py-3 hover:bg-gray-50 cursor-pointer ${
                    activeGroupId === g.id ? 'bg-blue-50' : ''
                  }`}
                  onClick={() => setActiveGroupId(g.id)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900 truncate">{g.name}</p>
                      {g.description && (
                        <p className="text-xs text-gray-500 truncate">{g.description}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {canWrite && (
                        <>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              openEdit(g);
                            }}
                            className="text-gray-400 hover:text-gray-800 p-1"
                            aria-label="Edit"
                          >
                            <Pencil size={12} />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleDelete(g);
                            }}
                            className="text-red-400 hover:text-red-600 p-1"
                            aria-label="Delete"
                          >
                            <Trash2 size={12} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200 text-sm font-semibold text-gray-700 flex items-center gap-2">
            <Users size={14} />
            {activeGroup ? activeGroup.name : 'Members'}
            {activeGroup && (
              <span className="text-xs font-normal text-gray-400">
                · {memberEmployees.length} member{memberEmployees.length === 1 ? '' : 's'}
              </span>
            )}
          </div>
          {!activeGroup ? (
            <div className="text-center py-12 text-gray-400 text-sm">
              Select a group to view and edit members.
            </div>
          ) : (
            <div className="p-4 space-y-3">
              <div className="flex flex-wrap gap-1.5">
                {memberEmployees.length === 0 && (
                  <span className="text-xs text-gray-400 italic">No members yet.</span>
                )}
                {memberEmployees.map((e) => {
                  const m = members.find((m) => m.employee_id === e.id);
                  return (
                    <span
                      key={e.id}
                      className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-full border bg-purple-50 border-purple-200 text-purple-700"
                    >
                      <span className="font-medium">{e.employee_name}</span>
                      {canWrite && m && (
                        <button
                          onClick={() => void removeMember(m.id)}
                          className="ml-0.5 text-gray-400 hover:text-red-600"
                          aria-label="Remove member"
                        >
                          <X size={11} />
                        </button>
                      )}
                    </span>
                  );
                })}
              </div>
              {canWrite && availableEmployees.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Add employee
                  </label>
                  <select
                    value=""
                    onChange={(e) => {
                      if (e.target.value) void addMember(e.target.value);
                    }}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  >
                    <option value="">Pick an employee…</option>
                    {availableEmployees.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.employee_name} ({e.employee_code})
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <Dialog
        open={showDialog}
        onOpenChange={(o) => {
          if (!o && !saving) setShowDialog(false);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Group' : 'New Employee Group'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 mt-2">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Name*</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Senior Management"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Description
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setShowDialog(false)}
                className="px-4 py-2 border border-gray-300 text-sm rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleSave()}
                disabled={saving}
                className="bg-[#1E3A5F] text-white text-sm font-medium px-5 py-2 rounded-lg disabled:opacity-50"
              >
                {saving ? 'Saving…' : editing ? 'Save Changes' : 'Create Group'}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
