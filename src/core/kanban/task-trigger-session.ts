/**
 * Task Trigger Session — Unified stale detection for triggerSessionId.
 *
 * All stale-trigger checks should go through this module instead of
 * ad-hoc getSessionActivity calls. This ensures consistent semantics
 * across the lane scanner, restart recovery, watchdog, and enqueue paths.
 */

import { getHttpSessionStore } from "../acp/http-session-store";
import { getAcpInstanceId } from "../acp/execution-backend";
import type { Task } from "../models/task";
import type { TaskStore } from "../store/task-store";
import { getTaskLaneSession, markTaskLaneSessionStatus } from "./task-lane-history";

/**
 * Check whether a triggerSessionId is stale (session terminated/evicted).
 * Returns the stale sessionId if stale, undefined if the session is still active.
 */
export function isTriggerSessionStale(
  triggerSessionId: string | undefined,
  sessionStore: ReturnType<typeof getHttpSessionStore>,
): string | undefined {
  if (!triggerSessionId) return undefined;

  const activity = sessionStore.getSessionActivity(triggerSessionId);
  if (!activity || activity.terminalState) {
    return triggerSessionId;
  }

  // Embedded sessions owned by a different instance are non-resumable
  // even if the lease hasn't expired yet.
  const session = sessionStore.getSession(triggerSessionId);
  if (session?.executionMode === "embedded") {
    const currentInstance = getAcpInstanceId();
    if (session.ownerInstanceId && session.ownerInstanceId !== currentInstance) {
      return triggerSessionId;
    }
  }

  return undefined;
}

/**
 * Clear a stale triggerSessionId from a task.
 * Marks the associated lane session with an appropriate terminal status.
 * Uses atomicUpdate with optimistic locking to prevent TOCTOU races.
 * Returns true if the task was modified.
 */
export async function clearStaleTriggerSession(
  task: Task,
  sessionStore: ReturnType<typeof getHttpSessionStore>,
  taskStore: TaskStore,
): Promise<boolean> {
  const staleId = isTriggerSessionStale(task.triggerSessionId, sessionStore);
  if (!staleId) return false;

  const laneEntry = getTaskLaneSession(task, staleId);
  if (laneEntry?.status === "running") {
    const terminalStatus = task.pullRequestUrl ? "completed" as const : "timed_out" as const;
    markTaskLaneSessionStatus(task, staleId, terminalStatus);
  }

  // Use atomicUpdate to prevent overwriting concurrent changes (e.g. column transition)
  if (task.version !== undefined && taskStore.atomicUpdate) {
    const ok = await taskStore.atomicUpdate(task.id, task.version, {
      triggerSessionId: undefined,
      laneSessions: task.laneSessions,
      updatedAt: new Date(),
    });
    if (!ok) {
      // Version conflict — re-read and retry once
      const fresh = await taskStore.get(task.id);
      if (!fresh || fresh.triggerSessionId !== staleId) return false;
      const freshLaneEntry = getTaskLaneSession(fresh, staleId);
      if (freshLaneEntry?.status === "running") {
        const terminalStatus = fresh.pullRequestUrl ? "completed" as const : "timed_out" as const;
        markTaskLaneSessionStatus(fresh, staleId, terminalStatus);
      }
      if (fresh.version !== undefined && taskStore.atomicUpdate) {
        const retryOk = await taskStore.atomicUpdate(fresh.id, fresh.version, {
          triggerSessionId: undefined,
          laneSessions: fresh.laneSessions,
          updatedAt: new Date(),
        });
        if (!retryOk) {
          console.warn(
            `[clearStaleTriggerSession] Second atomicUpdate failed for task ${task.id}. ` +
            `Will retry on next tick.`,
          );
          return false;
        }
      } else {
        fresh.triggerSessionId = undefined;
        fresh.updatedAt = new Date();
        await taskStore.save(fresh);
      }
    }
  } else {
    task.triggerSessionId = undefined;
    task.updatedAt = new Date();
    await taskStore.save(task);
  }
  return true;
}
