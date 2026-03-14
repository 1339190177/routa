import { describe, expect, it } from "vitest";
import { createKanbanBoard } from "../../models/kanban";
import { InMemoryKanbanBoardStore } from "../../store/kanban-board-store";
import { InMemoryTaskStore } from "../../store/task-store";
import { KanbanTools } from "../kanban-tools";

describe("KanbanTools", () => {
  it("creates a card on the default board when boardId is omitted", async () => {
    const boardStore = new InMemoryKanbanBoardStore();
    const taskStore = new InMemoryTaskStore();
    const tools = new KanbanTools(boardStore, taskStore);

    const board = createKanbanBoard({
      id: "board-1",
      workspaceId: "default",
      name: "Default Board",
      isDefault: true,
    });
    await boardStore.save(board);

    const result = await tools.createCard({
      workspaceId: "default",
      title: "Created without board id",
      columnId: "backlog",
    });

    expect(result.success).toBe(true);
    const tasks = await taskStore.listByWorkspace("default");
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      title: "Created without board id",
      boardId: "board-1",
      columnId: "backlog",
    });
  });

  it("lists cards by column on the default board when boardId is omitted", async () => {
    const boardStore = new InMemoryKanbanBoardStore();
    const taskStore = new InMemoryTaskStore();
    const tools = new KanbanTools(boardStore, taskStore);

    const board = createKanbanBoard({
      id: "board-1",
      workspaceId: "default",
      name: "Default Board",
      isDefault: true,
    });
    await boardStore.save(board);

    await tools.createCard({
      workspaceId: "default",
      title: "Backlog card",
      columnId: "backlog",
    });

    const result = await tools.listCardsByColumn("backlog", undefined, "default");

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      columnId: "backlog",
      cards: [{ title: "Backlog card" }],
    });
  });
});
