import { runCommand } from "./process.js";
import path from "node:path";
import {
  runReviewTriggerSpecialist,
  type ReviewReportPayload,
  type ReviewTrigger,
} from "./specialist-review.js";

const REVIEW_UNAVAILABLE_BYPASS_ENV = "ROUTA_ALLOW_REVIEW_UNAVAILABLE";

type ReviewReport = ReviewReportPayload;

export type ReviewPhaseResult = {
  base: string;
  allowed: boolean;
  bypassed: boolean;
  status: "passed" | "blocked" | "unavailable" | "error";
  triggers: ReviewTrigger[];
  changedFiles?: string[];
  committedFiles?: string[];
  workingTreeFiles?: string[];
  untrackedFiles?: string[];
  diffFileCount?: number;
  message: string;
};

function emptyReport(): ReviewReport {
  return {
    triggers: [],
    changed_files: [],
    committed_files: [],
    working_tree_files: [],
    untracked_files: [],
    diff_stats: { file_count: 0 },
  };
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function parseNameOnlyOutput(output: string): string[] {
  const seen = new Set<string>();
  const files: string[] = [];
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    files.push(trimmed);
  }
  return files;
}

async function resolveReviewBase(): Promise<string> {
  const upstream = await runCommand("git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}'", {
    stream: false,
  });
  return upstream.exitCode === 0 ? upstream.output.trim() : "HEAD~1";
}

async function resolveReviewGitRoot(): Promise<string | null> {
  const root = await runCommand("git rev-parse --show-toplevel", {
    stream: false,
  });

  if (root.exitCode !== 0) {
    return null;
  }

  const trimmed = root.output.trim();
  return trimmed ? path.resolve(trimmed) : null;
}

async function collectReviewScopeFiles(
  root: string,
  base: string,
): Promise<{ committedFiles: string[]; workingTreeFiles: string[]; untrackedFiles: string[] }> {
  const [committed, workingTree, untracked] = await Promise.all([
    runCommand(`git diff --name-only --diff-filter=ACMR ${shellQuote(`${base}...HEAD`)}`, {
      cwd: root,
      stream: false,
    }),
    runCommand("git diff --name-only --diff-filter=ACMR", {
      cwd: root,
      stream: false,
    }),
    runCommand("git ls-files --others --exclude-standard", {
      cwd: root,
      stream: false,
    }),
  ]);

  return {
    committedFiles: parseNameOnlyOutput(committed.output),
    workingTreeFiles: parseNameOnlyOutput(workingTree.output),
    untrackedFiles: parseNameOnlyOutput(untracked.output),
  };
}

function getReviewScopeMismatchMessage(rootPath: string): string {
  return `Review scope mismatch: hook-runtime expected to run in repository root "${rootPath}", but current directory is "${path.resolve(process.cwd())}".` +
    ` Set ${REVIEW_UNAVAILABLE_BYPASS_ENV}=1 only if you intentionally want to proceed with potentially shifted scope.`;
}

function parseReport(reviewOutput: string): ReviewReport {
  if (!reviewOutput) {
    return emptyReport();
  }

  try {
    const report = JSON.parse(reviewOutput) as ReviewReport;
    return {
      ...emptyReport(),
      ...report,
      committed_files: report.committed_files ?? report.changed_files ?? [],
    };
  } catch {
    return emptyReport();
  }
}

function printReviewReport(report: ReviewReport): void {
  const committedFiles = report.committed_files ?? report.changed_files ?? [];
  console.log("Human review required for pushed commits:");
  console.log(`- Base: ${report.base ?? "unknown"}`);
  console.log(`- Review scope files: ${committedFiles.length}`);
  for (const trigger of report.triggers ?? []) {
    console.log(`- [${trigger.severity}] ${trigger.name}`);
    for (const reason of trigger.reasons ?? []) {
      console.log(`  - ${reason}`);
    }
  }
  const workingTreeFiles = report.working_tree_files ?? [];
  const untrackedFiles = report.untracked_files ?? [];
  if (workingTreeFiles.length > 0 || untrackedFiles.length > 0) {
    console.log("");
    console.log("Local workspace residue not included in push decision:");
    if (workingTreeFiles.length > 0) {
      console.log(`- tracked but uncommitted: ${workingTreeFiles.length}`);
    }
    if (untrackedFiles.length > 0) {
      console.log(`- untracked: ${untrackedFiles.length}`);
    }
  }
  console.log("");
}

function buildResultBase(
  base: string,
  report: ReviewReport,
  status: ReviewPhaseResult["status"],
  allowed: boolean,
  bypassed: boolean,
  message: string,
): ReviewPhaseResult {
  return {
    allowed,
    bypassed,
    base,
    status,
    triggers: report.triggers ?? [],
    changedFiles: report.committed_files ?? report.changed_files,
    committedFiles: report.committed_files ?? report.changed_files,
    workingTreeFiles: report.working_tree_files,
    untrackedFiles: report.untracked_files,
    diffFileCount: report.diff_stats?.file_count,
    message,
  };
}

async function parseDecision(
  report: ReviewReport,
  base: string,
  reviewRoot: string,
  outputMode: "human" | "jsonl",
): Promise<ReviewPhaseResult> {
  if (process.env.ROUTA_ALLOW_REVIEW_TRIGGER_PUSH === "1") {
    const message = "ROUTA_ALLOW_REVIEW_TRIGGER_PUSH=1 set, bypassing review gate.";
    if (outputMode === "human") {
      console.log(message);
      console.log("");
    }
    return buildResultBase(base, report, "passed", true, true, message);
  }

  try {
    const decision = await runReviewTriggerSpecialist({
      reviewRoot,
      base,
      report,
    });
    const message = decision.summary;
    if (outputMode === "human") {
      console.log(message);
      if (decision.findings.length > 0) {
        for (const finding of decision.findings) {
          const severity = finding.severity?.toUpperCase() ?? "INFO";
          const title = finding.title?.trim() || "Unnamed finding";
          const reason = finding.reason?.trim();
          const location = finding.location?.trim();
          console.log(`- [${severity}] ${title}${location ? ` (${location})` : ""}`);
          if (reason) {
            console.log(`  ${reason}`);
          }
        }
      }
      console.log("");
    }
    return buildResultBase(
      base,
      report,
      decision.allowed ? "passed" : "blocked",
      decision.allowed,
      false,
      message,
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (shouldBypassUnavailableReviewGate()) {
      const message = `${REVIEW_UNAVAILABLE_BYPASS_ENV}=1 set, bypassing automatic specialist review failure. ${detail}`;
      if (outputMode === "human") {
        console.log(message);
        console.log("");
      }
      return buildResultBase(base, report, "unavailable", true, true, message);
    }

    const message =
      `Automatic review specialist failed, so the push is blocked. ${detail} ` +
      `Fix the review environment and rerun, or set ${REVIEW_UNAVAILABLE_BYPASS_ENV}=1 to bypass intentionally.`;
    return buildResultBase(base, report, "unavailable", false, false, message);
  }
}

function shouldBypassUnavailableReviewGate(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[REVIEW_UNAVAILABLE_BYPASS_ENV] === "1";
}

export async function runReviewTriggerPhase(outputMode: "human" | "jsonl" = "human"): Promise<ReviewPhaseResult> {
  const reviewBase = await resolveReviewBase();
  const reviewRoot = await resolveReviewGitRoot();

  if (reviewRoot && reviewRoot !== path.resolve(process.cwd())) {
    const message = getReviewScopeMismatchMessage(reviewRoot);
    if (shouldBypassUnavailableReviewGate()) {
      if (outputMode === "human") {
        console.log(message);
        console.log("");
      }
      return buildResultBase(reviewBase, emptyReport(), "unavailable", true, true, message);
    }

    return buildResultBase(reviewBase, emptyReport(), "unavailable", false, false, message);
  }

  if (!reviewRoot) {
    const message =
      `No git repository root found from current directory (${path.resolve(process.cwd())}). ` +
      `Review phase requires git context and is blocked by default. Set ${REVIEW_UNAVAILABLE_BYPASS_ENV}=1 to bypass intentionally.`;

    if (shouldBypassUnavailableReviewGate()) {
      if (outputMode === "human") {
        console.log(message);
        console.log("");
      }
      return buildResultBase(reviewBase, emptyReport(), "unavailable", true, true, message);
    }

    return buildResultBase(reviewBase, emptyReport(), "unavailable", false, false, message);
  }

  if (outputMode === "human") {
    console.log(`[review] Base: ${reviewBase}`);
    console.log("");
  }

  const scopeFiles = await collectReviewScopeFiles(reviewRoot, reviewBase);
  if (scopeFiles.committedFiles.length === 0) {
    const report = {
      ...emptyReport(),
      base: reviewBase,
      committed_files: [],
      changed_files: [],
      working_tree_files: scopeFiles.workingTreeFiles,
      untracked_files: scopeFiles.untrackedFiles,
    } satisfies ReviewReport;
    const message = "No committed changes in push scope.";
    if (outputMode === "human") {
      console.log(message);
      if (scopeFiles.workingTreeFiles.length > 0 || scopeFiles.untrackedFiles.length > 0) {
        console.log("");
        console.log("Local workspace residue not included in push decision:");
        if (scopeFiles.workingTreeFiles.length > 0) {
          console.log(`- tracked but uncommitted: ${scopeFiles.workingTreeFiles.length}`);
        }
        if (scopeFiles.untrackedFiles.length > 0) {
          console.log(`- untracked: ${scopeFiles.untrackedFiles.length}`);
        }
      }
      console.log("");
    }
    return buildResultBase(reviewBase, report, "passed", true, false, message);
  }
  const reviewFilesArg = scopeFiles.committedFiles.map(shellQuote).join(" ");
  const entrixBase = `${reviewBase}...HEAD`;
  const reviewCommand =
    `PYTHONPATH=tools/entrix python3 -m entrix.cli review-trigger --base ${shellQuote(entrixBase)} --json --fail-on-trigger`
    + (reviewFilesArg ? ` ${reviewFilesArg}` : "");

  const review = await runCommand(reviewCommand, { stream: false, cwd: reviewRoot });

  if (review.exitCode === 0) {
    if (outputMode === "human") {
      console.log("No review trigger matched.");
      console.log("");
    }
    return buildResultBase(
      reviewBase,
      emptyReport(),
      "passed",
      true,
      false,
      "No review trigger matched.",
    );
  }

  const report = {
    ...parseReport(review.output),
    base: reviewBase,
    committed_files: scopeFiles.committedFiles,
    changed_files: scopeFiles.committedFiles,
    working_tree_files: scopeFiles.workingTreeFiles,
    untracked_files: scopeFiles.untrackedFiles,
  } satisfies ReviewReport;
  if (review.exitCode !== 3) {
    if (shouldBypassUnavailableReviewGate()) {
      const message = `${REVIEW_UNAVAILABLE_BYPASS_ENV}=1 set, bypassing unavailable review gate.`;
      if (outputMode === "human") {
        console.log(message);
        console.log("");
      }
      return buildResultBase(reviewBase, report, "unavailable", true, true, message);
    }

    const message =
      `Unable to evaluate review triggers. Blocking push because the review gate could not be evaluated. ` +
      `Fix the review environment and rerun, or set ${REVIEW_UNAVAILABLE_BYPASS_ENV}=1 to bypass intentionally.`;
    return buildResultBase(reviewBase, report, "unavailable", false, false, message);
  }

  if (outputMode === "human") {
    printReviewReport(report);
  }

  return parseDecision(report, reviewBase, reviewRoot, outputMode);
}
