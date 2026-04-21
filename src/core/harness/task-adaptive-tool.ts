import {
  normalizeContextValue,
  resolveRepoRoot,
  type HarnessContext,
} from "@/core/harness/context-resolution";
import {
  assembleTaskAdaptiveHarness,
  parseTaskAdaptiveHarnessOptions,
  summarizeFileSessionContext,
  type FileSessionContextSummary,
  type TaskAdaptiveHistorySummary,
  type TaskAdaptiveHarnessPack,
} from "@/core/harness/task-adaptive";
import {
  inspectTranscriptTurns,
  type TranscriptTurnInspectionResult,
} from "@/core/harness/transcript-sessions";

export const TASK_ADAPTIVE_HARNESS_TOOL_NAME = "assemble_task_adaptive_harness";
export const TASK_HISTORY_SUMMARY_TOOL_NAME = "summarize_task_history_context";
export const FILE_SESSION_CONTEXT_TOOL_NAME = "summarize_file_session_context";
export const TRANSCRIPT_TURN_INSPECTION_TOOL_NAME = "inspect_transcript_turns";

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);

  return normalized.length > 0 ? [...new Set(normalized)] : undefined;
}

function normalizePositiveInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }

  const normalized = Math.trunc(value);
  return normalized > 0 ? normalized : undefined;
}

export async function assembleTaskAdaptiveHarnessFromToolArgs(
  args: Record<string, unknown>,
  fallbackWorkspaceId?: string,
): Promise<TaskAdaptiveHarnessPack> {
  const context: HarnessContext = {
    workspaceId: normalizeContextValue(args.workspaceId) ?? fallbackWorkspaceId,
    codebaseId: normalizeContextValue(args.codebaseId),
    repoPath: normalizeContextValue(args.repoPath),
  };
  const repoRoot = await resolveRepoRoot(context);
  const options = parseTaskAdaptiveHarnessOptions(args) ?? {};
  return assembleTaskAdaptiveHarness(repoRoot, options);
}

export async function summarizeTaskHistoryContextFromToolArgs(
  args: Record<string, unknown>,
  fallbackWorkspaceId?: string,
): Promise<{
  historySummary: TaskAdaptiveHistorySummary | null;
  featureId?: string;
  featureName?: string;
  selectedFiles: string[];
  matchedFileDetails: TaskAdaptiveHarnessPack["matchedFileDetails"];
  matchedSessionIds: string[];
  warnings: string[];
}> {
  const pack = await assembleTaskAdaptiveHarnessFromToolArgs(args, fallbackWorkspaceId);
  return {
    historySummary: pack.historySummary ?? null,
    featureId: pack.featureId,
    featureName: pack.featureName,
    selectedFiles: [...pack.selectedFiles],
    matchedFileDetails: pack.matchedFileDetails.map((detail) => ({ ...detail })),
    matchedSessionIds: [...pack.matchedSessionIds],
    warnings: [...pack.warnings],
  };
}

export async function summarizeFileSessionContextFromToolArgs(
  args: Record<string, unknown>,
  fallbackWorkspaceId?: string,
): Promise<FileSessionContextSummary> {
  const context: HarnessContext = {
    workspaceId: normalizeContextValue(args.workspaceId) ?? fallbackWorkspaceId,
    codebaseId: normalizeContextValue(args.codebaseId),
    repoPath: normalizeContextValue(args.repoPath),
  };
  const repoRoot = await resolveRepoRoot(context);
  const options = parseTaskAdaptiveHarnessOptions(args) ?? {};
  return summarizeFileSessionContext(repoRoot, options);
}

export async function inspectTranscriptTurnsFromToolArgs(
  args: Record<string, unknown>,
  fallbackWorkspaceId?: string,
): Promise<TranscriptTurnInspectionResult> {
  const context: HarnessContext = {
    workspaceId: normalizeContextValue(args.workspaceId) ?? fallbackWorkspaceId,
    codebaseId: normalizeContextValue(args.codebaseId),
    repoPath: normalizeContextValue(args.repoPath),
  };
  const repoRoot = await resolveRepoRoot(context);
  const options = parseTaskAdaptiveHarnessOptions(args) ?? {};
  const sessionIds = normalizeStringArray(args.sessionIds)
    ?? normalizeStringArray(args.historySessionIds)
    ?? options.historySessionIds
    ?? [];

  if (sessionIds.length === 0) {
    throw new Error("inspect_transcript_turns requires sessionIds or historySessionIds.");
  }

  return inspectTranscriptTurns(repoRoot, {
    sessionIds,
    filePaths: options.filePaths,
    featureId: options.featureId,
    maxUserPrompts: normalizePositiveInteger(args.maxUserPrompts),
    maxSignals: normalizePositiveInteger(args.maxSignals),
  });
}
