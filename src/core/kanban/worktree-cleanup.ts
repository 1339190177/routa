/**
 * Worktree Cleanup Listener
 *
 * Listens for WORKTREE_CLEANUP events emitted when a completed task's
 * worktree should be removed. Cleans up the worktree directory, deletes
 * the branch, and clears the worktreeId reference on the task.
 */

import { AgentEvent, AgentEventType } from "../events/event-bus";
import { GitWorktreeService } from "../git/git-worktree-service";
import type { RoutaSystem } from "../routa-system";

const HANDLER_KEY = "kanban-worktree-cleanup";

export function startWorktreeCleanupListener(system: RoutaSystem): void {
  system.eventBus.on(HANDLER_KEY, async (event: AgentEvent) => {
    if (event.type !== AgentEventType.WORKTREE_CLEANUP) return;

    const { worktreeId, taskId, deleteBranch } = event.data as {
      worktreeId: string;
      taskId: string;
      boardId: string;
      deleteBranch: boolean;
    };

    try {
      const worktreeService = new GitWorktreeService(
        system.worktreeStore,
        system.codebaseStore,
      );
      await worktreeService.removeWorktree(worktreeId, { deleteBranch });

      const task = await system.taskStore.get(taskId);
      if (task && task.worktreeId === worktreeId) {
        task.worktreeId = undefined;
        task.updatedAt = new Date();
        await system.taskStore.save(task);
      }

      console.log(
        `[WorktreeCleanup] Cleaned up worktree ${worktreeId} for task ${taskId}.`,
      );
    } catch (err) {
      console.error(
        `[WorktreeCleanup] Failed to clean up worktree ${worktreeId}:`,
        err,
      );
    }
  });
}
