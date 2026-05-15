/**
 * WorkflowStepper — visual timeline of a workflow-driven request.
 *
 * Returns null when the request has no workflow instance, so it's safe to
 * embed everywhere — legacy 3-stage requests simply render nothing here
 * (LeavesPage / LoansPage still show the legacy "Awaiting HR" line).
 *
 * Ported from motho2/src/components/workflow/WorkflowStepper.tsx with
 * boswalmsfinal adaptations: queries `profiles` (not `user_profiles`),
 * joins via `auth_user_id` on employees.
 */

import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Check, X, Clock, ChevronRight, RotateCcw, Users } from 'lucide-react';
import {
  getActiveInstance,
  getWorkflowTimeline,
  type TimelineStage,
  type WorkflowInstance,
  type WorkflowRequestType,
} from '@/lib/hr/workflowEngine';

interface Props {
  requestType: WorkflowRequestType;
  requestId: string;
  title?: string;
}

const formatTimestamp = (iso: string): string => {
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
};

const STATUS_STYLE: Record<
  TimelineStage['status'],
  { dot: string; ring: string; label: string; icon: typeof Check }
> = {
  approved: {
    dot: 'bg-green-600 text-white',
    ring: 'ring-green-100',
    label: 'Approved',
    icon: Check,
  },
  rejected: {
    dot: 'bg-red-600 text-white',
    ring: 'ring-red-100',
    label: 'Rejected',
    icon: X,
  },
  pending: {
    dot: 'bg-amber-500 text-white',
    ring: 'ring-amber-100 animate-pulse',
    label: 'Pending',
    icon: Clock,
  },
  sent_back: {
    dot: 'bg-orange-500 text-white',
    ring: 'ring-orange-100',
    label: 'Sent back',
    icon: RotateCcw,
  },
  waiting: {
    dot: 'bg-gray-200 text-gray-500',
    ring: 'ring-gray-100',
    label: 'Waiting',
    icon: ChevronRight,
  },
};

export default function WorkflowStepper({ requestType, requestId, title }: Props) {
  const [instance, setInstance] = useState<WorkflowInstance | null>(null);
  const [stages, setStages] = useState<TimelineStage[]>([]);
  const [approverNames, setApproverNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const inst = await getActiveInstance(requestType, requestId);
      if (cancelled) return;
      if (!inst) {
        setInstance(null);
        setStages([]);
        setLoading(false);
        return;
      }
      const timeline = await getWorkflowTimeline(inst.id);
      if (cancelled) return;
      if (!timeline) {
        setInstance(null);
        setStages([]);
        setLoading(false);
        return;
      }
      setInstance(timeline.instance);
      setStages(timeline.stages);

      // Resolve approver names. boswalmsfinal joins through profiles + employees.
      const approverIds = Array.from(
        new Set(
          timeline.stages.flatMap((s) => s.approvals.map((a) => a.approver_id)),
        ),
      );
      if (approverIds.length === 0) {
        setLoading(false);
        return;
      }
      const { data: profs } = await supabase
        .from('profiles')
        .select('user_id, name, email')
        .in('user_id', approverIds);

      // Also try to enrich with employee_name (via employees.auth_user_id).
      const { data: emps } = await supabase
        .from('employees')
        .select('auth_user_id, employee_name')
        .in('auth_user_id', approverIds);
      const empMap = new Map<string, string>();
      ((emps ?? []) as Array<{ auth_user_id: string; employee_name: string }>).forEach((e) => {
        if (e.auth_user_id) empMap.set(e.auth_user_id, e.employee_name);
      });

      const map: Record<string, string> = {};
      ((profs ?? []) as Array<{ user_id: string; name: string | null; email: string | null }>).forEach((p) => {
        map[p.user_id] =
          empMap.get(p.user_id) ?? p.name ?? p.email ?? 'Approver';
      });
      // Fill in any approvers without a profile row (shouldn't usually happen).
      approverIds.forEach((id) => {
        if (!map[id]) map[id] = empMap.get(id) ?? 'Approver';
      });
      if (!cancelled) {
        setApproverNames(map);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [requestType, requestId]);

  if (loading || !instance) return null;
  if (stages.length === 0) return null;

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-900">
          {title ?? 'Approval Progress'}
        </h3>
        <span
          className={`text-xs px-2 py-0.5 rounded-full font-medium ${
            instance.status === 'approved'
              ? 'bg-green-100 text-green-700'
              : instance.status === 'rejected'
                ? 'bg-red-100 text-red-700'
                : instance.status === 'sent_back'
                  ? 'bg-orange-100 text-orange-700'
                  : 'bg-amber-100 text-amber-700'
          }`}
        >
          {instance.status.replace('_', ' ')}
        </span>
      </div>

      <ol className="flex flex-col md:flex-row md:items-start gap-4 md:gap-2">
        {stages.map((s, idx) => {
          const style = STATUS_STYLE[s.status];
          const Icon = style.icon;
          return (
            <li
              key={s.id}
              className="flex md:flex-col md:flex-1 items-start gap-3 md:gap-2 relative"
            >
              {idx < stages.length - 1 && (
                <div
                  className="hidden md:block absolute top-3.5 h-0.5 bg-gray-200"
                  style={{ left: '50%', width: '100%' }}
                />
              )}
              {idx < stages.length - 1 && (
                <div className="md:hidden absolute left-3.5 top-8 bottom-0 w-0.5 bg-gray-200" />
              )}

              <div
                className={`relative z-10 w-7 h-7 rounded-full flex items-center justify-center ring-4 ${style.dot} ${style.ring} flex-shrink-0`}
                aria-label={style.label}
              >
                <Icon size={14} />
              </div>

              <div className="flex-1 md:text-center md:px-2 min-w-0">
                <p className="text-sm font-semibold text-gray-900 truncate">
                  {s.stage_name}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">{style.label}</p>
                {s.approval_type === 'ALL' && s.status === 'pending' && (
                  <p className="text-[10px] text-gray-400 inline-flex items-center gap-0.5 mt-0.5">
                    <Users size={10} /> All approvers
                  </p>
                )}
                {s.approvals.length > 0 && (
                  <div className="mt-1.5 space-y-1 md:text-left">
                    {s.approvals.map((a) => (
                      <div
                        key={a.id}
                        className="text-[11px] text-gray-600 border-l-2 border-gray-200 pl-2"
                      >
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="font-medium truncate">
                            {approverNames[a.approver_id] ?? 'Approver'}
                          </span>
                          <span
                            className={`text-[10px] uppercase ${
                              a.action === 'approved'
                                ? 'text-green-600'
                                : a.action === 'rejected'
                                  ? 'text-red-600'
                                  : 'text-orange-600'
                            }`}
                          >
                            {a.action.replace('_', ' ')}
                          </span>
                        </div>
                        <div className="text-[10px] text-gray-400">
                          {formatTimestamp(a.acted_at)}
                        </div>
                        {a.comment && (
                          <p className="text-[11px] text-gray-700 mt-0.5 italic">
                            &ldquo;{a.comment}&rdquo;
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
