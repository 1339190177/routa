/**
 * Parent-Child Lifecycle
 *
 * Manages the lifecycle relationship between a parent task and its children.
 * Triggered when a child task's status changes, this module:
 *
 *  1. Checks whether all children are complete → auto-advance parent to review
 *  2. Detects child failures → marks parent with error context
 *  3. Clears parent error when children recover
 *
 * Integration points:
 *  - WorkflowOrchestrator.handleAgentCompletion
 *  - API PATCH /api/tasks/[taskId] (status updates)
 *  - pr-merge-listener.ts (PR_MERGED events)
 */

import { TaskStatus, type Task } from "../models/task";
import type { TaskStore } from "../store/task-store";
import type { KanbanBoardStore } from "../store/kanban-board-store";
import { AgentEventType, type EventBus } from "../events/event-bus";

// ─── Types ─────────────────────────────────────────────────────────────

export interface ParentLifecycleDeps {
  taskStore: TaskStore;
  kanbanBoardStore: KanbanBoardStore;
  eventBus: EventBus;
}

export interface ParentLifecycleResult {
  /** Whether the parent task was updated */
  parentUpdated: boolean;
  /** Action taken on the parent */
  action:
    | "none"
    | "all_children_completed"
    | "child_has_problem"
    | "problems_cleared";
}

// ─── Core logic ────────────────────────────────────────────────────────

/**
 * Called after a child task's status changes.
 * Evaluates the state of all siblings and updates the parent accordingly.
 */
export async function onChildTaskStatusChanged(
  childTask: Task,
  deps: ParentLifecycleDeps,
): Promise<ParentLifecycleResult> {
  if (!childTask.parentTaskId) {
    return { parentUpdated: false, action: "none" };
  }

  const parentTask = await deps.taskStore.get(childTask.parentTaskId);
  if (!parentTask) {
    return { parentUpdated: false, action: "none" };
  }

  const allChildren = await getChildTasks(parentTask, deps.taskStore);
  if (allChildren.length === 0) {
    return { parentUpdated: false, action: "none" };
  }

  // ── Rule 1: All children completed → advance parent to review ──
  const allCompleted = allChildren.every(
    (c) => c.status === TaskStatus.COMPLETED,
  );
  if (allCompleted) {
    return await advanceParentToReview(parentTask, deps);
  }

  // ── Rule 2: Any child has a problem → mark parent ──
  const problemChild = allChildren.find(
    (c) =>
      c.status === TaskStatus.NEEDS_FIX ||
      c.status === TaskStatus.BLOCKED ||
      c.status === TaskStatus.CANCELLED,
  );
  if (problemChild) {
    const existingError = parentTask.lastSyncError ?? "";
    const newError = `[Parent] Child "${problemChild.title}" is ${problemChild.status}`;

    if (!existingError.startsWith("[Parent]") || existingError !== newError) {
      parentTask.lastSyncError = newError;
      parentTask.updatedAt = new Date();
      await deps.taskStore.save(parentTask);
      return { parentUpdated: true, action: "child_has_problem" };
    }
    return { parentUpdated: false, action: "none" };
  }

  // ── Rule 3: Problems cleared → remove error ──
  if (parentTask.lastSyncError?.startsWith("[Parent]")) {
    parentTask.lastSyncError = undefined;
    parentTask.updatedAt = new Date();
    await deps.taskStore.save(parentTask);
    return { parentUpdated: true, action: "problems_cleared" };
  }

  return { parentUpdated: false, action: "none" };
}

/**
 * Advance a parent task to the review column after all children complete.
 * Emits a COLUMN_TRANSITION event so the workflow orchestrator picks it up.
 */
async function advanceParentToReview(
  parentTask: Task,
  deps: ParentLifecycleDeps,
): Promise<ParentLifecycleResult> {
  const board = parentTask.boardId
    ? await deps.kanbanBoardStore.get(parentTask.boardId)
    : undefined;

  // Find the review column; fall back to done if review doesn't exist
  const targetColumn =
    board?.columns.find((c) => c.stage === "review") ??
    board?.columns.find((c) => c.stage === "done");

  if (!targetColumn || !board) {
    // No target column — just clear any error and mark completed
    parentTask.lastSyncError = undefined;
    parentTask.status = TaskStatus.COMPLETED;
    parentTask.updatedAt = new Date();
    await deps.taskStore.save(parentTask);
    return { parentUpdated: true, action: "all_children_completed" };
  }

  const fromColumnId = parentTask.columnId ?? "backlog";
  const fromColumn = board.columns.find((c) => c.id === fromColumnId);

  parentTask.columnId = targetColumn.id;
  parentTask.status = TaskStatus.REVIEW_REQUIRED;
  parentTask.lastSyncError = undefined;
  parentTask.updatedAt = new Date();
  await deps.taskStore.save(parentTask);

  // Emit column transition so the orchestrator runs review-lane automation
  deps.eventBus.emit({
    type: AgentEventType.COLUMN_TRANSITION,
    agentId: "parent-child-lifecycle",
    workspaceId: parentTask.workspaceId,
    data: {
      cardId: parentTask.id,
      cardTitle: parentTask.title,
      boardId: board.id,
      workspaceId: parentTask.workspaceId,
      fromColumnId,
      toColumnId: targetColumn.id,
      fromColumnName: fromColumn?.name ?? fromColumnId,
      toColumnName: targetColumn.name,
    },
    timestamp: new Date(),
  });

  return { parentUpdated: true, action: "all_children_completed" };
}

// ─── Helpers ───────────────────────────────────────────────────────────

/**
 * Get all child tasks of a parent task in the same workspace.
 */
export async function getChildTasks(
  parent: Task,
  taskStore: TaskStore,
): Promise<Task[]> {
  const all = await taskStore.listByWorkspace(parent.workspaceId);
  return all.filter((t) => t.parentTaskId === parent.id);
}

/**
 * Compute parent progress summary (delegates to dependency-gate utility).
 */
export async function computeChildProgress(
  parentTask: Task,
  taskStore: TaskStore,
): Promise<{
  completed: number;
  total: number;
  label: string;
} | undefined> {
  const children = await getChildTasks(parentTask, taskStore);
  if (children.length === 0) return undefined;

  const completed = children.filter(
    (c) => c.status === TaskStatus.COMPLETED,
  ).length;
  return {
    completed,
    total: children.length,
    label: `${completed}/${children.length} sub-tasks completed`,
  };
}

/**
 * Cancel all incomplete children of a parent task.
 * Called when the parent task is cancelled.
 */
export async function cancelChildren(
  parentTask: Task,
  taskStore: TaskStore,
): Promise<number> {
  const children = await getChildTasks(parentTask, taskStore);
  let cancelled = 0;

  for (const child of children) {
    if (
      child.status !== TaskStatus.COMPLETED &&
      child.status !== TaskStatus.CANCELLED
    ) {
      child.status = TaskStatus.CANCELLED;
      child.updatedAt = new Date();
      await taskStore.save(child);
      cancelled++;
    }
  }

  return cancelled;
}
