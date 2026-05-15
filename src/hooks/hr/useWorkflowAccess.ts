/**
 * useWorkflowAccess — batches workflow-instance lookups for a set of
 * leave/loan requests so the approve/reject UI can show the right buttons
 * regardless of whether the request is being approved via the legacy
 * 3-stage path or the configurable workflow engine.
 *
 * For each request id, the hook tells you:
 *   - whether a workflow_instance exists (isEngine)
 *   - whether the current user can act on the instance's current stage
 *
 * Requests without an engine instance fall back to the legacy
 * canActOnStage() check at the call site.
 */

import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { isWorkflowTableMissingError, type WorkflowRequestType } from '@/lib/hr/workflowEngine';

export interface WorkflowAccessMap {
  /** ids of requests that have a workflow_instance (engine path active). */
  engineRequestIds: Set<string>;
  /** ids of requests where the current user can act on the engine stage. */
  actionableRequestIds: Set<string>;
}

interface InstanceRow {
  id: string;
  request_id: string;
  current_stage_id: string | null;
  status: string;
}

interface OwnerRow {
  stage_id: string;
  owner_type: 'role' | 'user';
  role_name: string | null;
  user_id: string | null;
}

const wfFrom = (table: string) => (supabase.from(table as never) as never) as {
  select: (sel: string) => any;
};

const EMPTY: WorkflowAccessMap = {
  engineRequestIds: new Set(),
  actionableRequestIds: new Set(),
};

export function useWorkflowAccess(
  requestType: WorkflowRequestType,
  requestIds: string[],
  userId: string | null,
): WorkflowAccessMap {
  const [map, setMap] = useState<WorkflowAccessMap>(EMPTY);
  const idsKey = requestIds.join(',');

  useEffect(() => {
    if (requestIds.length === 0) {
      setMap(EMPTY);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const { data: instances, error } = await wfFrom('workflow_instances')
          .select('id, request_id, current_stage_id, status')
          .eq('request_type', requestType)
          .in('request_id', requestIds);
        if (error) {
          if (isWorkflowTableMissingError(error)) {
            if (!cancelled) setMap(EMPTY);
            return;
          }
          if (!cancelled) setMap(EMPTY);
          return;
        }
        const rows = (instances ?? []) as InstanceRow[];
        const engineIds = new Set(rows.map((r) => r.request_id));
        if (!userId || rows.length === 0) {
          if (!cancelled) {
            setMap({
              engineRequestIds: engineIds,
              actionableRequestIds: new Set(),
            });
          }
          return;
        }

        // Resolve stage approvers for every distinct current_stage_id at the
        // pending instances. Two queries: workflow_stage_owners + user_roles.
        const pendingStageIds = Array.from(
          new Set(
            rows
              .filter((r) => r.status === 'pending' && r.current_stage_id)
              .map((r) => r.current_stage_id as string),
          ),
        );
        if (pendingStageIds.length === 0) {
          if (!cancelled) {
            setMap({
              engineRequestIds: engineIds,
              actionableRequestIds: new Set(),
            });
          }
          return;
        }
        const { data: owners } = await wfFrom('workflow_stage_owners')
          .select('stage_id, owner_type, role_name, user_id')
          .in('stage_id', pendingStageIds);
        const ownerRows = (owners ?? []) as OwnerRow[];

        const roleNames = Array.from(
          new Set(
            ownerRows
              .filter((o) => o.owner_type === 'role' && o.role_name)
              .map((o) => o.role_name as string),
          ),
        );

        // Resolve current user's role names from user_roles. We only need
        // to know if THIS user has any of the role_names referenced — one
        // small query.
        let userRoleSet = new Set<string>();
        if (roleNames.length > 0) {
          const { data: roleRows } = await supabase
            .from('user_roles')
            .select('role')
            .eq('user_id', userId);
          userRoleSet = new Set(
            ((roleRows ?? []) as Array<{ role: string }>).map((r) => r.role),
          );
        }

        // Build a stage_id → can-act-by-this-user map.
        const stageCanAct = new Map<string, boolean>();
        for (const stageId of pendingStageIds) {
          const stageOwners = ownerRows.filter((o) => o.stage_id === stageId);
          const userMatch = stageOwners.some(
            (o) => o.owner_type === 'user' && o.user_id === userId,
          );
          const roleMatch = stageOwners.some(
            (o) => o.owner_type === 'role' && o.role_name && userRoleSet.has(o.role_name),
          );
          stageCanAct.set(stageId, userMatch || roleMatch);
        }

        const actionable = new Set<string>();
        for (const r of rows) {
          if (r.status !== 'pending') continue;
          if (!r.current_stage_id) continue;
          if (stageCanAct.get(r.current_stage_id)) actionable.add(r.request_id);
        }

        if (!cancelled) {
          setMap({
            engineRequestIds: engineIds,
            actionableRequestIds: actionable,
          });
        }
      } catch (err) {
        if (isWorkflowTableMissingError(err)) {
          if (!cancelled) setMap(EMPTY);
          return;
        }
        if (!cancelled) setMap(EMPTY);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestType, userId, idsKey]);

  return map;
}
