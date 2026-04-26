/**
 * Health Tick integration tests.
 */
import { describe, it, expect, vi } from "vitest";
import { runOverseerHealthTick } from "../health-tick";
import { createInMemoryOverseerStateStore } from "../overseer-state-store";
import { OverseerCircuitBreaker } from "../circuit-breaker";
import type { OverseerContext } from "../health-tick";

// We need a minimal mock of RoutaSystem
function createMockSystem() {
  const tasks: Array<Record<string, unknown>> = [];

  return {
    isPersistent: false,
    taskStore: {
      listTasks: vi.fn().mockResolvedValue(tasks),
      getTask: vi.fn().mockImplementation((id: string) => tasks.find((t) => t.id === id)),
      updateTask: vi.fn().mockResolvedValue(undefined),
    },
    conversationStore: {
      getMessages: vi.fn().mockResolvedValue([]),
    },
    worktreeStore: {
      getWorktree: vi.fn().mockResolvedValue(null),
    },
    eventBus: {
      emit: vi.fn(),
    },
  };
}

describe("runOverseerHealthTick", () => {
  it("should return empty result when no issues found", async () => {
    const store = createInMemoryOverseerStateStore();
    const cb = new OverseerCircuitBreaker(store);
    const ctx: OverseerContext = { stateStore: store, circuitBreaker: cb };
    const system = createMockSystem();

    const result = await runOverseerHealthTick(system as any, ctx);
    expect(result.examined).toBe(0);
    expect(result.autoFixed).toBe(0);
    expect(result.errors).toBe(0);
  });

  it("should skip tick when circuit breaker is open", async () => {
    const store = createInMemoryOverseerStateStore();
    const cb = new OverseerCircuitBreaker(store);
    // Open the breaker
    await cb.recordFailure("error 1");
    await cb.recordFailure("error 2");
    await cb.recordFailure("error 3");

    const ctx: OverseerContext = { stateStore: store, circuitBreaker: cb };
    const system = createMockSystem();

    const result = await runOverseerHealthTick(system as any, ctx);
    expect(result.examined).toBe(0);
  });

  it("should auto-fix stale trigger session", async () => {
    const store = createInMemoryOverseerStateStore();
    const cb = new OverseerCircuitBreaker(store);
    const ctx: OverseerContext = { stateStore: store, circuitBreaker: cb };

    const system = createMockSystem();
    const staleTime = new Date(Date.now() - 45 * 60 * 1000); // 45 minutes ago
    system.taskStore.listTasks.mockResolvedValue([
      {
        id: "task-stale",
        title: "Stale Task",
        workspaceId: "default",
        status: "PENDING",
        triggerSessionId: "old-session",
        updatedAt: staleTime,
        comment: "",
        comments: [],
        dependencies: [],
      },
    ]);

    const result = await runOverseerHealthTick(system as any, ctx);
    expect(result.examined).toBeGreaterThanOrEqual(1);
    expect(result.autoFixed).toBeGreaterThanOrEqual(1);
    expect(system.taskStore.updateTask).toHaveBeenCalledWith(
      "task-stale",
      expect.objectContaining({ triggerSessionId: undefined }),
    );
  });

  it("should clear orphan worktree reference", async () => {
    const store = createInMemoryOverseerStateStore();
    const cb = new OverseerCircuitBreaker(store);
    const ctx: OverseerContext = { stateStore: store, circuitBreaker: cb };

    const system = createMockSystem();
    system.taskStore.listTasks.mockResolvedValue([
      {
        id: "task-orphan",
        title: "Orphan WT",
        workspaceId: "default",
        status: "PENDING",
        worktreeId: "wt-deleted",
        updatedAt: new Date(),
        comment: "",
        comments: [],
        dependencies: [],
      },
    ]);

    const result = await runOverseerHealthTick(system as any, ctx);
    expect(result.autoFixed).toBeGreaterThanOrEqual(1);
    expect(system.taskStore.updateTask).toHaveBeenCalledWith(
      "task-orphan",
      expect.objectContaining({ worktreeId: undefined }),
    );
  });
});
