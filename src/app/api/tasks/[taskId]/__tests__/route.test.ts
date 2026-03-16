import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTask, TaskStatus, type Task } from "@/core/models/task";

const notify = vi.fn();
const removeCardJob = vi.fn();
const enqueueKanbanTaskSession = vi.fn();
const archiveActiveTaskSession = vi.fn();
const prepareTaskForColumnChange = vi.fn(() => false);
let capturedEnqueueTask: Task | undefined;

const taskStore = {
  get: vi.fn<(_: string) => Promise<Task | null>>(),
  save: vi.fn<(task: Task) => Promise<void>>(),
};

const system = {
  taskStore,
  kanbanBoardStore: { get: vi.fn() },
  workspaceStore: { get: vi.fn() },
  worktreeStore: { assignSession: vi.fn() },
  codebaseStore: { findByRepoPath: vi.fn(), get: vi.fn(), getDefault: vi.fn() },
  eventBus: {},
  artifactStore: undefined,
};

vi.mock("@/core/routa-system", () => ({
  getRoutaSystem: () => system,
}));

vi.mock("@/core/kanban/kanban-event-broadcaster", () => ({
  getKanbanEventBroadcaster: () => ({ notify }),
}));

vi.mock("@/core/kanban/task-board-context", () => ({
  ensureTaskBoardContext: vi.fn(async () => ({})),
}));

vi.mock("@/core/kanban/github-issues", () => ({
  updateGitHubIssue: vi.fn(),
}));

vi.mock("@/core/git/git-worktree-service", () => ({
  GitWorktreeService: vi.fn(),
}));

vi.mock("@/core/models/workspace", () => ({
  getDefaultWorkspaceWorktreeRoot: vi.fn(),
  getEffectiveWorkspaceMetadata: vi.fn(),
}));

vi.mock("@/core/kanban/column-transition", () => ({
  emitColumnTransition: vi.fn(),
}));

vi.mock("@/core/kanban/task-session-transition", () => ({
  archiveActiveTaskSession: (...args: unknown[]) => archiveActiveTaskSession(...args),
  prepareTaskForColumnChange: (...args: unknown[]) => prepareTaskForColumnChange(...args),
}));

vi.mock("@/core/kanban/workflow-orchestrator-singleton", () => ({
  enqueueKanbanTaskSession: (...args: unknown[]) => enqueueKanbanTaskSession(...args),
  getKanbanSessionQueue: () => ({ removeCardJob }),
}));

import { PATCH } from "../route";

describe("/api/tasks/[taskId] PATCH", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedEnqueueTask = undefined;
    taskStore.save.mockResolvedValue();
    taskStore.get.mockResolvedValue(createTask({
      id: "task-1",
      title: "Retry review",
      objective: "Retry review",
      workspaceId: "workspace-1",
      boardId: "board-1",
      columnId: "todo",
      status: TaskStatus.PENDING,
      triggerSessionId: "session-old",
      assignedProvider: "codex",
      assignedRole: "GATE",
      assignedSpecialistId: "pr-reviewer",
      assignedSpecialistName: "PR Reviewer",
    }));
    enqueueKanbanTaskSession.mockImplementation(async (_system, params: { task: Task }) => {
      capturedEnqueueTask = structuredClone(params.task);
      return {
        sessionId: "session-new",
        queued: false,
      };
    });
  });

  it("clears the active queue entry before rerunning a task trigger", async () => {
    const request = new NextRequest("http://localhost/api/tasks/task-1", {
      method: "PATCH",
      body: JSON.stringify({ retryTrigger: true }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await PATCH(request, {
      params: Promise.resolve({ taskId: "task-1" }),
    });
    const data = await response.json();

    expect(archiveActiveTaskSession).toHaveBeenCalledTimes(1);
    expect(removeCardJob).toHaveBeenCalledWith("task-1");
    expect(enqueueKanbanTaskSession).toHaveBeenCalledTimes(1);
    expect(enqueueKanbanTaskSession).toHaveBeenCalledWith(system, expect.objectContaining({
      expectedColumnId: "todo",
      ignoreExistingTrigger: true,
    }));
    expect(capturedEnqueueTask).toMatchObject({
      id: "task-1",
      triggerSessionId: undefined,
    });
    expect(taskStore.save).toHaveBeenCalledWith(expect.objectContaining({
      id: "task-1",
      triggerSessionId: "session-new",
    }));
    expect(data.task.triggerSessionId).toBe("session-new");
  });
});
