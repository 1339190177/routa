/**
 * Task Split Orchestrator
 *
 * Core executor for splitting a parent kanban task into multiple sub-tasks
 * with dependency ordering, branch strategy inference, and conflict pre-check.
 *
 * All sub-tasks inherit the parent's codebaseIds and are created in backlog.
 * Dependency edges are resolved to real task IDs and bidirectional relations
 * are maintained automatically.
 */

import { createTask, type Task, type TaskPriority } from "../models/task";
import type { TaskStore } from "../store/task-store";
import type { KanbanBoardStore } from "../store/kanban-board-store";
import { updateDependencyRelations } from "./dependency-gate";
import {
  topologicalSort,
  detectFileConflicts,
  inferMergeStrategy,
  validateSplitPlan,
  type SubTaskDef,
  type DependencyEdge,
  type MergeStrategy,
} from "./task-split-topology";

// ─── Types ─────────────────────────────────────────────────────────────

export interface SplitPlan {
  parentTaskId: string;
  subTasks: SubTaskDef[];
  dependencyEdges: DependencyEdge[];
  mergeStrategy: MergeStrategy;
}

export interface SplitResult {
  parentTaskId: string;
  childTaskIds: string[];
  plan: SplitPlan;
  warnings: string[];
}

export interface ExecuteSplitDeps {
  taskStore: TaskStore;
  kanbanBoardStore?: KanbanBoardStore;
}

// ─── Splittable status check ───────────────────────────────────────────

const SPLITTABLE_STATUSES = new Set([
  "PENDING",
  "IN_PROGRESS",
]);

function isSplittableStatus(status: string): boolean {
  return SPLITTABLE_STATUSES.has(status);
}

// ─── Main entry point ──────────────────────────────────────────────────

/**
 * Execute a task split: create sub-tasks from a plan, wire dependencies.
 *
 * Steps:
 *  1. Validate parent task state
 *  2. Validate the split plan (refs, edges, cycles)
 *  3. Topological sort sub-tasks
 *  4. File conflict pre-check (warnings only)
 *  5. Create sub-tasks with proper parentTaskId, dependencies, codebaseIds
 *  6. Maintain bidirectional blocking relations
 *  7. Return result with child IDs and warnings
 */
export async function executeSplit(
  parentTask: Task,
  subTaskDefs: SubTaskDef[],
  dependencyEdges: DependencyEdge[],
  deps: ExecuteSplitDeps,
  options?: {
    mergeStrategy?: MergeStrategy;
    boardId?: string;
  },
): Promise<SplitResult> {
  // 1. Validate parent task
  if (!isSplittableStatus(parentTask.status)) {
    throw new Error(
      `[SplitOrchestrator] Task ${parentTask.id} is in status "${parentTask.status}" and cannot be split. ` +
      `Only PENDING or IN_PROGRESS tasks can be split.`,
    );
  }

  // 2. Validate split plan
  const planErrors = validateSplitPlan(subTaskDefs, dependencyEdges);
  if (planErrors.length > 0) {
    throw new Error(
      `[SplitOrchestrator] Invalid split plan:\n${planErrors.join("\n")}`,
    );
  }

  // 3. Topological sort
  const sorted = topologicalSort(subTaskDefs, dependencyEdges);

  // 4. File conflict pre-check
  const fileConflicts = detectFileConflicts(subTaskDefs);
  const warnings = fileConflicts.map(
    (c) => `File conflict: ${c.path} touched by [${c.taskRefs.join(", ")}]`,
  );

  // 5. Infer merge strategy if not provided
  const mergeStrategy = options?.mergeStrategy ?? inferMergeStrategy(subTaskDefs, dependencyEdges);

  // 6. Resolve the target column ID (backlog stage, not hardcoded "backlog")
  let targetColumnId = "backlog";
  if (deps.kanbanBoardStore) {
    const boardId = options?.boardId ?? parentTask.boardId;
    if (boardId) {
      const board = await deps.kanbanBoardStore.get(boardId);
      if (board) {
        const backlogCol = board.columns.find((c) => c.stage === "backlog");
        if (backlogCol) {
          targetColumnId = backlogCol.id;
        }
      }
    }
  }

  // 7. Create sub-tasks in topological order
  const refToId = new Map<string, string>();
  const childTaskIds: string[] = [];

  for (const subDef of sorted) {
    const taskId = crypto.randomUUID();
    refToId.set(subDef.ref, taskId);

    // Resolve dependency refs → actual task IDs (fail on unresolvable refs)
    const depIds: string[] = [];
    for (const [from, to] of dependencyEdges) {
      if (to !== subDef.ref) continue;
      const resolved = refToId.get(from);
      if (!resolved) {
        throw new Error(
          `[SplitOrchestrator] Cannot resolve dependency ref "${from}" for sub-task "${subDef.ref}". ` +
          `The dependency target was not created yet — check for invalid edges.`,
        );
      }
      depIds.push(resolved);
    }

    const task = createTask({
      id: taskId,
      title: subDef.title,
      objective: subDef.objective,
      workspaceId: parentTask.workspaceId,
      boardId: options?.boardId ?? parentTask.boardId,
      columnId: targetColumnId,
      parentTaskId: parentTask.id,
      // Do NOT set dependencies here — let updateDependencyRelations handle it
      // so that bidirectional blocking relations are correctly established.
      scope: subDef.scope,
      acceptanceCriteria: subDef.acceptanceCriteria,
      verificationCommands: subDef.verificationCommands,
      testCases: subDef.testCases,
      codebaseIds: parentTask.codebaseIds,
      labels: parentTask.labels,
      priority: parentTask.priority as TaskPriority | undefined,
    });

    await deps.taskStore.save(task);

    // Set dependencies via updateDependencyRelations so bidirectional blocking
    // relations are correctly established. This function expects the task to
    // have oldDeps=[] in the store, then adds the new deps and updates blocking.
    // Note: updateDependencyRelations does NOT set task.dependencies itself —
    // callers must do that explicitly.
    if (depIds.length > 0) {
      await updateDependencyRelations(taskId, depIds, deps.taskStore);
      // Re-read and set dependencies on the saved task
      const saved = await deps.taskStore.get(taskId);
      if (saved) {
        saved.dependencies = depIds;
        await deps.taskStore.save(saved);
      }
    }

    childTaskIds.push(taskId);
  }

  return {
    parentTaskId: parentTask.id,
    childTaskIds,
    plan: {
      parentTaskId: parentTask.id,
      subTasks: sorted,
      dependencyEdges,
      mergeStrategy,
    },
    warnings,
  };
}
