/**
 * Task Trigger Session — Unified stale detection for triggerSessionId.
 *
 * All stale-trigger checks should go through this module instead of
 * ad-hoc getSessionActivity calls. This ensures consistent semantics
 * across the lane scanner, restart recovery, watchdog, and enqueue paths.
 */

import { getHttpSessionStore } from "../acp/http-session-store";
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

  return undefined;
}

/**
 * Clear a stale triggerSessionId from a task.
 * Marks the associated lane session with an appropriate terminal status.
 * Mutates the task in place and saves to store.
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

  task.triggerSessionId = undefined;
  task.updatedAt = new Date();
  await taskStore.save(task);
  return true;
}
