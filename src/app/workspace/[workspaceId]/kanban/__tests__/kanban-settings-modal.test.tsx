import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { KanbanSettingsModal } from "../kanban-settings-modal";
import type { KanbanBoardInfo } from "../../types";

function clickWorkspaceTab(label: "Automation" | "Structure") {
  const tab = screen.getAllByRole("button").find((button) => button.textContent?.trim() === label);
  if (!tab) {
    throw new Error(`Missing workspace tab ${label}`);
  }
  fireEvent.click(tab);
}

const board: KanbanBoardInfo = {
  id: "board-1",
  workspaceId: "workspace-1",
  name: "Delivery Board",
  isDefault: true,
  sessionConcurrencyLimit: 2,
  devSessionSupervision: {
    mode: "watchdog_retry",
    inactivityTimeoutMinutes: 10,
    maxRecoveryAttempts: 1,
    completionRequirement: "turn_complete",
  },
  queue: {
    runningCount: 0,
    runningCards: [],
    queuedCount: 0,
    queuedCardIds: [],
    queuedCards: [],
    queuedPositions: {},
  },
  columns: [
    { id: "todo", name: "To Do", position: 0, stage: "backlog" },
    { id: "review", name: "Review", position: 1, stage: "review" },
  ],
  createdAt: "2025-01-01T00:00:00.000Z",
  updatedAt: "2025-01-01T00:00:00.000Z",
};

describe("KanbanSettingsModal", () => {
  it("applies recommended defaults and saves updated automation", async () => {
    const onSave = vi.fn(async () => {});
    const reviewBoard: KanbanBoardInfo = {
      ...board,
      columns: [board.columns[1]],
    };

    render(
      <KanbanSettingsModal
        board={reviewBoard}
        visibleColumns={["review"]}
        columnAutomation={{}}
        availableProviders={[{ id: "claude", name: "Claude Code", description: "Claude Code provider", command: "claude" }]}
        specialists={[{ id: "kanban-review-guard", name: "Review Guard", role: "GATE" }]}
        specialistLanguage="en"
        onClose={vi.fn()}
        onSave={onSave}
      />,
    );

    fireEvent.click(screen.getByRole("checkbox", { name: /toggle automation for review/i }));
    clickWorkspaceTab("Automation");
    fireEvent.click(screen.getByTestId("kanban-settings-provider"));
    fireEvent.click(screen.getByRole("button", { name: /claude code/i }));
    fireEvent.click(screen.getByRole("button", { name: /save board settings/i }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        ["review"],
        {
          review: expect.objectContaining({
            enabled: true,
            steps: [expect.objectContaining({
              providerId: "claude",
              role: "GATE",
            })],
            providerId: "claude",
            role: "GATE",
            transitionType: "exit",
            requiredArtifacts: ["screenshot", "test_results"],
          }),
        },
        2,
        {
          mode: "watchdog_retry",
          inactivityTimeoutMinutes: 10,
          maxRecoveryAttempts: 1,
          completionRequirement: "turn_complete",
        },
      );
    });
  });

  it("keeps runtime settings collapsed until requested", () => {
    render(
      <KanbanSettingsModal
        board={board}
        visibleColumns={["todo", "review"]}
        columnAutomation={{}}
        availableProviders={[{ id: "claude", name: "Claude Code", description: "Claude Code provider", command: "claude" }]}
        specialists={[{ id: "verify", name: "Verifier", role: "GATE" }]}
        specialistLanguage="en"
        onClose={vi.fn()}
        onSave={vi.fn(async () => {})}
      />,
    );

    expect(screen.queryByLabelText("Dev supervision mode")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /runtime/i }));
    expect(screen.getByLabelText("Dev supervision mode")).not.toBeNull();
  });

  it("defaults specialist filtering to kanban in board settings", () => {
    const reviewBoard: KanbanBoardInfo = {
      ...board,
      columns: [board.columns[1]],
    };

    render(
      <KanbanSettingsModal
        board={reviewBoard}
        visibleColumns={["review"]}
        columnAutomation={{ review: { enabled: true, steps: [{ id: "step-1", role: "GATE", specialistId: "kanban-review-guard" }] } }}
        availableProviders={[{ id: "claude", name: "Claude Code", description: "Claude Code provider", command: "claude" }]}
        specialists={[
          { id: "kanban-review-guard", name: "Review Guard", role: "GATE" },
          { id: "team-qa", name: "Team QA", role: "GATE" },
        ]}
        specialistLanguage="en"
        onClose={vi.fn()}
        onSave={vi.fn(async () => {})}
      />,
    );

    clickWorkspaceTab("Automation");
    expect(screen.getAllByRole("button").some((button) => button.textContent?.trim() === "Kanban")).toBe(true);
    expect(screen.getAllByRole("option", { name: "Review Guard" }).length).toBeGreaterThan(0);
    expect(screen.queryAllByRole("option", { name: "Team QA" })).toHaveLength(0);
  });

  it("treats blocked as a manual-only lane when saving", async () => {
    const onSave = vi.fn(async () => {});
    const blockedBoard: KanbanBoardInfo = {
      ...board,
      columns: [{ id: "blocked", name: "Blocked", position: 0, stage: "blocked" }],
    };

    render(
      <KanbanSettingsModal
        board={blockedBoard}
        visibleColumns={["blocked"]}
        columnAutomation={{ blocked: { enabled: true, steps: [{ id: "step-1", role: "ROUTA", providerId: "claude" }] } }}
        availableProviders={[{ id: "claude", name: "Claude Code", description: "Claude Code provider", command: "claude" }]}
        specialists={[]}
        specialistLanguage="en"
        onClose={vi.fn()}
        onSave={onSave}
      />,
    );

    expect(screen.getAllByRole("button").some((button) => button.textContent?.trim() === "Structure")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /save board settings/i }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        ["blocked"],
        {
          blocked: expect.objectContaining({ enabled: false }),
        },
        2,
        {
          mode: "watchdog_retry",
          inactivityTimeoutMinutes: 10,
          maxRecoveryAttempts: 1,
          completionRequirement: "turn_complete",
        },
      );
    });
  });
});
