/**
 * Health Tick integration tests.
 */
import { describe, it, expect, vi } from "vitest";
import { runOverseerHealthTick } from "../health-tick";
import { createInMemoryOverseerStateStore } from "../overseer-state-store";
import { OverseerCircuitBreaker } from "../circuit-breaker";
import type { OverseerContext } from "../health-tick";

// Minimal mock of RoutaSystem with all stores the diagnostics collector needs
function createMockSystem(tasks: Array<Record<string, unknown>> = []) {
  return {
    isPersistent: false,
    workspaceStore: {
      list: vi.fn().mockResolvedValue([{ id: "default" }]),
    },
    taskStore: {
      listByWorkspace: vi.fn().mockResolvedValue(tasks),
      get: vi.fn().mockImplementation((id: string) => tasks.find((t) => t.id === id)),
      save: vi.fn().mockResolvedValue(undefined),
    },
    conversationStore: {
      getConversation: vi.fn().mockResolvedValue([]),
    },
    worktreeStore: {
      get: vi.fn().mockResolvedValue(null),
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
    const system = createMockSystem([]);

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
    const system = createMockSystem([]);

    const result = await runOverseerHealthTick(system as any, ctx);
    expect(result.examined).toBe(0);
  });

  it("should auto-fix stale trigger session", async () => {
    const store = createInMemoryOverseerStateStore();
    const cb = new OverseerCircuitBreaker(store);
    const ctx: OverseerContext = { stateStore: store, circuitBreaker: cb };

    const staleTime = new Date(Date.now() - 45 * 60 * 1000); // 45 minutes ago
    const tasks = [
      {
        id: "task-stale",
        title: "Stale Task",
        workspaceId: "default",
        status: "PENDING",
        triggerSessionId: "old-session",
        updatedAt: staleTime,
        comment: "",
        comments: [] as Array<{ id: string; body: string; createdAt: string }>,
        dependencies: [] as string[],
      },
    ];
    const system = createMockSystem(tasks);

    const result = await runOverseerHealthTick(system as any, ctx);
    expect(result.examined).toBeGreaterThanOrEqual(1);
    expect(result.autoFixed).toBeGreaterThanOrEqual(1);
    expect(system.taskStore.save).toHaveBeenCalled();
    // The saved task should have triggerSessionId cleared
    const savedTask = system.taskStore.save.mock.calls[0][0];
    expect(savedTask.triggerSessionId).toBeUndefined();
  });

  it("should clear orphan worktree reference", async () => {
    const store = createInMemoryOverseerStateStore();
    const cb = new OverseerCircuitBreaker(store);
    const ctx: OverseerContext = { stateStore: store, circuitBreaker: cb };

    const tasks = [
      {
        id: "task-orphan",
        title: "Orphan WT",
        workspaceId: "default",
        status: "PENDING",
        worktreeId: "wt-deleted",
        updatedAt: new Date(),
        comment: "",
        comments: [] as Array<{ id: string; body: string; createdAt: string }>,
        dependencies: [] as string[],
      },
    ];
    const system = createMockSystem(tasks);

    const result = await runOverseerHealthTick(system as any, ctx);
    expect(result.autoFixed).toBeGreaterThanOrEqual(1);
    const savedTask = system.taskStore.save.mock.calls[0][0];
    expect(savedTask.worktreeId).toBeUndefined();
  });
});
