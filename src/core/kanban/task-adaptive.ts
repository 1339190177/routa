import type { TaskAdaptiveHarnessTaskType } from "@/core/harness/task-adaptive";
import type { TaskContextSearchSpec } from "@/core/models/task";

type TaskAdaptiveSource = {
  title: string;
  columnId?: string;
  assignedRole?: string;
  triggerSessionId?: string;
  sessionIds?: string[];
  laneSessions?: Array<{ sessionId: string }>;
  contextSearchSpec?: TaskContextSearchSpec;
};

export interface KanbanTaskAdaptiveHarnessOptions {
  taskLabel?: string;
  locale?: string;
  featureIds?: string[];
  filePaths?: string[];
  historySessionIds?: string[];
  taskType?: TaskAdaptiveHarnessTaskType;
  role?: string;
}

function uniqueNonEmptyStrings(values: Array<string | undefined | null>): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === "string" && value.trim().length > 0))];
}

function collectContextSearchFeatureIds(task: TaskAdaptiveSource | null | undefined): string[] | undefined {
  const featureIds = uniqueNonEmptyStrings(task?.contextSearchSpec?.featureCandidates ?? []);
  return featureIds.length > 0 ? featureIds : undefined;
}

function collectContextSearchFilePaths(task: TaskAdaptiveSource | null | undefined): string[] | undefined {
  const filePaths = uniqueNonEmptyStrings(task?.contextSearchSpec?.relatedFiles ?? []);
  return filePaths.length > 0 ? filePaths : undefined;
}

export function collectKanbanTaskHistorySessionIds(task: TaskAdaptiveSource | null | undefined): string[] | undefined {
  if (!task) {
    return undefined;
  }

  const historySessionIds = uniqueNonEmptyStrings([
    task.triggerSessionId,
    ...(task.sessionIds ?? []),
    ...((task.laneSessions ?? []).map((session) => session.sessionId)),
  ]);

  return historySessionIds.length > 0 ? historySessionIds : undefined;
}

export function resolveKanbanTaskAdaptiveTaskType(
  columnId: string | undefined,
): TaskAdaptiveHarnessTaskType {
  switch (columnId) {
    case "backlog":
    case "todo":
      return "planning";
    case "review":
      return "review";
    default:
      return "implementation";
  }
}

export function buildKanbanTaskAdaptiveHarnessOptions(
  promptLabel: string,
  options: {
    locale?: string;
    role?: string;
    taskType?: TaskAdaptiveHarnessTaskType;
    task?: TaskAdaptiveSource | null;
  },
): KanbanTaskAdaptiveHarnessOptions {
  return {
    taskLabel: options.task?.title ?? promptLabel.trim(),
    featureIds: collectContextSearchFeatureIds(options.task),
    filePaths: collectContextSearchFilePaths(options.task),
    historySessionIds: collectKanbanTaskHistorySessionIds(options.task),
    taskType: options.taskType ?? resolveKanbanTaskAdaptiveTaskType(options.task?.columnId),
    locale: options.locale,
    role: options.role ?? options.task?.assignedRole,
  };
}
