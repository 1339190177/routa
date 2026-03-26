import { afterEach, describe, expect, it, vi } from "vitest";

import { formatReviewPhaseLabel, handleCliError, parseArgs } from "../cli.js";

describe("handleCliError", () => {
  const originalOutputMode = process.env.ROUTA_HOOK_RUNTIME_OUTPUT_MODE;
  const originalMetrics = process.env.ROUTA_HOOK_RUNTIME_METRICS;

  afterEach(() => {
    process.exitCode = undefined;
    if (originalOutputMode === undefined) {
      delete process.env.ROUTA_HOOK_RUNTIME_OUTPUT_MODE;
    } else {
      process.env.ROUTA_HOOK_RUNTIME_OUTPUT_MODE = originalOutputMode;
    }
    if (originalMetrics === undefined) {
      delete process.env.ROUTA_HOOK_RUNTIME_METRICS;
    } else {
      process.env.ROUTA_HOOK_RUNTIME_METRICS = originalMetrics;
    }
    vi.restoreAllMocks();
  });

  it("sets a non-zero exit code in human mode", () => {
    delete process.env.ROUTA_HOOK_RUNTIME_OUTPUT_MODE;
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});

    handleCliError(new Error("Review-trigger matched in a non-interactive push."), []);

    expect(stderr).toHaveBeenCalledWith("Review-trigger matched in a non-interactive push.");
    expect(process.exitCode).toBe(1);
  });

  it("sets a non-zero exit code in jsonl mode without writing to stderr", () => {
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});

    handleCliError(new Error("blocked"), ["--jsonl"]);

    expect(stderr).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });
});

describe("parseArgs", () => {
  it("uses metric names from environment by default", () => {
    process.env.ROUTA_HOOK_RUNTIME_METRICS = "eslint_pass,ts_test_pass";

    const options = parseArgs([]);

    expect(options.metricNames).toEqual(["eslint_pass", "ts_test_pass"]);
  });

  it("lets --metrics override env metric names", () => {
    process.env.ROUTA_HOOK_RUNTIME_METRICS = "eslint_pass,ts_test_pass";

    const options = parseArgs(["--metrics", "clippy_pass,rust_test_pass"]);

    expect(options.metricNames).toEqual(["clippy_pass", "rust_test_pass"]);
  });
});

describe("formatReviewPhaseLabel", () => {
  it("describes unavailable review state without flattening it to blocked", () => {
    expect(
      formatReviewPhaseLabel({
        allowed: false,
        base: "origin/main",
        bypassed: false,
        message: "review unavailable",
        status: "unavailable",
        triggers: [],
      }),
    ).toBe("unavailable");
  });

  it("marks bypassed unavailable review state explicitly", () => {
    expect(
      formatReviewPhaseLabel({
        allowed: true,
        base: "origin/main",
        bypassed: true,
        message: "review unavailable but bypassed",
        status: "unavailable",
        triggers: [],
      }),
    ).toBe("unavailable (bypassed)");
  });
});
