import { afterEach, describe, expect, it } from "vitest";

import { resolveSchedulerTickUrl } from "../scheduler-service";

const ORIGINAL_ENV = {
  PORT: process.env.PORT,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  ROUTA_INTERNAL_API_ORIGIN: process.env.ROUTA_INTERNAL_API_ORIGIN,
  ROUTA_BASE_URL: process.env.ROUTA_BASE_URL,
  VERCEL_URL: process.env.VERCEL_URL,
};

describe("resolveSchedulerTickUrl", () => {
  afterEach(() => {
    process.env.PORT = ORIGINAL_ENV.PORT;
    process.env.NEXT_PUBLIC_APP_URL = ORIGINAL_ENV.NEXT_PUBLIC_APP_URL;
    process.env.ROUTA_INTERNAL_API_ORIGIN = ORIGINAL_ENV.ROUTA_INTERNAL_API_ORIGIN;
    process.env.ROUTA_BASE_URL = ORIGINAL_ENV.ROUTA_BASE_URL;
    process.env.VERCEL_URL = ORIGINAL_ENV.VERCEL_URL;
  });

  it("uses the current local PORT when no explicit origin is configured", () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.ROUTA_INTERNAL_API_ORIGIN;
    delete process.env.ROUTA_BASE_URL;
    delete process.env.VERCEL_URL;
    process.env.PORT = "3500";

    expect(resolveSchedulerTickUrl()).toBe("http://127.0.0.1:3500/api/schedules/tick");
  });

  it("prefers explicit internal origin when provided", () => {
    process.env.ROUTA_INTERNAL_API_ORIGIN = "http://100.71.239.88:3500/";
    process.env.PORT = "3000";

    expect(resolveSchedulerTickUrl()).toBe("http://100.71.239.88:3500/api/schedules/tick");
  });
});
