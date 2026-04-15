import { EventEmitter } from "node:events";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { IProcessHandle, WritableStreamLike } from "@/core/platform/interfaces";

const spawnMock = vi.hoisted(() => vi.fn());
const isAvailableMock = vi.hoisted(() => vi.fn(() => true));

vi.mock("@/core/platform", () => ({
  getServerBridge: () => ({
    process: {
      isAvailable: isAvailableMock,
      spawn: spawnMock,
      execSync: vi.fn(),
    },
  }),
}));

import { ClaudeCodeProcess } from "../claude-code-process";

class FakeWritable implements WritableStreamLike {
  writable = true;
  writes: Array<string | Buffer> = [];

  write(data: string | Buffer): boolean {
    this.writes.push(data);
    return true;
  }
}

class FakeProcess extends EventEmitter implements IProcessHandle {
  pid: number | undefined = 4321;
  stdin: WritableStreamLike | null = new FakeWritable();
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  exitCode: number | null = null;

  kill(): void {
    this.exitCode = 0;
    this.emit("exit", 0, null);
  }
}

describe("ClaudeCodeProcess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isAvailableMock.mockReturnValue(true);
    spawnMock.mockReset();
  });

  function createProcess(onNotification = vi.fn()) {
    return new ClaudeCodeProcess({
      preset: {
        id: "claude-code",
        name: "Claude Code",
        provider: "claude-code",
        command: "claude",
        args: [],
      } as never,
      command: "claude",
      cwd: "/tmp",
      displayName: "Claude Code",
      allowedTools: ["Read", "Write"],
      mcpConfigs: ["{\"name\":\"routa\"}"],
    }, onNotification);
  }

  it("starts Claude with stream-json flags and auto-approval defaults", async () => {
    vi.useFakeTimers();
    const fakeProcess = new FakeProcess();
    spawnMock.mockReturnValue(fakeProcess);

    const process = createProcess();
    const startPromise = process.start();
    await vi.advanceTimersByTimeAsync(500);
    await startPromise;

    expect(spawnMock).toHaveBeenCalledWith(
      "claude",
      expect.arrayContaining([
        "-p",
        "--output-format",
        "stream-json",
        "--input-format",
        "stream-json",
        "--include-partial-messages",
        "--verbose",
        "--dangerously-skip-permissions",
        "--disallowed-tools",
        "AskUserQuestion",
        "--allowedTools",
        "Read,Write",
        "--mcp-config",
        "{\"name\":\"routa\"}",
      ]),
      expect.objectContaining({
        cwd: "/tmp",
      }),
    );

    vi.useRealTimers();
  });

  it("fails startup when the spawned process has no pid", async () => {
    const fakeProcess = new FakeProcess();
    fakeProcess.pid = undefined;
    spawnMock.mockReturnValue(fakeProcess);

    const process = createProcess();

    await expect(process.start()).rejects.toThrow(
      'Failed to spawn Claude Code - is "claude" installed and in PATH?',
    );
  });

  it("resolves prompts from result messages", async () => {
    vi.useFakeTimers();
    const onNotification = vi.fn();
    const fakeProcess = new FakeProcess();
    spawnMock.mockReturnValue(fakeProcess);

    const process = createProcess(onNotification);
    const startPromise = process.start();
    await vi.advanceTimersByTimeAsync(500);
    await startPromise;

    const promptPromise = process.prompt("session-1", "Hello Claude");
    fakeProcess.stdout.emit(
      "data",
      Buffer.from(
        `${JSON.stringify({ type: "result", result: "done", stop_reason: "max_tokens" })}\n`,
        "utf-8",
      ),
    );

    await expect(promptPromise).resolves.toEqual({ stopReason: "max_tokens" });
    expect(onNotification).toHaveBeenCalledWith(expect.objectContaining({
      method: "session/update",
      params: expect.objectContaining({
        update: expect.objectContaining({
          sessionUpdate: "turn_complete",
          stopReason: "max_tokens",
        }),
      }),
    }));

    vi.useRealTimers();
  });

  it("rejects in-flight prompts when the process exits", async () => {
    vi.useFakeTimers();
    const fakeProcess = new FakeProcess();
    spawnMock.mockReturnValue(fakeProcess);

    const process = createProcess();
    const startPromise = process.start();
    await vi.advanceTimersByTimeAsync(500);
    await startPromise;

    const promptPromise = process.prompt("session-1", "Continue");
    fakeProcess.exitCode = 137;
    fakeProcess.emit("exit", 137, null);

    await expect(promptPromise).rejects.toThrow("Claude Code process exited (code=137)");
    vi.useRealTimers();
  });
});
