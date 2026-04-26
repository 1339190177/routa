import type { GitHubIssueListItemInfo, GitHubPRListItemInfo, TaskInfo } from "../types";
import { desktopAwareFetch } from "@/client/utils/diagnostics";

export type VcsImportItem = GitHubIssueListItemInfo | GitHubPRListItemInfo;
/** @deprecated Use VcsImportItem instead */
export type GitHubImportItem = VcsImportItem;

function summarizeImportedBody(body?: string): string | null {
  if (!body) return null;
  const normalized = body.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  return normalized.length > 220 ? `${normalized.slice(0, 217)}...` : normalized;
}

export function buildMergedImportObjective(
  items: VcsImportItem[],
  labels: { heading: string; summary: string },
): string {
  const lines: string[] = [labels.heading];
  for (const item of items) {
    lines.push(`- #${item.number} ${item.title}`);
    lines.push(`  ${item.url}`);
    const summary = summarizeImportedBody(item.body);
    if (summary) {
      lines.push(`  ${labels.summary}: ${summary}`);
    }
    lines.push("");
  }
  return lines.join("\n").trim();
}

export function collectMergedImportLabels(items: VcsImportItem[]): string[] {
  return Array.from(new Set(items.flatMap((item) => item.labels)));
}

export async function createImportedTask(
  payload: Record<string, unknown>,
  fallbackMessage: string,
): Promise<TaskInfo> {
  const response = await desktopAwareFetch("/api/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof data?.error === "string" ? data.error : fallbackMessage);
  }
  return data.task as TaskInfo;
}

interface ImportVcsItemsOptions<TItem extends VcsImportItem> {
  workspaceId: string;
  boardId: string | null;
  codebaseId: string;
  items: TItem[];
  mergeAsSingleCard: boolean;
  mergedTitle: string;
  mergedObjectiveLabels: { heading: string; summary: string };
  mergeFallbackMessage: string;
  createItemPayload: (item: TItem) => Record<string, unknown>;
  createItemFallbackMessage: (item: TItem) => string;
}
/** @deprecated Use ImportVcsItemsOptions instead */
type ImportGitHubItemsOptions<TItem extends VcsImportItem> = ImportVcsItemsOptions<TItem>;

export async function importVcsItems<TItem extends VcsImportItem>(
  options: ImportVcsItemsOptions<TItem>,
): Promise<TaskInfo[]> {
  const {
    workspaceId,
    boardId,
    codebaseId,
    items,
    mergeAsSingleCard,
    mergedTitle,
    mergedObjectiveLabels,
    mergeFallbackMessage,
    createItemPayload,
    createItemFallbackMessage,
  } = options;

  if (mergeAsSingleCard) {
    return [await createImportedTask({
      workspaceId,
      boardId,
      columnId: "backlog",
      title: mergedTitle,
      objective: buildMergedImportObjective(items, mergedObjectiveLabels),
      labels: collectMergedImportLabels(items),
      codebaseIds: [codebaseId],
    }, mergeFallbackMessage)];
  }

  return Promise.all(items.map((item) =>
    createImportedTask(createItemPayload(item), createItemFallbackMessage(item))
  ));
}

/** @deprecated Use importVcsItems instead */
export const importGitHubItems = importVcsItems;
