import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CodebaseData } from "@/client/hooks/use-workspaces";
import type { TaskInfo, WorktreeInfo } from "../../types";
import { KanbanCodebaseModal } from "../kanban-tab-modals";

const codebase: CodebaseData = {
  id: "codebase-1",
  workspaceId: "workspace-1",
  repoPath: "/tmp/repos/demo",
  branch: "main",
  label: "demo",
  isDefault: true,
  sourceType: "github",
  sourceUrl: "https://github.com/acme/demo",
  createdAt: "2025-01-01T00:00:00.000Z",
  updatedAt: "2025-01-01T00:00:00.000Z",
};

function createTask(id: string, title: string, overrides: Partial<TaskInfo> = {}): TaskInfo {
  return {
    id,
    title,
    objective: `${title} objective`,
    status: "PENDING",
    boardId: "board-1",
    columnId: "backlog",
    position: 0,
    createdAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function createWorktree(id: string, branch: string, createdAt: string, overrides: Partial<WorktreeInfo> = {}): WorktreeInfo {
  return {
    id,
    codebaseId: "codebase-1",
    workspaceId: "workspace-1",
    worktreePath: `/tmp/worktrees/${branch}`,
    branch,
    baseBranch: "main",
    status: "active",
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}

describe("KanbanCodebaseModal", () => {
  it("renders worktree timestamps and supports bulk delete selection", () => {
    const handleDeleteCodebaseWorktrees = vi.fn();

    render(
      <KanbanCodebaseModal
        selectedCodebase={codebase}
        editingCodebase={false}
        codebases={[codebase]}
        editRepoSelection={null}
        onRepoSelectionChange={vi.fn()}
        editError={null}
        recloneError={null}
        editSaving={false}
        replacingAll={false}
        setShowReplaceAllConfirm={vi.fn()}
        handleCancelEditCodebase={vi.fn()}
        codebaseWorktrees={[
          createWorktree("wt-older", "feature/older", "2025-01-01T00:00:00.000Z"),
          createWorktree("wt-newer", "feature/newer", "2025-01-02T00:00:00.000Z", { label: "newer-label" }),
        ]}
        worktreeActionError={null}
        localTasks={[createTask("task-1", "Story One", { worktreeId: "wt-newer" })]}
        handleDeleteCodebaseWorktrees={handleDeleteCodebaseWorktrees}
        deletingWorktreeIds={[]}
        liveBranchInfo={null}
        handleReclone={vi.fn()}
        recloning={false}
        recloneSuccess={null}
        onStartEditCodebase={vi.fn()}
        onRequestRemoveCodebase={vi.fn()}
        onClose={vi.fn()}
      />
    );

    const createdTimes = screen.getAllByText(/Created|创建于/);
    expect(createdTimes.length).toBe(2);
    expect(screen.getByText(/newer-label/)).toBeTruthy();

    const timeElements = screen.getAllByText((_, element) => element?.tagName.toLowerCase() === "time");
    expect(timeElements.some((element) => element.getAttribute("datetime") === "2025-01-02T00:00:00.000Z")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: /Select All|全选/ }));
    fireEvent.click(screen.getByRole("button", { name: /Remove selected|批量移除/ }));

    expect(handleDeleteCodebaseWorktrees).toHaveBeenCalledTimes(1);
    expect(handleDeleteCodebaseWorktrees.mock.calls[0][0]).toHaveLength(2);
    expect(handleDeleteCodebaseWorktrees.mock.calls[0][0].map((item: WorktreeInfo) => item.id)).toEqual([
      "wt-newer",
      "wt-older",
    ]);
  });
});
