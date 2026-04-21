import { describe, expect, it } from "vitest";
import { buildKanbanTaskAdaptiveHarnessOptions } from "../task-adaptive";

describe("buildKanbanTaskAdaptiveHarnessOptions", () => {
  it("forwards task context search spec into task-adaptive harness hints", () => {
    const options = buildKanbanTaskAdaptiveHarnessOptions("Fallback prompt", {
      locale: "en",
      role: "CRAFTER",
      task: {
        title: "Investigate JIT Context",
        columnId: "backlog",
        triggerSessionId: "session-1",
        contextSearchSpec: {
          featureCandidates: ["kanban-workflow", "session-recovery"],
          relatedFiles: [
            "src/app/workspace/[workspaceId]/kanban/kanban-card-detail.tsx",
            "src/app/workspace/[workspaceId]/kanban/kanban-detail-panels.tsx",
          ],
        },
      },
    });

    expect(options).toMatchObject({
      taskLabel: "Investigate JIT Context",
      taskType: "planning",
      locale: "en",
      role: "CRAFTER",
      historySessionIds: ["session-1"],
      featureIds: ["kanban-workflow", "session-recovery"],
      filePaths: [
        "src/app/workspace/[workspaceId]/kanban/kanban-card-detail.tsx",
        "src/app/workspace/[workspaceId]/kanban/kanban-detail-panels.tsx",
      ],
    });
  });
});
