import { describe, expect, test } from "vitest";
import { AgentRunner } from "../../src/core/runner.js";
import { EventBus } from "../../src/core/events/bus.js";
import type { LLMProvider } from "../../src/core/llm/base.js";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

describe("AgentRunner", () => {
  // Feature: Verify AgentRunner executes a run
  // Design: Create runner with mock provider, run goal, confirm it completes
  test("executes a run", async () => {
    const mockProvider: LLMProvider = {
      chat: () =>
        Promise.resolve({
          stopReason: "end_turn",
          toolUses: [],
          text: "Done",
          usage: null,
          thinkingBlocks: [],
        }),
    };

    const dir = path.join(tmpdir(), `test-runner-${String(Date.now())}`);
    mkdirSync(dir, { recursive: true });
    const bus = new EventBus();
    const runner = new AgentRunner(
      {
        host: "127.0.0.1",
        port: 7437,
        logging: { level: "info", file: "", format: "text" },
        agent: { maxSteps: 5 },
        llm: { defaultModel: "claude-3", router: "static" },
        trace: { enabled: false, file: "", includeLlmPayload: false },
        permission: { timeoutS: 60 },
        compaction: {
          autoThreshold: 0.8,
          toolResultLimit: 10000,
          toolResultKeep: 5000,
        },
        mcp: { servers: [] },
      },
      {
        provider: mockProvider,
        bus,
        runsDir: dir,
      },
    );

    await runner.run("test goal");
    rmSync(dir, { recursive: true });
  });

  // Feature: Verify AgentRunner publishes run events
  // Design: Run goal, confirm run.started and run.finished events are published
  test("publishes run events", async () => {
    const mockProvider: LLMProvider = {
      chat: () =>
        Promise.resolve({
          stopReason: "end_turn",
          toolUses: [],
          text: "Done",
          usage: null,
          thinkingBlocks: [],
        }),
    };

    const dir = path.join(tmpdir(), `test-runner-${String(Date.now())}`);
    mkdirSync(dir, { recursive: true });
    const bus = new EventBus();
    const events: string[] = [];
    bus.subscribe((event) => {
      events.push(event.type);
      return Promise.resolve();
    });
    const runner = new AgentRunner(
      {
        host: "127.0.0.1",
        port: 7437,
        logging: { level: "info", file: "", format: "text" },
        agent: { maxSteps: 5 },
        llm: { defaultModel: "claude-3", router: "static" },
        trace: { enabled: false, file: "", includeLlmPayload: false },
        permission: { timeoutS: 60 },
        compaction: {
          autoThreshold: 0.8,
          toolResultLimit: 10000,
          toolResultKeep: 5000,
        },
        mcp: { servers: [] },
      },
      {
        provider: mockProvider,
        bus,
        runsDir: dir,
      },
    );

    await runner.run("test goal");
    expect(events).toContain("run.started");
    expect(events).toContain("run.finished");
    rmSync(dir, { recursive: true });
  });

  // Feature: Verify AgentRunner returns run outcome
  // Design: Run goal with runAndCapture, confirm outcome is returned
  test("returns run outcome", async () => {
    const mockProvider: LLMProvider = {
      chat: () =>
        Promise.resolve({
          stopReason: "end_turn",
          toolUses: [],
          text: "Done",
          usage: null,
          thinkingBlocks: [],
        }),
    };

    const dir = path.join(tmpdir(), `test-runner-${String(Date.now())}`);
    mkdirSync(dir, { recursive: true });
    const bus = new EventBus();
    const runner = new AgentRunner(
      {
        host: "127.0.0.1",
        port: 7437,
        logging: { level: "info", file: "", format: "text" },
        agent: { maxSteps: 5 },
        llm: { defaultModel: "claude-3", router: "static" },
        trace: { enabled: false, file: "", includeLlmPayload: false },
        permission: { timeoutS: 60 },
        compaction: {
          autoThreshold: 0.8,
          toolResultLimit: 10000,
          toolResultKeep: 5000,
        },
        mcp: { servers: [] },
      },
      {
        provider: mockProvider,
        bus,
        runsDir: dir,
      },
    );

    const outcome = await runner.runAndCapture("test goal");
    expect(outcome.status).toBe("success");
    rmSync(dir, { recursive: true });
  });
});
