import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const isServerlessEnvironmentMock = vi.hoisted(() => vi.fn(() => true));

vi.mock("@/core/acp/api-based-providers", () => ({
  isServerlessEnvironment: isServerlessEnvironmentMock,
}));

vi.mock("@/core/mcp/mcp-tool-executor", () => ({
  getMcpToolDefinitions: vi.fn(() => []),
  executeMcpTool: vi.fn(),
}));

vi.mock("@/core/mcp/routa-mcp-server", () => ({
  createRoutaMcpServer: vi.fn(),
}));

vi.mock("@/core/tools/kanban-tools", () => ({
  KanbanTools: class KanbanTools {},
}));

vi.mock("@/core/acp/http-session-store", () => ({
  getHttpSessionStore: vi.fn(() => ({
    getSession: vi.fn(),
    upsertSession: vi.fn(),
  })),
}));

vi.mock("@/core/acp/session-db-persister", () => ({
  renameSessionInDb: vi.fn(),
}));

import {
  OpencodeSdkDirectAdapter,
  createOpencodeAdapterIfAvailable,
  getOpencodeConfig,
  getOpencodeServerUrl,
  isOpencodeDirectApiConfigured,
  isOpencodeServerConfigured,
  shouldUseOpencodeAdapter,
} from "../opencode-sdk-adapter";

describe("opencode-sdk-adapter config", () => {
  beforeEach(() => {
    delete process.env.OPENCODE_SERVER_URL;
    delete process.env.OPENCODE_MODEL;
    delete process.env.OPENCODE_DIRECTORY;
    delete process.env.API_TIMEOUT_MS;
    delete process.env.OPENCODE_API_KEY;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    delete process.env.OPENCODE_BASE_URL;
    delete process.env.OPENCODE_MODEL_ID;
    delete process.env.ANTHROPIC_MODEL;
    isServerlessEnvironmentMock.mockReturnValue(true);
  });

  afterEach(() => {
    delete process.env.OPENCODE_SERVER_URL;
    delete process.env.OPENCODE_MODEL;
    delete process.env.OPENCODE_DIRECTORY;
    delete process.env.API_TIMEOUT_MS;
    delete process.env.OPENCODE_API_KEY;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    delete process.env.OPENCODE_BASE_URL;
    delete process.env.OPENCODE_MODEL_ID;
    delete process.env.ANTHROPIC_MODEL;
  });

  it("detects remote server and direct api configuration", () => {
    expect(isOpencodeDirectApiConfigured()).toBe(false);
    expect(isOpencodeServerConfigured()).toBe(false);

    process.env.OPENCODE_SERVER_URL = "http://127.0.0.1:4096";
    expect(getOpencodeServerUrl()).toBe("http://127.0.0.1:4096");
    expect(isOpencodeServerConfigured()).toBe(true);

    delete process.env.OPENCODE_SERVER_URL;
    process.env.OPENCODE_API_KEY = "opencode-key";
    expect(isOpencodeDirectApiConfigured()).toBe(true);
    expect(isOpencodeServerConfigured()).toBe(true);
  });

  it("parses model and direct api defaults from the environment", () => {
    process.env.OPENCODE_SERVER_URL = "http://server.local";
    process.env.OPENCODE_MODEL = "anthropic/claude-sonnet";
    process.env.OPENCODE_DIRECTORY = "/workspace/demo";
    process.env.API_TIMEOUT_MS = "65000";
    process.env.ANTHROPIC_AUTH_TOKEN = "anthropic-token";
    process.env.ANTHROPIC_MODEL = "glm-fallback";

    const config = getOpencodeConfig();

    expect(config).toEqual({
      serverUrl: "http://server.local",
      model: {
        providerID: "anthropic",
        modelID: "claude-sonnet",
      },
      directory: "/workspace/demo",
      timeoutMs: 65000,
      directApi: {
        apiKey: "anthropic-token",
        baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
        modelId: "glm-fallback",
      },
    });
  });

  it("chooses adapter availability based on environment", () => {
    expect(shouldUseOpencodeAdapter()).toBe(false);
    expect(createOpencodeAdapterIfAvailable(vi.fn())).toBeNull();

    process.env.OPENCODE_SERVER_URL = "http://server.local";
    expect(shouldUseOpencodeAdapter()).toBe(true);
    expect(createOpencodeAdapterIfAvailable(vi.fn())).not.toBeNull();

    delete process.env.OPENCODE_SERVER_URL;
    process.env.OPENCODE_API_KEY = "opencode-key";
    expect(createOpencodeAdapterIfAvailable(vi.fn())).toBeInstanceOf(OpencodeSdkDirectAdapter);

    isServerlessEnvironmentMock.mockReturnValue(false);
    expect(shouldUseOpencodeAdapter()).toBe(false);
  });
});

describe("OpencodeSdkDirectAdapter", () => {
  beforeEach(() => {
    delete process.env.OPENCODE_API_KEY;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    delete process.env.OPENCODE_MODEL_ID;
    delete process.env.OPENCODE_BASE_URL;
  });

  afterEach(() => {
    delete process.env.OPENCODE_API_KEY;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    delete process.env.OPENCODE_MODEL_ID;
    delete process.env.OPENCODE_BASE_URL;
  });

  it("requires api credentials before connecting", async () => {
    const adapter = new OpencodeSdkDirectAdapter(vi.fn());

    await expect(adapter.connect()).rejects.toThrow(
      "OpenCode Direct API requires OPENCODE_API_KEY or ANTHROPIC_AUTH_TOKEN environment variable",
    );
  });

  it("initializes and creates a session when credentials are present", async () => {
    process.env.ANTHROPIC_AUTH_TOKEN = "anthropic-token";
    process.env.OPENCODE_MODEL_ID = "GLM-4.7-plus";
    process.env.OPENCODE_BASE_URL = "https://api.example.test";

    const adapter = new OpencodeSdkDirectAdapter(vi.fn());

    await adapter.connect();

    expect(adapter.alive).toBe(true);
    expect(adapter.acpSessionId).toMatch(/^opencode-direct-\d+$/);

    await expect(adapter.createSession("Coverage Session")).resolves.toBe(adapter.acpSessionId);
  });

  it("rejects session creation when the adapter is not connected", async () => {
    const adapter = new OpencodeSdkDirectAdapter(vi.fn());

    await expect(adapter.createSession()).rejects.toThrow("Adapter not connected");
  });
});
