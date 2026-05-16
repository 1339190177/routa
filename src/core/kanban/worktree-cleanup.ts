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
import { getServerBridge } from "../platform";
import { safeAtomicSave } from "./atomic-task-update";

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

    // Cache codebaseId before worktree record is removed
    let cachedCodebaseId: string | undefined;
    try {
      const existingWt = await system.worktreeStore.get(worktreeId);
      cachedCodebaseId = existingWt?.codebaseId;
    } catch { /* worktree may already be gone */ }

    try {
      const worktreeService = new GitWorktreeService(
        system.worktreeStore,
        system.codebaseStore,
      );
      await worktreeService.removeWorktree(worktreeId, { deleteBranch });

      console.log(
        `[WorktreeCleanup] Cleaned up worktree ${worktreeId} for task ${taskId}.`,
      );

      // Clean main checkout index to remove staged residue left by agents
      if (cachedCodebaseId) {
        try {
          const codebase = await system.codebaseStore.get(cachedCodebaseId);
          if (codebase?.repoPath) {
            const { exec } = getServerBridge().process;
            await exec("git reset HEAD", { cwd: codebase.repoPath, timeout: 5000 });
            await exec("git checkout -- .", { cwd: codebase.repoPath, timeout: 5000 });
            console.info(`[WorktreeCleanup] Cleaned main checkout index for ${codebase.repoPath}`);
          }
        } catch (idxErr) {
          // Non-critical: stale index doesn't break functionality
          console.warn(`[WorktreeCleanup] Main checkout index cleanup failed: ${idxErr}`);
        }
      }
    } catch (err) {
      console.error(
        `[WorktreeCleanup] Failed to clean up worktree ${worktreeId}:`,
        err,
      );

      // Remove stale DB record so it stops showing up in the UI
      try {
        await system.worktreeStore.remove(worktreeId);
      } catch { /* already gone */ }
    } finally {
      // Always clear task.worktreeId — if cleanup succeeded it's redundant,
      // if it failed the dangling reference causes endless 404s
      try {
        const task = await system.taskStore.get(taskId);
        if (task && task.worktreeId === worktreeId) {
          await safeAtomicSave(task, system.taskStore, {
            worktreeId: null,
            updatedAt: new Date(),
          }, "WorktreeCleanup");
        }
      } catch { /* task may be gone */ }
    }
  });
}
