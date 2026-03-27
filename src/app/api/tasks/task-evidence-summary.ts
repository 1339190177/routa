import { resolveKanbanTransitionArtifacts } from "@/core/kanban/transition-artifacts";
import type { ArtifactType } from "@/core/models/artifact";
import type { Task } from "@/core/models/task";

interface ArtifactStoreLike {
  listByTask(taskId: string): Promise<Array<{ type: ArtifactType }>>;
}

interface KanbanBoardStoreLike {
  get(boardId: string): Promise<{
    columns?: Array<{
      id: string;
      automation?: {
        requiredArtifacts?: ArtifactType[];
      };
    }>;
  } | undefined | null>;
}

interface EvidenceSummarySystemLike {
  artifactStore?: ArtifactStoreLike;
  kanbanBoardStore?: KanbanBoardStoreLike;
}

export interface TaskArtifactSummary {
  total: number;
  byType: Partial<Record<ArtifactType, number>>;
}

export interface TaskEvidenceSummary {
  artifact: TaskArtifactSummary & {
    requiredSatisfied: boolean;
    missingRequired: ArtifactType[];
  };
  verification: {
    hasVerdict: boolean;
    verdict?: string;
    hasReport: boolean;
  };
  completion: {
    hasSummary: boolean;
  };
  runs: {
    total: number;
    latestStatus: string;
  };
}

function resolveTransitionRequiredArtifacts(task: Task, board: { columns?: Array<{
  id: string;
  automation?: {
    requiredArtifacts?: ArtifactType[];
  };
}> } | undefined): {
  requiredArtifacts: ArtifactType[];
} {
  const columns = board?.columns ?? [];
  const transitionArtifacts = resolveKanbanTransitionArtifacts(columns, task.columnId);

  return {
    requiredArtifacts: [...transitionArtifacts.nextRequiredArtifacts],
  };
}

export async function buildTaskArtifactSummary(
  task: Task,
  system: EvidenceSummarySystemLike,
): Promise<TaskArtifactSummary> {
  const artifacts = system.artifactStore
    ? await system.artifactStore.listByTask(task.id)
    : [];

  const byType: Partial<Record<ArtifactType, number>> = {};

  for (const artifact of artifacts) {
    byType[artifact.type] = (byType[artifact.type] ?? 0) + 1;
  }

  return {
    total: artifacts.length,
    byType,
  };
}

export async function buildTaskEvidenceSummary(
  task: Task,
  system: EvidenceSummarySystemLike,
): Promise<TaskEvidenceSummary> {
  const artifactSummary = await buildTaskArtifactSummary(task, system);
  let board: { columns?: Array<{ id: string; automation?: { requiredArtifacts?: ArtifactType[] } }> } | undefined;

  if (system.kanbanBoardStore && task.boardId) {
    board = (await system.kanbanBoardStore.get(task.boardId)) ?? undefined;
  }

  const { requiredArtifacts } = resolveTransitionRequiredArtifacts(task, board);
  const missingRequired = requiredArtifacts.filter((artifactType) =>
    (artifactSummary.byType[artifactType] ?? 0) === 0,
  );

  const latestStatus = task.laneSessions?.at(-1)?.status
    ?? (task.sessionIds?.length ? "unknown" : "idle");

  return {
    artifact: {
      ...artifactSummary,
      requiredSatisfied: missingRequired.length === 0,
      missingRequired,
    },
    verification: {
      hasVerdict: Boolean(task.verificationVerdict),
      verdict: task.verificationVerdict,
      hasReport: Boolean(task.verificationReport?.trim()),
    },
    completion: {
      hasSummary: Boolean(task.completionSummary?.trim()),
    },
    runs: {
      total: task.sessionIds?.length ?? 0,
      latestStatus,
    },
  };
}
