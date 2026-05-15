/**
 * WorkflowEditorPage — configure a workflow's stages, owners and assignments.
 *
 * Ported from motho2/src/pages/admin/WorkflowEditor.tsx. Boswalmsfinal uses
 * page-id navigation: useApp().pageParams.workflowId carries the id (set by
 * WorkflowsPage's navigate('hr-workflow-editor', { workflowId })).
 */

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useApp } from '@/context/AppContext';
import { useUserRole } from '@/hooks/hr/useUserRole';
import { toast } from 'sonner';
import { Plus, ChevronUp, ChevronDown, Trash2, ArrowLeft } from 'lucide-react';
import StageOwnersPicker from '@/components/hr/workflow/StageOwnersPicker';
import AssignmentsPanel from '@/components/hr/workflow/AssignmentsPanel';
import type {
  ApprovalType,
  Workflow,
  WorkflowStage,
  WorkflowStageOwner,
} from '@/lib/hr/workflowEngine';

// Stage keys reserved for the legacy 3-stage path (approvalWorkflow.ts).
const RESERVED_KEYS = new Set(['hr', 'admin', 'super_admin']);

const slugify = (s: string) =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

type StageWithOwners = WorkflowStage & { owners: WorkflowStageOwner[] };

const wfFrom = (table: string) => (supabase.from(table as never) as never) as {
  select: (sel: string) => any;
  insert: (v: unknown) => any;
  update: (v: unknown) => any;
  delete: () => any;
};

export default function WorkflowEditorPage() {
  const { navigate, pageParams } = useApp();
  const queryClient = useQueryClient();
  const { can, isSuperAdmin } = useUserRole();
  const canWrite = isSuperAdmin || can('admin_users', 'write');

  const workflowId = (pageParams?.workflowId as string | undefined) ?? null;

  const [adding, setAdding] = useState(false);
  const [newStageName, setNewStageName] = useState('');

  const { data: workflow, isLoading: wfLoading } = useQuery({
    queryKey: ['workflow', workflowId],
    queryFn: async () => {
      if (!workflowId) return null;
      const { data, error } = await wfFrom('workflows')
        .select('*')
        .eq('id', workflowId)
        .maybeSingle();
      if (error || !data) return null;
      return data as Workflow;
    },
    enabled: !!workflowId,
    staleTime: 60 * 1000,
  });

  const {
    data: stages = [],
    isLoading: stagesLoading,
    refetch: refetchStages,
  } = useQuery({
    queryKey: ['workflow-stages', workflowId],
    queryFn: async (): Promise<StageWithOwners[]> => {
      if (!workflowId) return [];
      const { data, error } = await wfFrom('workflow_stages')
        .select('*, workflow_stage_owners(*)')
        .eq('workflow_id', workflowId)
        .order('stage_order', { ascending: true });
      if (error) {
        toast.error((error as { message: string }).message);
        return [];
      }
      return ((data ?? []) as Array<{
        id: string;
        workflow_id: string;
        stage_order: number;
        stage_key: string;
        stage_name: string;
        description: string | null;
        approval_type: ApprovalType;
        is_active: boolean;
        workflow_stage_owners?: WorkflowStageOwner[];
      }>).map((s) => ({
        id: s.id,
        workflow_id: s.workflow_id,
        stage_order: s.stage_order,
        stage_key: s.stage_key,
        stage_name: s.stage_name,
        description: s.description ?? null,
        approval_type: s.approval_type,
        is_active: s.is_active,
        owners: s.workflow_stage_owners ?? [],
      }));
    },
    enabled: !!workflowId,
    staleTime: 30 * 1000,
  });

  const onStagesChanged = () => {
    void refetchStages();
  };

  const addStage = async () => {
    const name = newStageName.trim();
    if (!name) return;
    const baseKey = slugify(name);
    if (!baseKey || RESERVED_KEYS.has(baseKey)) {
      toast.error(`Stage key "${baseKey}" is reserved or empty. Pick a different name.`);
      return;
    }
    let stageKey = baseKey;
    let n = 2;
    while (stages.some((s) => s.stage_key === stageKey)) {
      stageKey = `${baseKey}_${n++}`;
    }
    const nextOrder =
      stages.length === 0 ? 1 : Math.max(...stages.map((s) => s.stage_order)) + 1;

    const { error } = await wfFrom('workflow_stages').insert({
      workflow_id: workflowId,
      stage_order: nextOrder,
      stage_key: stageKey,
      stage_name: name,
      description: null,
      approval_type: 'ANY',
      is_active: true,
    });
    if (error) {
      toast.error((error as { message: string }).message);
      return;
    }
    setNewStageName('');
    setAdding(false);
    onStagesChanged();
    queryClient.invalidateQueries({ queryKey: ['workflows'] });
  };

  const moveStage = async (stage: StageWithOwners, direction: -1 | 1) => {
    const sorted = [...stages].sort((a, b) => a.stage_order - b.stage_order);
    const idx = sorted.findIndex((s) => s.id === stage.id);
    const swapWith = sorted[idx + direction];
    if (!swapWith) return;
    const { error: e1 } = await wfFrom('workflow_stages')
      .update({ stage_order: swapWith.stage_order })
      .eq('id', stage.id);
    const { error: e2 } = await wfFrom('workflow_stages')
      .update({ stage_order: stage.stage_order })
      .eq('id', swapWith.id);
    if (e1 || e2) {
      toast.error(((e1 ?? e2) as { message: string }).message);
      return;
    }
    onStagesChanged();
  };

  const updateStage = async (stage: StageWithOwners, patch: Partial<WorkflowStage>) => {
    const { error } = await wfFrom('workflow_stages').update(patch).eq('id', stage.id);
    if (error) {
      toast.error((error as { message: string }).message);
      return;
    }
    onStagesChanged();
  };

  const deleteStage = async (stage: StageWithOwners) => {
    if (
      !window.confirm(
        `Delete stage "${stage.stage_name}"? Its approvers will be removed too.`,
      )
    )
      return;
    const { error } = await wfFrom('workflow_stages').delete().eq('id', stage.id);
    if (error) {
      toast.error((error as { message: string }).message);
      return;
    }
    const remaining = stages
      .filter((s) => s.id !== stage.id)
      .sort((a, b) => a.stage_order - b.stage_order);
    for (let i = 0; i < remaining.length; i++) {
      const expected = i + 1;
      if (remaining[i].stage_order !== expected) {
        await wfFrom('workflow_stages')
          .update({ stage_order: expected })
          .eq('id', remaining[i].id);
      }
    }
    onStagesChanged();
    queryClient.invalidateQueries({ queryKey: ['workflows'] });
  };

  if (!workflowId) {
    return (
      <div className="p-6">
        <p className="text-gray-500">No workflow id supplied.</p>
        <button
          onClick={() => navigate('hr-workflows')}
          className="mt-3 text-sm text-[#1E3A5F] hover:underline"
        >
          ← Back to Workflows
        </button>
      </div>
    );
  }
  if (wfLoading) {
    return <div className="p-6 text-gray-400">Loading workflow…</div>;
  }
  if (!workflow) {
    return (
      <div className="p-6">
        <p className="text-gray-500">Workflow not found.</p>
        <button
          onClick={() => navigate('hr-workflows')}
          className="mt-3 text-sm text-[#1E3A5F] hover:underline"
        >
          ← Back to Workflows
        </button>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <button
          onClick={() => navigate('hr-workflows')}
          className="text-xs text-gray-500 hover:text-gray-800 flex items-center gap-1 mb-2"
        >
          <ArrowLeft size={12} /> Back to Workflows
        </button>
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-gray-400 mb-1">
              HR Management › Workflow Management › {workflow.name}
            </p>
            <h1 className="text-2xl font-bold text-gray-900">{workflow.name}</h1>
            <div className="flex items-center gap-2 mt-2">
              <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-medium">
                {workflow.request_type === 'leave'
                  ? 'Leave'
                  : workflow.request_type === 'loan'
                    ? 'Loan'
                    : 'Generic'}
              </span>
              <span className="text-xs font-mono text-gray-500">{workflow.code}</span>
              <span
                className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  workflow.is_active
                    ? 'bg-green-100 text-green-700'
                    : 'bg-gray-100 text-gray-500'
                }`}
              >
                {workflow.is_active ? 'Active' : 'Inactive'}
              </span>
            </div>
            {workflow.description && (
              <p className="text-sm text-gray-500 mt-2 max-w-2xl">{workflow.description}</p>
            )}
          </div>
        </div>
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Stages</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Requests move through these stages in order. Each stage can have
              multiple approvers via roles or specific users.
            </p>
          </div>
          {canWrite && !adding && (
            <button
              onClick={() => setAdding(true)}
              className="flex items-center gap-2 bg-[#1E3A5F] hover:bg-[#162d4a] text-white text-sm font-medium px-3 py-1.5 rounded-lg"
            >
              <Plus size={14} /> Add Stage
            </button>
          )}
        </div>

        {adding && (
          <div className="bg-white border border-dashed border-gray-300 rounded-xl p-4 flex items-center gap-2">
            <input
              autoFocus
              value={newStageName}
              onChange={(e) => setNewStageName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void addStage();
                if (e.key === 'Escape') {
                  setAdding(false);
                  setNewStageName('');
                }
              }}
              placeholder="Stage name — e.g. HR Review, Finance Approval"
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
            <button
              onClick={() => void addStage()}
              className="bg-[#1E3A5F] text-white text-sm px-4 py-2 rounded-lg"
            >
              Add
            </button>
            <button
              onClick={() => {
                setAdding(false);
                setNewStageName('');
              }}
              className="px-3 py-2 border border-gray-300 text-sm rounded-lg"
            >
              Cancel
            </button>
          </div>
        )}

        {stagesLoading ? (
          <div className="text-center py-8 text-gray-400">Loading stages…</div>
        ) : stages.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
            <p className="text-sm text-gray-500">
              No stages yet. Add at least one stage before assigning this workflow.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {stages.map((s, idx) => (
              <StageCard
                key={s.id}
                stage={s}
                index={idx}
                total={stages.length}
                canWrite={canWrite}
                onMove={(dir) => void moveStage(s, dir)}
                onUpdate={(patch) => void updateStage(s, patch)}
                onDelete={() => void deleteStage(s)}
                onOwnersChanged={onStagesChanged}
              />
            ))}
          </div>
        )}
      </section>

      <AssignmentsPanel
        workflowId={workflow.id}
        workflowRequestType={workflow.request_type}
        canWrite={canWrite}
      />
    </div>
  );
}

// ─── Stage card ────────────────────────────────────────────────────────

interface StageCardProps {
  stage: StageWithOwners;
  index: number;
  total: number;
  canWrite: boolean;
  onMove: (direction: -1 | 1) => void;
  onUpdate: (patch: Partial<WorkflowStage>) => void;
  onDelete: () => void;
  onOwnersChanged: () => void;
}

function StageCard({
  stage,
  index,
  total,
  canWrite,
  onMove,
  onUpdate,
  onDelete,
  onOwnersChanged,
}: StageCardProps) {
  const [nameDraft, setNameDraft] = useState(stage.stage_name);
  const [descDraft, setDescDraft] = useState(stage.description ?? '');
  const isFirst = index === 0;
  const isLast = index === total - 1;

  const commitName = () => {
    const trimmed = nameDraft.trim();
    if (!trimmed || trimmed === stage.stage_name) {
      setNameDraft(stage.stage_name);
      return;
    }
    onUpdate({ stage_name: trimmed });
  };
  const commitDesc = () => {
    const v = descDraft.trim() || null;
    if (v === (stage.description ?? null)) return;
    onUpdate({ description: v });
  };

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
      <div className="flex items-start gap-3">
        <div className="flex flex-col items-center pt-1">
          <button
            disabled={!canWrite || isFirst}
            onClick={() => onMove(-1)}
            className="text-gray-400 hover:text-gray-800 disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label="Move up"
          >
            <ChevronUp size={16} />
          </button>
          <span className="text-xs font-bold text-gray-400 my-0.5">
            {stage.stage_order}
          </span>
          <button
            disabled={!canWrite || isLast}
            onClick={() => onMove(1)}
            className="text-gray-400 hover:text-gray-800 disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label="Move down"
          >
            <ChevronDown size={16} />
          </button>
        </div>

        <div className="flex-1 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <input
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              }}
              disabled={!canWrite}
              className="font-semibold text-gray-900 border-b border-transparent focus:border-gray-300 focus:outline-none px-1 disabled:bg-transparent"
            />
            <span className="text-xs font-mono text-gray-400">{stage.stage_key}</span>
            <div className="ml-auto flex items-center gap-2">
              <ApprovalTypeToggle
                value={stage.approval_type}
                disabled={!canWrite}
                onChange={(t) => onUpdate({ approval_type: t })}
              />
              <button
                onClick={() => onUpdate({ is_active: !stage.is_active })}
                disabled={!canWrite}
                className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  stage.is_active
                    ? 'bg-green-100 text-green-700'
                    : 'bg-gray-100 text-gray-500'
                } disabled:opacity-60`}
              >
                {stage.is_active ? 'Active' : 'Inactive'}
              </button>
              {canWrite && (
                <button
                  onClick={onDelete}
                  className="text-red-500 hover:bg-red-50 p-1 rounded"
                  aria-label="Delete stage"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          </div>

          <textarea
            value={descDraft}
            onChange={(e) => setDescDraft(e.target.value)}
            onBlur={commitDesc}
            disabled={!canWrite}
            placeholder="Description shown to approvers when they review this stage…"
            rows={2}
            className="w-full text-sm text-gray-700 border border-gray-200 rounded-lg px-2 py-1.5 focus:border-gray-400 focus:outline-none disabled:bg-transparent disabled:border-transparent disabled:resize-none"
          />

          <div>
            <p className="text-xs font-medium text-gray-500 uppercase mb-1.5">Approvers</p>
            <StageOwnersPicker
              stageId={stage.id}
              owners={stage.owners}
              onChange={onOwnersChanged}
              disabled={!canWrite}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

interface ApprovalTypeToggleProps {
  value: ApprovalType;
  disabled?: boolean;
  onChange: (t: ApprovalType) => void;
}

function ApprovalTypeToggle({ value, disabled, onChange }: ApprovalTypeToggleProps) {
  return (
    <div className="inline-flex items-center bg-gray-100 rounded-full p-0.5 text-xs">
      {(['ANY', 'ALL'] as ApprovalType[]).map((t) => (
        <button
          key={t}
          onClick={() => !disabled && value !== t && onChange(t)}
          disabled={disabled}
          className={`px-2 py-0.5 rounded-full font-medium transition-colors ${
            value === t ? 'bg-[#1E3A5F] text-white' : 'text-gray-600 hover:text-gray-900'
          } disabled:opacity-60`}
          title={
            t === 'ANY'
              ? 'Any one approver can advance the request'
              : 'All approvers must approve before advancing'
          }
        >
          {t}
        </button>
      ))}
    </div>
  );
}
