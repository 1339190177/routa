"use client";

import { useMemo, useState } from "react";
import { CodeViewer } from "@/client/components/codemirror/code-viewer";
import { ArrowRight, ChevronRight, Filter, X } from "lucide-react";
import type { GitLabCIJob, GitLabCIPipeline, GitLabCIStage } from "@/client/hooks/use-harness-settings-data";

type JobKind = GitLabCIJob["kind"];

type HarnessGitLabCIPipelineGalleryProps = {
  pipeline: GitLabCIPipeline;
  variant?: "full" | "compact";
};

const JOB_KIND_STYLES: Record<JobKind, string> = {
  build: "border-slate-200 bg-white/90 text-slate-600",
  test: "border-emerald-200 bg-emerald-50 text-emerald-700",
  deploy: "border-violet-200 bg-violet-50 text-violet-700",
  security: "border-red-200 bg-red-50 text-red-700",
  review: "border-amber-200 bg-amber-50 text-amber-700",
};

const STAGE_COLORS = [
  "border-sky-200 bg-sky-50/60 text-sky-700",
  "border-emerald-200 bg-emerald-50/60 text-emerald-700",
  "border-violet-200 bg-violet-50/60 text-violet-700",
  "border-amber-200 bg-amber-50/60 text-amber-700",
  "border-red-200 bg-red-50/60 text-red-700",
  "border-slate-200 bg-slate-50/60 text-slate-700",
];

const ALL_KINDS: JobKind[] = ["build", "test", "deploy", "security", "review"];

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function stageColor(index: number) {
  return STAGE_COLORS[index % STAGE_COLORS.length];
}

function kindLabel(kind: JobKind): string {
  switch (kind) {
    case "build": return "Build";
    case "test": return "Test";
    case "deploy": return "Deploy";
    case "security": return "Security";
    case "review": return "Review";
  }
}

// --- Sub-components ---

function MetricCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="inline-flex items-center gap-1.5 rounded-sm border border-slate-200 bg-white/90 px-2.5 py-1 text-[10px]">
      <span className="font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</span>
      <span className="text-[12px] font-semibold text-slate-900">{value}</span>
    </div>
  );
}

function KindFilterBar({
  activeKinds,
  onToggle,
}: {
  activeKinds: Set<JobKind>;
  onToggle: (kind: JobKind) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <Filter className="h-3.5 w-3.5 text-slate-400" />
      {ALL_KINDS.map((kind) => {
        const active = activeKinds.has(kind);
        return (
          <button
            key={kind}
            type="button"
            onClick={() => onToggle(kind)}
            className={cx(
              "rounded-full border px-2.5 py-1 text-[10px] font-medium transition-colors",
              active
                ? JOB_KIND_STYLES[kind]
                : "border-slate-200 bg-white/80 text-slate-400 hover:text-slate-600",
            )}
          >
            {kindLabel(kind)}
          </button>
        );
      })}
    </div>
  );
}

function StageCard({
  stage,
  stageIndex,
  filteredJobs,
  selectedJobId,
  onJobSelect,
}: {
  stage: GitLabCIStage;
  stageIndex: number;
  filteredJobs: GitLabCIJob[];
  selectedJobId: string;
  onJobSelect: (jobId: string) => void;
}) {
  const color = stageColor(stageIndex);
  const displayJobs = filteredJobs.length > 0 ? filteredJobs : stage.jobs;

  return (
    <div className="overflow-hidden rounded-sm border border-slate-200/80 bg-white/95">
      <div className="flex items-center justify-between gap-3 px-3 py-2.5">
        <span className="flex items-center gap-2">
          <span className={cx("inline-flex h-6 w-6 items-center justify-center rounded-sm border text-[9px] font-bold", color)}>
            {stageIndex + 1}
          </span>
          <span className="min-w-0 truncate text-[12px] font-semibold text-slate-900">{stage.name}</span>
        </span>
        <span className="rounded-full border border-slate-200 bg-white/90 px-2 py-0.5 text-[10px] text-slate-600">
          {stage.jobs.length} job{stage.jobs.length !== 1 ? "s" : ""}
        </span>
      </div>
      <div className="border-t border-slate-200/80 px-3 py-2.5">
        {displayJobs.length > 0 ? (
          <div className="space-y-1.5">
            {displayJobs.map((job) => {
              const selected = selectedJobId === job.id;
              return (
                <button
                  key={job.id}
                  type="button"
                  onClick={() => onJobSelect(job.id)}
                  className={cx(
                    "w-full rounded-sm border px-2.5 py-2 text-left transition-all",
                    selected
                      ? "border-sky-300 bg-sky-50/80"
                      : "border-slate-200/80 bg-white/92 hover:border-slate-300",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[11px] font-semibold text-slate-900">{job.name}</div>
                      <div className="mt-0.5 text-[9px] font-mono text-slate-500">
                        {job.image ?? "default image"}
                      </div>
                    </div>
                    <span className={cx("shrink-0 rounded-full border px-1.5 py-0.5 text-[9px]", JOB_KIND_STYLES[job.kind])}>
                      {job.kind}
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {job.scriptCount > 0 ? (
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[9px] text-slate-500">
                        {job.scriptCount} scripts
                      </span>
                    ) : null}
                    {job.allowFailure ? (
                      <span className="rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[9px] text-amber-700">
                        allow failure
                      </span>
                    ) : null}
                    {job.when !== "on_success" ? (
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[9px] text-slate-500">
                        when:{job.when}
                      </span>
                    ) : null}
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="rounded-sm border border-dashed border-slate-200 bg-white/70 px-3 py-3 text-[10px] text-slate-400 italic">
            No matching jobs in this stage
          </div>
        )}
      </div>
    </div>
  );
}

function PipelineCanvas({
  pipeline,
  activeJobId,
  onJobSelect,
  compactMode,
}: {
  pipeline: GitLabCIPipeline;
  activeJobId: string;
  onJobSelect: (jobId: string) => void;
  compactMode: boolean;
}) {
  const activeStages = pipeline.stages.filter((s) => s.jobs.length > 0);

  return (
    <section className="rounded-sm border border-slate-200/80 bg-white/95 p-3.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">GitLab CI Pipeline</div>
          <h3 className="mt-1 text-[17px] font-semibold tracking-[-0.02em] text-slate-900">.gitlab-ci.yml</h3>
          {pipeline.defaultImage ? (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <span className="rounded-full border border-slate-200 bg-white/85 px-2.5 py-1 text-[10px] text-slate-600 font-mono">
                {pipeline.defaultImage}
              </span>
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2 text-[10px]">
          <span className="rounded-full border border-slate-200 bg-white/85 px-2.5 py-1 text-slate-600">
            {pipeline.totalJobs} jobs
          </span>
          <span className="rounded-full border border-slate-200 bg-white/85 px-2.5 py-1 text-slate-600">
            {pipeline.totalStages} stages
          </span>
        </div>
      </div>

      <div className="mt-3 overflow-x-auto pb-1">
        <div className="flex min-w-max items-start gap-3">
          <div className={cx(
            "shrink-0 rounded-sm border border-slate-200/80 bg-slate-50/70 p-3.5",
            compactMode ? "w-40" : "w-48",
          )}>
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Source</div>
            <div className="mt-2.5 rounded-sm border border-white/70 bg-white/90 px-2.5 py-1.5 text-[10px] font-medium text-slate-700 font-mono">
              .gitlab-ci.yml
            </div>
          </div>

          {activeStages.map((stage, stageIndex) => (
            <StageLane
              key={`stage:${stage.name}`}
              stage={stage}
              stageIndex={stageIndex}
              activeJobId={activeJobId}
              onJobSelect={onJobSelect}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function StageLane({
  stage,
  stageIndex,
  activeJobId,
  onJobSelect,
}: {
  stage: GitLabCIStage;
  stageIndex: number;
  activeJobId: string;
  onJobSelect: (jobId: string) => void;
}) {
  const color = stageColor(stageIndex);

  return (
    <div className="flex items-start gap-3">
      <div className="flex h-10 items-center text-slate-300">
        <ArrowRight className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} />
      </div>
      <div className="shrink-0 space-y-2.5 w-64">
        <div className={cx("pl-1 text-[10px] font-semibold uppercase tracking-[0.18em]", color.split(" ")[2] || "text-slate-500")}>
          {stage.name}
        </div>
        {stage.jobs.length > 0 ? stage.jobs.map((job) => {
          const selected = activeJobId === job.id;
          return (
            <button
              key={job.id}
              type="button"
              onClick={() => onJobSelect(job.id)}
              className={cx(
                "w-full rounded-sm border px-3 py-2.5 text-left transition-all",
                selected
                  ? "border-sky-300 bg-sky-50/80"
                  : "border-slate-200 bg-white/92 hover:border-slate-300",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[12px] font-semibold text-slate-900">{job.name}</div>
                  <div className="mt-0.5 text-[10px] font-mono text-slate-500">
                    {job.image ?? "default image"}
                  </div>
                </div>
                <span className={cx("rounded-full border px-2 py-0.5 text-[10px]", JOB_KIND_STYLES[job.kind])}>
                  {job.kind}
                </span>
              </div>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {job.scriptCount > 0 ? (
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] text-slate-500">
                    {job.scriptCount} scripts
                  </span>
                ) : null}
                {job.needs.length > 0 ? job.needs.map((need) => (
                  <span key={`${job.id}:${need}`} className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] text-slate-500">
                    {need}
                  </span>
                )) : (
                  <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] text-emerald-700">
                    root
                  </span>
                )}
                {job.tags.length > 0 ? job.tags.map((tag) => (
                  <span key={`${job.id}:tag:${tag}`} className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] text-slate-500">
                    {tag}
                  </span>
                )) : null}
              </div>
            </button>
          );
        }) : (
          <div className="rounded-sm border border-dashed border-slate-200 bg-white/70 px-3 py-3 text-[10px] text-slate-400 italic">
            No jobs in this stage
          </div>
        )}
      </div>
    </div>
  );
}

function JobInspector({
  pipeline,
  activeJob,
  compactMode,
}: {
  pipeline: GitLabCIPipeline;
  activeJob: GitLabCIJob | null;
  compactMode: boolean;
}) {
  return (
    <aside className="rounded-sm border border-slate-200/80 bg-white/95 p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Inspector</div>
          <h3 className="mt-1 text-[17px] font-semibold tracking-[-0.02em] text-slate-900">
            {activeJob?.name ?? "Pipeline"}
          </h3>
          <div className="mt-1 text-[11px] leading-5 text-slate-500">
            {activeJob
              ? "Selected job metadata, stage context, and dependency information."
              : "Pipeline-level overview and configuration."}
          </div>
        </div>
        <span className="rounded-full border border-slate-200 bg-white/85 px-2.5 py-1 text-[10px] text-slate-500">
          {activeJob ? "Job detail" : "Pipeline detail"}
        </span>
      </div>

      <div className="mt-3 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-1">
        <div className="rounded-sm border border-slate-200 bg-white/90 px-3 py-2.5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Stage</div>
          <div className="mt-2 text-[14px] font-semibold text-slate-900">{activeJob?.stage ?? "all"}</div>
        </div>
        <div className="rounded-sm border border-slate-200 bg-white/90 px-3 py-2.5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Image</div>
          <div className="mt-2 break-all font-mono text-[11px] text-slate-700">{activeJob?.image ?? pipeline.defaultImage ?? "none"}</div>
        </div>
        <div className="rounded-sm border border-slate-200 bg-white/90 px-3 py-2.5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Dependencies</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {activeJob?.needs.length ? activeJob.needs.map((need) => (
              <span key={`${activeJob.id}:${need}`} className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] text-slate-600">
                {need}
              </span>
            )) : (
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] text-emerald-700">
                root
              </span>
            )}
          </div>
        </div>
        <div className="rounded-sm border border-slate-200 bg-white/90 px-3 py-2.5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Scripts</div>
          <div className="mt-2 text-[14px] font-semibold text-slate-900">
            {activeJob?.scriptCount ?? 0}
          </div>
        </div>
      </div>

      {!compactMode ? (
        <details className="mt-3 rounded-sm border border-slate-200 bg-white/90 p-3">
          <summary className="cursor-pointer list-none text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
            Pipeline YAML
          </summary>
          <div className="mt-3">
            <CodeViewer
              code={pipeline.yaml}
              filename=".gitlab-ci.yml"
              language="yaml"
              maxHeight="320px"
              showHeader={false}
              wordWrap
            />
          </div>
        </details>
      ) : null}
    </aside>
  );
}

function PipelineDetailDialog({
  pipeline,
  activeJob,
  activeJobId,
  open,
  onClose,
  onJobSelect,
}: {
  pipeline: GitLabCIPipeline;
  activeJob: GitLabCIJob | null;
  activeJobId: string;
  open: boolean;
  onClose: () => void;
  onJobSelect: (jobId: string) => void;
}) {
  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close pipeline detail"
        className="absolute inset-0 bg-slate-950/28 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="GitLab CI pipeline detail"
        className="relative z-10 flex max-h-[88vh] w-full max-w-[1360px] flex-col overflow-hidden rounded-sm border border-slate-200/80 bg-white/98 shadow-[0_16px_48px_rgba(15,23,42,0.18)]"
      >
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200/80 px-4 py-3.5">
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Pipeline detail</div>
            <h3 className="mt-1 truncate text-[20px] font-semibold tracking-[-0.03em] text-slate-950">.gitlab-ci.yml</h3>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {pipeline.defaultImage ? (
                <span className="rounded-full border border-slate-200 bg-white/90 px-2.5 py-1 font-mono text-[10px] text-slate-500">
                  {pipeline.defaultImage}
                </span>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-slate-200 bg-white/90 px-2.5 py-1 text-[10px] text-slate-600">
              {pipeline.totalJobs} jobs
            </span>
            <span className="rounded-full border border-slate-200 bg-white/90 px-2.5 py-1 text-[10px] text-slate-600">
              {pipeline.totalStages} stages
            </span>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition-colors hover:border-slate-300 hover:text-slate-700"
            >
              <X className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}/>
            </button>
          </div>
        </div>

        <div className="overflow-auto px-4 py-4">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_340px]">
            <PipelineCanvas
              pipeline={pipeline}
              activeJobId={activeJobId}
              onJobSelect={onJobSelect}
              compactMode={false}
            />
            <JobInspector pipeline={pipeline} activeJob={activeJob} compactMode={false} />
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Main Gallery ---

export function HarnessGitLabCIPipelineGallery({
  pipeline,
  variant = "full",
}: HarnessGitLabCIPipelineGalleryProps) {
  const compactMode = variant === "compact";
  const [selectedJobId, setSelectedJobId] = useState(pipeline.jobs[0]?.id ?? "");
  const [activeKinds, setActiveKinds] = useState<Set<JobKind>>(new Set(ALL_KINDS));
  const [isDetailOpen, setIsDetailOpen] = useState(false);

  const activeJob = pipeline.jobs.find((j) => j.id === selectedJobId) ?? pipeline.jobs[0] ?? null;

  const kindCounts = useMemo(() => {
    const counts = new Map<JobKind, number>();
    for (const job of pipeline.jobs) {
      counts.set(job.kind, (counts.get(job.kind) ?? 0) + 1);
    }
    return counts;
  }, [pipeline.jobs]);

  function toggleKind(kind: JobKind) {
    setActiveKinds((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) {
        next.delete(kind);
      } else {
        next.add(kind);
      }
      return next;
    });
  }

  const filteredJobsByStage = useMemo(() => {
    const map = new Map<string, GitLabCIJob[]>();
    for (const stage of pipeline.stages) {
      const filtered = stage.jobs.filter((job) => activeKinds.has(job.kind));
      map.set(stage.name, filtered);
    }
    return map;
  }, [pipeline.stages, activeKinds]);

  const stagesWithFilteredJobs = pipeline.stages.filter((stage) => {
    const filtered = filteredJobsByStage.get(stage.name) ?? [];
    return filtered.length > 0;
  });

  return (
    <div className="space-y-3">
      {/* Metrics + Filter */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <MetricCard label="Stages" value={pipeline.totalStages} />
          <MetricCard label="Jobs" value={pipeline.totalJobs} />
          <MetricCard label="Image" value={pipeline.defaultImage ?? "none"} />
        </div>
        {!compactMode ? (
          <KindFilterBar activeKinds={activeKinds} onToggle={toggleKind} />
        ) : null}
      </div>

      {/* Card gallery view */}
      <div className={cx("grid gap-2", compactMode ? "grid-cols-1" : "xl:grid-cols-2")}>
        {stagesWithFilteredJobs.map((stage, stageIndex) => (
          <StageCard
            key={`card:${stage.name}`}
            stage={stage}
            stageIndex={stageIndex}
            filteredJobs={filteredJobsByStage.get(stage.name) ?? []}
            selectedJobId={selectedJobId}
            onJobSelect={(jobId) => {
              setSelectedJobId(jobId);
              setIsDetailOpen(true);
            }}
          />
        ))}
      </div>

      {stagesWithFilteredJobs.length === 0 ? (
        <div className="rounded-sm border border-dashed border-slate-200 bg-white/70 px-4 py-8 text-center text-[12px] text-slate-500">
          No jobs match the selected filter. Adjust filters to see more results.
        </div>
      ) : null}

      {/* Stage summary table */}
      <details className="rounded-sm border border-slate-200/80 bg-white/95">
        <summary className="cursor-pointer flex items-center gap-2 px-3 py-2.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50/80">
          <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
          Stage breakdown ({pipeline.stages.length})
        </summary>
        <div className="border-t border-slate-200/80 px-3 py-3">
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-slate-200/80">
                  <th className="py-2 pr-4 text-left font-semibold text-slate-500">Stage</th>
                  <th className="py-2 pr-4 text-left font-semibold text-slate-500">Jobs</th>
                  <th className="py-2 text-left font-semibold text-slate-500">Kinds</th>
                </tr>
              </thead>
              <tbody>
                {pipeline.stages.map((stage, index) => (
                  <tr key={stage.name} className="border-t border-slate-100/80">
                    <td className="py-2 pr-4">
                      <span className={cx("rounded-full border px-2 py-0.5 text-[10px] font-medium", stageColor(index))}>
                        {stage.name}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-slate-700">{stage.jobs.length}</td>
                    <td className="py-2">
                      <div className="flex flex-wrap gap-1">
                        {stage.jobs.length > 0
                          ? [...new Set(stage.jobs.map((j) => j.kind))].map((kind) => (
                            <span key={kind} className={cx("rounded-full border px-1.5 py-0.5 text-[9px]", JOB_KIND_STYLES[kind])}>
                              {kind}
                            </span>
                          ))
                          : <span className="text-slate-400 italic">empty</span>
                        }
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </details>

      {/* Detail dialog */}
      <PipelineDetailDialog
        pipeline={pipeline}
        activeJob={activeJob}
        activeJobId={activeJob?.id ?? ""}
        open={isDetailOpen}
        onClose={() => setIsDetailOpen(false)}
        onJobSelect={setSelectedJobId}
      />
    </div>
  );
}
