/**
 * AssignmentsPanel — manage which leave/loan types / departments / employee
 * groups a workflow governs. Without an active assignment, requests fall
 * back to the legacy 3-stage approval path.
 *
 * Boswalmsfinal adaptations vs motho2:
 *   - `departments` → `hr_departments`
 *   - Owner table uses identical names — only the scope_id type-coercion is
 *     needed (boswalmsfinal stores scope_id as TEXT to hold UUIDs from any
 *     of several reference tables).
 */

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Plus, Trash2, Globe, Users, Tag, Building2, type LucideIcon } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type {
  WorkflowAssignment,
  WorkflowRequestType,
  WorkflowScopeType,
} from '@/lib/hr/workflowEngine';

interface Props {
  workflowId: string;
  workflowRequestType: WorkflowRequestType;
  canWrite: boolean;
}

interface ScopeOption {
  id: string;
  label: string;
  hint?: string;
}

const SCOPE_LABEL: Record<WorkflowScopeType, string> = {
  leave_type: 'Leave Type',
  loan_type: 'Loan Type',
  department: 'Department',
  employee_group: 'Employee Group',
  global: 'Global (everyone)',
};

const SCOPE_ICON: Record<WorkflowScopeType, LucideIcon> = {
  leave_type: Tag,
  loan_type: Tag,
  department: Building2,
  employee_group: Users,
  global: Globe,
};

const allowedScopeTypes = (rt: WorkflowRequestType): WorkflowScopeType[] => {
  if (rt === 'leave') return ['leave_type', 'department', 'employee_group', 'global'];
  if (rt === 'loan') return ['loan_type', 'department', 'employee_group', 'global'];
  return ['leave_type', 'loan_type', 'department', 'employee_group', 'global'];
};

const wfFrom = (table: string) => (supabase.from(table as never) as never) as {
  select: (sel: string) => any;
  insert: (v: unknown) => any;
  update: (v: unknown) => any;
  delete: () => any;
};

export default function AssignmentsPanel({
  workflowId,
  workflowRequestType,
  canWrite,
}: Props) {
  const queryClient = useQueryClient();
  const [showDialog, setShowDialog] = useState(false);
  const [saving, setSaving] = useState(false);
  const [scopeType, setScopeType] = useState<WorkflowScopeType>(
    allowedScopeTypes(workflowRequestType)[0],
  );
  const [scopeId, setScopeId] = useState<string>('');
  const [priority, setPriority] = useState('0');

  const { data: assignments = [], refetch } = useQuery({
    queryKey: ['workflow-assignments', workflowId],
    queryFn: async (): Promise<WorkflowAssignment[]> => {
      const { data, error } = await wfFrom('workflow_assignments')
        .select('*')
        .eq('workflow_id', workflowId)
        .order('priority', { ascending: false });
      if (error) {
        toast.error((error as { message: string }).message);
        return [];
      }
      return (data ?? []) as WorkflowAssignment[];
    },
    staleTime: 30 * 1000,
  });

  const allowed = allowedScopeTypes(workflowRequestType);

  const { data: leaveTypes = [] } = useQuery({
    queryKey: ['ref:leave_types'],
    queryFn: async () => {
      const { data } = await supabase
        .from('leave_types')
        .select('id, name')
        .order('name');
      return (data ?? []) as Array<{ id: string; name: string }>;
    },
    enabled: allowed.includes('leave_type'),
    staleTime: 10 * 60 * 1000,
  });

  const { data: loanTypes = [] } = useQuery({
    queryKey: ['ref:loan_types'],
    queryFn: async () => {
      const { data } = await supabase
        .from('loan_types')
        .select('id, name')
        .order('name');
      return (data ?? []) as Array<{ id: string; name: string }>;
    },
    enabled: allowed.includes('loan_type'),
    staleTime: 10 * 60 * 1000,
  });

  const { data: departments = [] } = useQuery({
    queryKey: ['ref:hr_departments'],
    queryFn: async () => {
      const { data } = await supabase
        .from('hr_departments')
        .select('id, name')
        .order('name');
      return (data ?? []) as Array<{ id: string; name: string }>;
    },
    enabled: allowed.includes('department'),
    staleTime: 10 * 60 * 1000,
  });

  const { data: employeeGroups = [] } = useQuery({
    queryKey: ['ref:employee_groups'],
    queryFn: async () => {
      const { data } = await wfFrom('employee_groups')
        .select('id, name')
        .order('name');
      return (data ?? []) as Array<{ id: string; name: string }>;
    },
    enabled: allowed.includes('employee_group'),
    staleTime: 10 * 60 * 1000,
  });

  const scopeOptionsByType = useMemo<Record<WorkflowScopeType, ScopeOption[]>>(
    () => ({
      leave_type: leaveTypes.map((t) => ({ id: t.id, label: t.name })),
      loan_type: loanTypes.map((t) => ({ id: t.id, label: t.name })),
      department: departments.map((d) => ({ id: d.id, label: d.name })),
      employee_group: employeeGroups.map((g) => ({ id: g.id, label: g.name })),
      global: [],
    }),
    [leaveTypes, loanTypes, departments, employeeGroups],
  );

  const scopeLabel = (a: WorkflowAssignment): string => {
    if (a.scope_type === 'global') return 'Everyone';
    const opts = scopeOptionsByType[a.scope_type];
    const match = opts.find((o) => o.id === a.scope_id);
    return match?.label ?? 'Unknown';
  };

  const openAdd = () => {
    const initial = allowedScopeTypes(workflowRequestType)[0];
    setScopeType(initial);
    setScopeId('');
    setPriority('0');
    setShowDialog(true);
  };

  const handleSave = async () => {
    if (scopeType !== 'global' && !scopeId) {
      toast.error('Pick something to assign this workflow to.');
      return;
    }
    const dup = assignments.find(
      (a) =>
        a.scope_type === scopeType &&
        (scopeType === 'global' ? true : a.scope_id === scopeId) &&
        a.is_active,
    );
    if (dup) {
      toast.error(`An active assignment for this ${SCOPE_LABEL[scopeType]} already exists.`);
      return;
    }

    setSaving(true);
    const { error } = await wfFrom('workflow_assignments').insert({
      workflow_id: workflowId,
      scope_type: scopeType,
      scope_id: scopeType === 'global' ? null : scopeId,
      priority: parseInt(priority) || 0,
      is_active: true,
    });
    setSaving(false);
    if (error) {
      toast.error((error as { message: string }).message);
      return;
    }
    toast.success('Assignment added.');
    setShowDialog(false);
    refetch();
    queryClient.invalidateQueries({ queryKey: ['workflows'] });
  };

  const handleDelete = async (a: WorkflowAssignment) => {
    if (
      !window.confirm(
        `Remove this ${SCOPE_LABEL[a.scope_type]} assignment? New requests will revert to the legacy approval flow.`,
      )
    )
      return;
    const { error } = await wfFrom('workflow_assignments').delete().eq('id', a.id);
    if (error) {
      toast.error((error as { message: string }).message);
      return;
    }
    toast.success('Assignment removed.');
    refetch();
    queryClient.invalidateQueries({ queryKey: ['workflows'] });
  };

  const toggleActive = async (a: WorkflowAssignment) => {
    const { error } = await wfFrom('workflow_assignments')
      .update({ is_active: !a.is_active })
      .eq('id', a.id);
    if (error) {
      toast.error((error as { message: string }).message);
      return;
    }
    refetch();
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Assignments</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Decide which requests this workflow governs. Resolution order:
            leave/loan type → employee group → department → global. Within the
            same scope, higher priority wins.
          </p>
        </div>
        {canWrite && (
          <button
            onClick={openAdd}
            className="flex items-center gap-2 bg-[#1E3A5F] hover:bg-[#162d4a] text-white text-sm font-medium px-3 py-1.5 rounded-lg"
          >
            <Plus size={14} /> Add Assignment
          </button>
        )}
      </div>

      {assignments.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
          <p className="text-sm text-gray-500">
            No assignments yet. Until you add one, requests will continue using
            the legacy approval flow.
          </p>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['Scope', 'Target', 'Priority', 'Status', 'Actions'].map((h) => (
                  <th
                    key={h}
                    className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {assignments.map((a) => {
                const Icon = SCOPE_ICON[a.scope_type];
                return (
                  <tr key={a.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-3 py-2.5">
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-700">
                        <Icon size={13} />
                        {SCOPE_LABEL[a.scope_type]}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 font-medium">{scopeLabel(a)}</td>
                    <td className="px-3 py-2.5 text-center">{a.priority}</td>
                    <td className="px-3 py-2.5">
                      <button
                        onClick={() => canWrite && void toggleActive(a)}
                        disabled={!canWrite}
                        className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          a.is_active
                            ? 'bg-green-100 text-green-700'
                            : 'bg-gray-100 text-gray-500'
                        } ${canWrite ? 'cursor-pointer hover:opacity-80' : ''}`}
                      >
                        {a.is_active ? 'Active' : 'Inactive'}
                      </button>
                    </td>
                    <td className="px-3 py-2.5">
                      {canWrite && (
                        <button
                          onClick={() => void handleDelete(a)}
                          className="flex items-center gap-1 text-xs text-red-600 border border-red-200 rounded px-2 py-1 hover:bg-red-50"
                        >
                          <Trash2 size={11} /> Remove
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={showDialog} onOpenChange={(o) => { if (!o && !saving) setShowDialog(false); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Workflow Assignment</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Scope Type*
              </label>
              <select
                value={scopeType}
                onChange={(e) => {
                  setScopeType(e.target.value as WorkflowScopeType);
                  setScopeId('');
                }}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              >
                {allowed.map((st) => (
                  <option key={st} value={st}>
                    {SCOPE_LABEL[st]}
                  </option>
                ))}
              </select>
            </div>

            {scopeType !== 'global' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {SCOPE_LABEL[scopeType]}*
                </label>
                {scopeOptionsByType[scopeType].length === 0 ? (
                  <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    No {SCOPE_LABEL[scopeType].toLowerCase()}s exist yet.
                    {scopeType === 'employee_group' && ' Create one in the Employee Groups screen first.'}
                  </p>
                ) : (
                  <select
                    value={scopeId}
                    onChange={(e) => setScopeId(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  >
                    <option value="">
                      Pick a {SCOPE_LABEL[scopeType].toLowerCase()}…
                    </option>
                    {scopeOptionsByType[scopeType].map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Priority
              </label>
              <input
                type="number"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
              <p className="text-xs text-gray-400 mt-1">
                When two assignments at the same scope match, the one with the
                higher priority wins.
              </p>
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
                {saving ? 'Saving…' : 'Add Assignment'}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
