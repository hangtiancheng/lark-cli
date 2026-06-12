// Permission flow integration test: PermissionManager + AgentRunner with mock LLM provider
// No daemon subprocess needed — uses AgentRunner in-process with real PermissionManager
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, test } from "vitest";

import { EventBus } from "../../src/core/events/bus.js";
import type { LLMProvider } from "../../src/core/llm/base.js";
import type { LlmResponse, ToolUseBlock } from "../../src/core/llm/types.js";
import type { Event } from "../../src/core/bus/events.js";
import { PermissionManager } from "../../src/core/permissions/manager.js";
import { AgentRunner } from "../../src/core/runner.js";
import type { LarkConfig } from "../../src/core/config.js";

function makeConfig(maxSteps: number): LarkConfig {
  return {
    host: "127.0.0.1",
    port: 7437,
    logging: { level: "INFO", file: "/dev/null", format: "text" },
    agent: { maxSteps },
    llm: { defaultModel: "claude-sonnet-4-6", router: "static" },
    trace: { enabled: false, file: "", includeLlmPayload: false },
    permission: { timeoutS: 60 },
    compaction: {
      autoThreshold: 0,
      toolResultLimit: 8000,
      toolResultKeep: 4000,
    },
    mcp: { servers: [] },
  };
}

function makeToolUse(
  id: string,
  name: string,
  input: Record<string, unknown>,
): ToolUseBlock {
  return {
    type: "tool_use",
    id,
    name,
    input,
    caller: { type: "direct" },
  };
}

// Step 1: bash tool call. Step 2: end_turn.
function singleBashProvider(command = "echo hello"): LLMProvider {
  let step = 0;
  return {
    chat(): Promise<LlmResponse> {
      step++;
      if (step === 1) {
        return Promise.resolve({
          stopReason: "tool_use",
          text: "",
          toolUses: [makeToolUse("tc1", "bash", { command })],
          usage: {
            inputTokens: 100,
            outputTokens: 20,
            cacheReadInputTokens: 0,
            cacheCreationInputTokens: 0,
            contextPercent: 1,
          },
          thinkingBlocks: [],
        });
      }
      return Promise.resolve({
        stopReason: "end_turn",
        text: "done",
        toolUses: [],
        usage: {
          inputTokens: 120,
          outputTokens: 5,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
          contextPercent: 1,
        },
        thinkingBlocks: [],
      });
    },
  };
}

// Step 1+2: two separate bash calls. Step 3: end_turn.
function twoBashProvider(): LLMProvider {
  let step = 0;
  return {
    chat(): Promise<LlmResponse> {
      step++;
      if (step === 1) {
        return Promise.resolve({
          stopReason: "tool_use",
          text: "",
          toolUses: [makeToolUse("tc1", "bash", { command: "echo first" })],
          usage: {
            inputTokens: 100,
            outputTokens: 20,
            cacheReadInputTokens: 0,
            cacheCreationInputTokens: 0,
            contextPercent: 1,
          },
          thinkingBlocks: [],
        });
      }
      if (step === 2) {
        return Promise.resolve({
          stopReason: "tool_use",
          text: "",
          toolUses: [makeToolUse("tc2", "bash", { command: "echo second" })],
          usage: {
            inputTokens: 120,
            outputTokens: 20,
            cacheReadInputTokens: 0,
            cacheCreationInputTokens: 0,
            contextPercent: 1,
          },
          thinkingBlocks: [],
        });
      }
      return Promise.resolve({
        stopReason: "end_turn",
        text: "done",
        toolUses: [],
        usage: {
          inputTokens: 140,
          outputTokens: 5,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
          contextPercent: 1,
        },
        thinkingBlocks: [],
      });
    },
  };
}

function makeRunner(
  provider: LLMProvider,
  bus: EventBus,
  manager: PermissionManager,
  runsDir: string,
  maxSteps = 10,
): AgentRunner {
  return new AgentRunner(makeConfig(maxSteps), {
    bus,
    provider,
    permissionManager: manager,
    runsDir,
  });
}

describe("permission flow integration", () => {
  // Feature: allow_once decision lets tool execute and produces tool.call_finished event
  // Design: On permission.requested event, respond with allow_once; verify tool runs successfully
  test("allow_once lets tool execute", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "lark-perm-"));
    try {
      const manager = new PermissionManager();
      const bus = new EventBus();
      const eventTypes: string[] = [];

      bus.subscribe((event: Event) => {
        eventTypes.push(event.type);
        if (event.type === "permission.requested") {
          manager.respond(event.tool_use_id, "allow_once");
        }
        return Promise.resolve();
      });

      const runner = makeRunner(
        singleBashProvider(),
        bus,
        manager,
        path.join(dir, "runs"),
      );
      const outcome = await runner.runAndCapture("run bash");

      expect(eventTypes).toContain("permission.requested");
      expect(eventTypes).toContain("tool.call_finished");
      expect(eventTypes).not.toContain("tool.call_failed");
      expect(outcome.status).toBe("success");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Feature: deny_once prevents tool execution, produces tool.call_failed with permission_denied
  // Design: On permission.requested, respond with deny_once; verify tool never runs
  test("deny_once prevents tool execution", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "lark-perm-"));
    try {
      const manager = new PermissionManager();
      const bus = new EventBus();
      const eventTypes: string[] = [];
      const failedEvents: Event[] = [];

      bus.subscribe((event: Event) => {
        eventTypes.push(event.type);
        if (event.type === "permission.requested") {
          manager.respond(event.tool_use_id, "deny_once");
        }
        if (event.type === "tool.call_failed") {
          failedEvents.push(event);
        }
        return Promise.resolve();
      });

      const runner = makeRunner(
        singleBashProvider(),
        bus,
        manager,
        path.join(dir, "runs"),
      );
      await runner.runAndCapture("run bash");

      expect(eventTypes).toContain("permission.requested");
      expect(eventTypes).toContain("tool.call_failed");
      expect(eventTypes).not.toContain("tool.call_finished");

      const failed = failedEvents[0];
      expect(failed).toBeDefined();
      expect(failed.type).toBe("tool.call_failed");
      if (failed.type === "tool.call_failed") {
        expect(failed.error_class).toBe("permission_denied");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Feature: always_allow caches decision within session, second bash call skips permission prompt
  // Design: Two bash calls; first respond always_allow; verify permission.requested fires only once
  test("always_allow cached within session", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "lark-perm-"));
    try {
      const manager = new PermissionManager();
      const bus = new EventBus();
      let permRequestedCount = 0;

      bus.subscribe((event: Event) => {
        if (event.type === "permission.requested") {
          permRequestedCount++;
          manager.respond(event.tool_use_id, "always_allow");
        }
        return Promise.resolve();
      });

      const runner = makeRunner(
        twoBashProvider(),
        bus,
        manager,
        path.join(dir, "runs"),
      );
      const outcome = await runner.runAndCapture("run two bash commands");

      expect(permRequestedCount).toBe(1);
      expect(outcome.status).toBe("success");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
