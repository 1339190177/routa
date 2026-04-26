"use client";

import { useEffect, useState } from "react";
import { HarnessUnsupportedState } from "@/client/components/harness-support-state";
import { HarnessSectionCard, HarnessSectionStateFrame } from "@/client/components/harness-section-card";
import { HarnessGitLabCIPipelineGallery } from "@/client/components/harness-gitlab-ci-pipeline-gallery";
import { desktopAwareFetch } from "@/client/utils/diagnostics";
import { useTranslation } from "@/i18n";

// Re-export types from canonical source for backward compatibility
export type {
  GitLabCIJob,
  GitLabCIStage,
  GitLabCIPipeline,
  GitLabCIResponse,
} from "@/client/hooks/use-harness-settings-data";

import type {
  GitLabCIPipeline,
  GitLabCIResponse,
} from "@/client/hooks/use-harness-settings-data";

type PipelineState = {
  error: string | null;
  pipeline: GitLabCIPipeline | null;
  loadedContextKey: string;
};

type HarnessGitLabCIPipelinePanelProps = {
  workspaceId: string;
  codebaseId?: string;
  repoPath?: string;
  repoLabel: string;
  unsupportedMessage?: string | null;
  data?: GitLabCIResponse | null;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  variant?: "full" | "compact";
  hideHeader?: boolean;
};

// --- Main panel (orchestration shell) ---

export function HarnessGitLabCIPipelinePanel({
  workspaceId,
  codebaseId,
  repoPath,
  repoLabel: _repoLabel,
  unsupportedMessage,
  data,
  loading,
  error,
  onRetry,
  variant = "full",
  hideHeader = false,
}: HarnessGitLabCIPipelinePanelProps) {
  const { t } = useTranslation();
  const hasExternalState = loading !== undefined || error !== undefined || data !== undefined;
  const hasContext = Boolean(workspaceId && repoPath);
  const contextKey = hasContext ? `${workspaceId}:${codebaseId ?? "repo-only"}:${repoPath}` : "";

  const [pipelineState, setPipelineState] = useState<PipelineState>({
    error: null,
    pipeline: null,
    loadedContextKey: "",
  });

  useEffect(() => {
    if (hasExternalState || !hasContext) return;

    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;

      const query = new URLSearchParams();
      query.set("workspaceId", workspaceId);
      if (codebaseId) query.set("codebaseId", codebaseId);
      if (repoPath) query.set("repoPath", repoPath);

      void desktopAwareFetch(`/api/harness/gitlab-ci?${query.toString()}`)
        .then(async (response) => {
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) {
            throw new Error(typeof payload?.details === "string" ? payload.details : "Failed to load GitLab CI config");
          }
          if (cancelled) return;
          setPipelineState({
            error: null,
            pipeline: (payload?.pipeline as GitLabCIPipeline) ?? null,
            loadedContextKey: contextKey,
          });
        })
        .catch((fetchError: unknown) => {
          if (cancelled) return;
          setPipelineState({
            error: fetchError instanceof Error ? fetchError.message : String(fetchError),
            pipeline: null,
            loadedContextKey: contextKey,
          });
        });
    }, 280);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [codebaseId, contextKey, hasContext, hasExternalState, repoPath, workspaceId]);

  const resolvedState = hasExternalState
    ? { error: error ?? null, pipeline: data?.pipeline ?? null, loadedContextKey: contextKey }
    : pipelineState;

  const pipeline = resolvedState.pipeline;
  const isLoading = hasExternalState
    ? Boolean(loading)
    : (hasContext && resolvedState.loadedContextKey !== contextKey && !resolvedState.error);

  const summary = isLoading
    ? t.harness.githubActions.loading
    : unsupportedMessage
      ? t.harness.githubActions.unsupported
      : resolvedState.error
        ? t.harness.githubActions.fetchError
        : !hasContext
          ? t.harness.githubActions.noRepo
          : !pipeline
            ? "No .gitlab-ci.yml"
            : `${pipeline.totalJobs} jobs / ${pipeline.totalStages} stages`;

  const stateBadge = (
    <span className="text-[10px] text-desktop-text-secondary">{summary}</span>
  );

  if (isLoading) {
    return (
      <HarnessSectionCard
        title={t.settings.harness.ciCd}
        hideHeader={hideHeader}
        description={`GitLab CI/CD pipeline visualization for ${_repoLabel}`}
        actions={stateBadge}
        variant={variant}
      >
        <HarnessSectionStateFrame>{t.harness.githubActions.loadingWorkflows}</HarnessSectionStateFrame>
      </HarnessSectionCard>
    );
  }

  if (unsupportedMessage) {
    return (
      <HarnessSectionCard
        title={t.settings.harness.ciCd}
        hideHeader={hideHeader}
        description={`GitLab CI/CD pipeline visualization for ${_repoLabel}`}
        actions={stateBadge}
        variant={variant}
      >
        <HarnessUnsupportedState className="rounded-sm border border-amber-200 bg-amber-50 px-4 py-4 text-[11px] text-amber-800" />
      </HarnessSectionCard>
    );
  }

  if (resolvedState.error) {
    return (
      <HarnessSectionCard
        title={t.settings.harness.ciCd}
        hideHeader={hideHeader}
        description={`GitLab CI/CD pipeline visualization for ${_repoLabel}`}
        actions={stateBadge}
        variant={variant}
      >
        <HarnessSectionStateFrame tone="error">
          <div className="flex items-center justify-between gap-3">
            <span>{resolvedState.error}</span>
            {onRetry ? (
              <button
                type="button"
                className="desktop-btn desktop-btn-secondary shrink-0 text-[10px]"
                onClick={onRetry}
              >
                {t.settings.harness.gitlabCi?.retry ?? "Retry"}
              </button>
            ) : null}
          </div>
        </HarnessSectionStateFrame>
      </HarnessSectionCard>
    );
  }

  if (!pipeline) {
    return (
      <HarnessSectionCard
        title={t.settings.harness.ciCd}
        hideHeader={hideHeader}
        description={`GitLab CI/CD pipeline visualization for ${_repoLabel}`}
        actions={stateBadge}
        variant={variant}
      >
        <HarnessSectionStateFrame>
          No .gitlab-ci.yml found in repository root.
        </HarnessSectionStateFrame>
      </HarnessSectionCard>
    );
  }

  return (
    <HarnessSectionCard
      title={t.settings.harness.ciCd}
      hideHeader={hideHeader}
      description={`GitLab CI/CD pipeline visualization for ${_repoLabel}`}
      actions={stateBadge}
      variant={variant}
    >
      <HarnessGitLabCIPipelineGallery pipeline={pipeline} variant={variant} />
    </HarnessSectionCard>
  );
}
