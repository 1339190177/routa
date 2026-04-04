import { describe, expect, it } from "vitest";

import path from "node:path";
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

import {
  buildSessionStartDoctorOutput,
  formatGitControlPlaneDoctorReport,
  inspectGitControlPlane,
} from "../lib/git-control-plane-doctor.js";

function withTempRepo(run: (repoRoot: string) => void) {
  const repoRoot = mkdtempSync(path.join(tmpdir(), "routa-git-doctor-"));

  try {
    execSync("git init", { cwd: repoRoot, stdio: "ignore" });
    mkdirSync(path.join(repoRoot, ".husky", "_"), { recursive: true });
    writeFileSync(path.join(repoRoot, ".husky", "_", "h"), "#!/usr/bin/env sh\n", "utf8");
    writeFileSync(path.join(repoRoot, ".husky", "_", "pre-commit"), "#!/usr/bin/env sh\n", "utf8");
    writeFileSync(path.join(repoRoot, ".husky", "_", "pre-push"), "#!/usr/bin/env sh\n", "utf8");
    writeFileSync(path.join(repoRoot, ".husky", "_", "post-commit"), "#!/usr/bin/env sh\n", "utf8");
    run(repoRoot);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
}

describe("git control-plane doctor", () => {
  it("reports an ok status when the repo matches policy", () => {
    withTempRepo((repoRoot) => {
      execSync("git config --local core.hooksPath .husky/_", { cwd: repoRoot, stdio: "ignore" });

      const report = inspectGitControlPlane(repoRoot);

      expect(report.status).toBe("ok");
      expect(report.issues).toHaveLength(0);
      expect(formatGitControlPlaneDoctorReport(report)).toContain("ok");
      expect(buildSessionStartDoctorOutput(report)).toBeNull();
    });
  });

  it("detects hooksPath drift and placeholder commit identity", () => {
    withTempRepo((repoRoot) => {
      execSync("git config --local core.hooksPath /tmp/routa-test-hooks", {
        cwd: repoRoot,
        stdio: "ignore",
      });
      execSync("git config --local user.name Test", { cwd: repoRoot, stdio: "ignore" });
      execSync("git config --local user.email test@test.com", { cwd: repoRoot, stdio: "ignore" });

      const report = inspectGitControlPlane(repoRoot);

      expect(report.status).toBe("warning");
      expect(report.issues.map((issue) => issue.code)).toEqual([
        "hooks-path-drift",
        "suspicious-local-user-name",
        "suspicious-local-user-email",
      ]);

      const hookOutput = buildSessionStartDoctorOutput(report);
      expect(hookOutput?.systemMessage).toContain("hooksPath");
      expect(hookOutput?.hookSpecificOutput?.hookEventName).toBe("SessionStart");
      expect(hookOutput?.hookSpecificOutput?.additionalContext).toContain("Do not mutate .git/config");
    });
  });

  it("warns when tracked husky runtime files are missing", () => {
    withTempRepo((repoRoot) => {
      execSync("git config --local core.hooksPath .husky/_", { cwd: repoRoot, stdio: "ignore" });
      rmSync(path.join(repoRoot, ".husky", "_", "pre-push"), { force: true });

      const report = inspectGitControlPlane(repoRoot);

      expect(report.status).toBe("warning");
      expect(report.issues[0]?.code).toBe("missing-husky-runtime");
      expect(formatGitControlPlaneDoctorReport(report)).toContain("missing pre-push");
    });
  });
});
