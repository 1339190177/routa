import { describe, expect, it } from "vitest";

import {
  buildSessionAnalysisPrompt,
  sanitizeChangedFiles,
} from "../session-analysis";

describe("session-analysis", () => {
  it("filters noisy changed-file entries", () => {
    expect(sanitizeChangedFiles([
      "",
      "fatal: Unable to create '/tmp/repo/.git/index.lock': Operation not permitted",
      "index 2a57ee30..79132e49 100644",
      "crates/routa-server/src/api/kanban.rs",
      "src/app/workspace/[workspaceId]/feature-explorer/page.tsx",
    ])).toEqual([
      "crates/routa-server/src/api/kanban.rs",
      "src/app/workspace/[workspaceId]/feature-explorer/page.tsx",
    ]);
  });

  it("builds a localized analysis prompt with feature and session evidence", () => {
    const prompt = buildSessionAnalysisPrompt({
      locale: "zh",
      workspaceId: "default",
      repoName: "routa-js",
      repoPath: "/repo/default",
      branch: "main",
      featureDetail: {
        id: "kanban-workflow",
        name: "Kanban Workflow",
        group: "workspace",
        summary: "Kanban board workflow",
        status: "active",
        pages: [],
        apis: [],
        sourceFiles: ["crates/routa-server/src/api/kanban.rs"],
        relatedFeatures: [],
        domainObjects: [],
        sessionCount: 6,
        changedFiles: 1,
        updatedAt: "2026-04-17T08:00:00.000Z",
        fileTree: [],
      },
      selectedFilePaths: ["crates/routa-server/src/api/kanban.rs"],
      sessions: [
        {
          provider: "codex",
          sessionId: "019d-kanban-analysis",
          updatedAt: "2026-04-17T08:00:00.000Z",
          promptSnippet: "Trace why kanban.rs needed multiple follow-up passes",
          promptHistory: [
            "Trace why kanban.rs needed multiple follow-up passes",
            "Summarize what context should have been provided earlier",
          ],
          toolNames: ["exec_command", "apply_patch"],
          changedFiles: [
            "fatal: Unable to create '/tmp/repo/.git/index.lock': Operation not permitted",
            "crates/routa-server/src/api/kanban.rs",
          ],
          resumeCommand: "codex resume 019d-kanban-analysis",
        },
      ],
    });

    expect(prompt).toContain("Kanban Workflow");
    expect(prompt).toContain("crates/routa-server/src/api/kanban.rs");
    expect(prompt).toContain("019d-kanban-analysis");
    expect(prompt).toContain("~/.codex/sessions/**/019d-kanban-analysis*.jsonl");
    expect(prompt).toContain("可直接复用的提示词模板");
    expect(prompt).not.toContain("Operation not permitted");
  });
});
