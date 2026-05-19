/**
 * WorkflowsPage — list and manage approval workflows.
 *
 * Ported from motho2/src/pages/admin/Workflows.tsx. Boswalmsfinal navigation
 * is page-id based via useApp().navigate('hr-workflow-editor', { workflowId })
 * rather than react-router URLs.
 *
 * Gated behind super_admin in AppLayout's ROLE_PAGES.
 */

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/hooks/useAuth';
import { useUserRole } from '@/hooks/hr/useUserRole';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Plus, Pencil, Trash2, ArrowRight } from 'lucide-react';
import type { Workflow, WorkflowRequestType } from '@/lib/hr/workflowEngine';

interface WorkflowRow extends Workflow {
  stage_count?: number;
  assignment_count?: number;
}

const REQUEST_TYPE_LABEL: Record<WorkflowRequestType, string> = {
  leave: 'Leave',
  loan: 'Loan',
  generic: 'Generic',
};

const slugify = (s: string) =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

const wfFrom = (table: string) => (supabase.from(table as never) as never) as {
  select: (sel: string, opts?: { count?: 'exact'; head?: boolean }) => any;
  insert: (v: unknown) => any;
  update: (v: unknown) => any;
  delete: () => any;
};

export default function WorkflowsPage() {
  const { navigate } = useApp();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { can, isSuperAdmin } = useUserRole();

  const canWrite = isSuperAdmin || can('admin_users', 'write');
  const canDelete = isSuperAdmin || can('admin_users', 'delete');

  const [showDialog, setShowDialog] = useState(false);
  const [editing, setEditing] = useState<WorkflowRow | null>(null);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [requestType, setRequestType] = useState<WorkflowRequestType>('leave');
  const [description, setDescription] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [search, setSearch] = useState('');

  const { data: workflows = [], isLoading: loading } = useQuery({
    queryKey: ['workflows'],
    queryFn: async () => {
      const { data, error } = await wfFrom('workflows')
        .select(
          'id, name, code, description, request_type, is_active, created_by, created_at, workflow_stages(count), workflow_assignments(count)',
        )
        .order('name');
      if (error) {
        toast.error((error as { message: string }).message);
        return [] as WorkflowRow[];
      }
      return ((data ?? []) as Array<{
        id: string;
        name: string;
        code: string;
        description: string | null;
        request_type: WorkflowRequestType;
        is_active: boolean;
        created_at: string;
        workflow_stages?: Array<{ count: number }>;
        workflow_assignments?: Array<{ count: number }>;
      }>).map((w) => ({
        id: w.id,
        name: w.name,
        code: w.code,
        description: w.description,
        request_type: w.request_type,
        is_active: w.is_active,
        created_at: w.created_at,
        stage_count: w.workflow_stages?.[0]?.count ?? 0,
        assignment_count: w.workflow_assignments?.[0]?.count ?? 0,
      })) as WorkflowRow[];
    },
    staleTime: 60 * 1000,
  });

  const filteredWorkflows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return workflows;
    return workflows.filter((w) =>
      w.name.toLowerCase().includes(q) ||
      w.code.toLowerCase().includes(q) ||
      (w.description ?? '').toLowerCase().includes(q) ||
      (w.request_type ?? '').toLowerCase().includes(q),
    );
  }, [workflows, search]);

  const openAdd = () => {
    setEditing(null);
    setName('');
    setCode('');
    setRequestType('leave');
    setDescription('');
    setIsActive(true);
    setShowDialog(true);
  };

  const openEdit = (w: WorkflowRow) => {
    setEditing(w);
    setName(w.name);
    setCode(w.code);
    setRequestType(w.request_type);
    setDescription(w.description ?? '');
    setIsActive(w.is_active);
    setShowDialog(true);
  };

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error('Name is required.');
      return;
    }
    const codeFinal = (code.trim() || slugify(name)).toLowerCase();
    if (!codeFinal) {
      toast.error('Code is required.');
      return;
    }
    const dup = workflows.find((w) => w.code === codeFinal && w.id !== editing?.id);
    if (dup) {
      toast.error(`Code "${codeFinal}" is already in use.`);
      return;
    }

    setSaving(true);
    const payload: Record<string, unknown> = {
      name: name.trim(),
      code: codeFinal,
      request_type: requestType,
      description: description.trim() || null,
      is_active: isActive,
    };
    if (!editing) payload.created_by = user?.id ?? null;

    let error;
    if (editing) {
      ({ error } = await wfFrom('workflows').update(payload).eq('id', editing.id));
    } else {
      ({ error } = await wfFrom('workflows').insert(payload));
    }
    setSaving(false);
    if (error) {
      toast.error((error as { message: string }).message);
      return;
    }
    toast.success(editing ? 'Workflow updated.' : 'Workflow created.');
    setShowDialog(false);
    queryClient.invalidateQueries({ queryKey: ['workflows'] });
  };

  const handleDelete = async (w: WorkflowRow) => {
    const { count: liveCount } = await wfFrom('workflow_instances')
      .select('id', { count: 'exact', head: true })
      .eq('workflow_id', w.id)
      .eq('status', 'pending');
    if ((liveCount ?? 0) > 0) {
      toast.error(
        `Cannot delete — ${liveCount} pending request(s) are currently using this workflow. Deactivate it instead.`,
      );
      return;
    }
    if (
      !window.confirm(
        `Delete workflow "${w.name}"? This removes its stages, owners and assignments.`,
      )
    )
      return;
    const { error } = await wfFrom('workflows').delete().eq('id', w.id);
    if (error) {
      toast.error((error as { message: string }).message);
      return;
    }
    toast.success('Workflow deleted.');
    queryClient.invalidateQueries({ queryKey: ['workflows'] });
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-gray-400 mb-1">
            HR Management › Workflow Management
          </p>
          <h1 className="text-2xl font-bold text-gray-900">Workflows</h1>
          <p className="text-sm text-gray-500 mt-1">
            Configurable multi-stage approval flows. Assign each workflow to
            specific leave types, loan types, departments or employee groups.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate('hr-config')}
            className="text-xs text-gray-500 hover:text-gray-800 border border-gray-200 px-2 py-1.5 rounded-lg"
          >
            Back
          </button>
          {canWrite && (
            <button
              onClick={openAdd}
              className="flex items-center gap-2 bg-[#1E3A5F] hover:bg-[#162d4a] text-white text-sm font-medium px-4 py-2 rounded-lg"
            >
              <Plus size={16} /> New Workflow
            </button>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <input
          className="text-xs border border-gray-200 rounded-md px-2 py-1.5 outline-none focus:border-gray-400"
          placeholder="Search workflows…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: 240 }}
        />
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">Loading…</div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['#', 'Name', 'Code', 'Type', 'Stages', 'Assignments', 'Status', 'Actions'].map(
                  (h) => (
                    <th
                      key={h}
                      className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase"
                    >
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {filteredWorkflows.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center py-10 text-gray-400">
                    {workflows.length === 0
                      ? 'No workflows configured. Click "New Workflow" to create one.'
                      : 'No matches.'}
                  </td>
                </tr>
              )}
              {filteredWorkflows.map((w, idx) => (
                <tr key={w.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-3 py-2.5 text-gray-400 text-xs">{idx + 1}</td>
                  <td className="px-3 py-2.5">
                    <button
                      onClick={() => navigate('hr-workflow-editor', { workflowId: w.id })}
                      className="font-medium text-[#1E3A5F] hover:underline flex items-center gap-1"
                    >
                      {w.name}
                      <ArrowRight size={12} className="opacity-60" />
                    </button>
                    {w.description && (
                      <p className="text-xs text-gray-500 mt-0.5 max-w-md truncate">
                        {w.description}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-xs text-gray-600">{w.code}</td>
                  <td className="px-3 py-2.5">
                    <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-medium">
                      {REQUEST_TYPE_LABEL[w.request_type]}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-center">{w.stage_count ?? 0}</td>
                  <td className="px-3 py-2.5 text-center">{w.assignment_count ?? 0}</td>
                  <td className="px-3 py-2.5">
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        w.is_active
                          ? 'bg-green-100 text-green-700'
                          : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      {w.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex gap-1">
                      <button
                        onClick={() => navigate('hr-workflow-editor', { workflowId: w.id })}
                        className="flex items-center gap-1 text-xs text-gray-700 border border-gray-200 rounded px-2 py-1 hover:bg-gray-50"
                      >
                        Configure
                      </button>
                      {canWrite && (
                        <button
                          onClick={() => openEdit(w)}
                          className="flex items-center gap-1 text-xs text-gray-700 border border-gray-200 rounded px-2 py-1 hover:bg-gray-50"
                        >
                          <Pencil size={11} /> Edit
                        </button>
                      )}
                      {canDelete && (
                        <button
                          onClick={() => void handleDelete(w)}
                          className="flex items-center gap-1 text-xs text-red-600 border border-red-200 rounded px-2 py-1 hover:bg-red-50"
                        >
                          <Trash2 size={11} /> Delete
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog
        open={showDialog}
        onOpenChange={(o) => {
          if (!o && !saving) setShowDialog(false);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Workflow' : 'New Workflow'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Name*</label>
              <input
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (!editing && !code) setCode(slugify(e.target.value));
                }}
                placeholder="e.g. Standard Loan Approval"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Code* (lowercase, no spaces)
              </label>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toLowerCase().replace(/\s+/g, '_'))}
                placeholder="auto-derived from name"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Request Type*</label>
              <select
                value={requestType}
                onChange={(e) => setRequestType(e.target.value as WorkflowRequestType)}
                disabled={!!editing}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm disabled:bg-gray-50"
              >
                <option value="leave">Leave</option>
                <option value="loan">Loan</option>
                <option value="generic">Generic (any request)</option>
              </select>
              {editing && (
                <p className="text-xs text-gray-400 mt-1">
                  Request type can&apos;t be changed after creation.
                </p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                placeholder="Short description shown in the workflow list."
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <label className="flex items-center gap-3 cursor-pointer">
              <button
                type="button"
                onClick={() => setIsActive(!isActive)}
                className={`w-10 h-5 rounded-full transition-colors flex-shrink-0 ${
                  isActive ? 'bg-[#1E3A5F]' : 'bg-gray-300'
                }`}
              >
                <span
                  className={`block w-4 h-4 rounded-full bg-white mx-0.5 transition-transform ${
                    isActive ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
              <span className="text-sm text-gray-700">Active</span>
            </label>

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
                {saving ? 'Saving…' : editing ? 'Save Changes' : 'Create Workflow'}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
