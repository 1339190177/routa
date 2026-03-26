export const DEFAULT_PRE_PUSH_METRICS = [
  "eslint_pass",
  "ts_typecheck_pass",
  "ts_test_pass",
  "clippy_pass",
  "rust_test_pass",
] as const;

export const DEFAULT_PARALLEL_JOBS = 2;
export const DEFAULT_TAIL_LINES = 10;

export function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) {
    return fallback;
  }

  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < 1) {
    return fallback;
  }

  return value;
}

export function parseMetricNames(
  raw: string | undefined,
  fallback: readonly string[] = DEFAULT_PRE_PUSH_METRICS,
): string[] {
  if (!raw) {
    return [...fallback];
  }

  const metrics = raw
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);

  return metrics.length > 0 ? metrics : [...fallback];
}
