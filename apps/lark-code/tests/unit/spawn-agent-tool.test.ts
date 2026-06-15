import { describe, expect, test } from "vitest";
import { SpawnAgentTool, AgentResultTool } from "../../src/core/subagent/tool.js";
import { BackgroundTaskRegistry } from "../../src/core/subagent/registry.js";
import { EventBus } from "../../src/core/events/bus.js";
import { ExecutionContext } from "../../src/core/context.js";
import type { LLMProvider } from "../../src/core/llm/base.js";

function stubProvider(): LLMProvider {
  return {
    chat(
      _messages: unknown[],
      _toolSchemas: unknown[],
      _bus: EventBus,
      _runId: string,
      _options?: { step?: number; system?: string | null },
    ) {
      return Promise.resolve({
        stopReason: "end_turn",
        text: "done",
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
          contextPercent: 0,
        },
        toolUses: [],
        thinkingBlocks: [],
      });
    },
  };
}

describe("SpawnAgentTool", () => {
  // Feature: SpawnAgentTool has correct name and schema
  // Design: Verify name is spawn_agent and schema requires description and prompt
  test("has correct metadata", () => {
    const bus = new EventBus();
    const registry = new BackgroundTaskRegistry();
    const tool = new SpawnAgentTool(
      stubProvider(),
      bus,
      "run-1",
      undefined,
      20,
      registry,
      "/tmp/runs",
      "session-1",
      0,
    );
    expect(tool.name).toBe("spawn_agent");
    expect(tool.inputSchema).toHaveProperty("properties.description");
    expect(tool.inputSchema).toHaveProperty("properties.prompt");
  });

  // Feature: SpawnAgentTool rejects nesting beyond depth 2
  // Design: Create tool at depth 2, invoke, verify error
  test("rejects nesting beyond depth 2", async () => {
    const bus = new EventBus();
    const registry = new BackgroundTaskRegistry();
    const tool = new SpawnAgentTool(
      stubProvider(),
      bus,
      "run-1",
      undefined,
      20,
      registry,
      "/tmp/runs",
      "session-1",
      2, // depth = 2 (max)
    );
    const result = await tool.invoke({
      description: "test",
      prompt: "do something",
    });
    expect(result.isError).toBe(true);
    expect(result.content).toContain("nesting limit");
  });
});

describe("AgentResultTool", () => {
  // Feature: AgentResultTool has correct name
  // Design: Verify name is agent_result
  test("has correct name", () => {
    const registry = new BackgroundTaskRegistry();
    const tool = new AgentResultTool(registry);
    expect(tool.name).toBe("agent_result");
  });

  // Feature: AgentResultTool returns error for unknown run_id
  // Design: Query non-existent run_id, verify error
  test("returns error for unknown run_id", async () => {
    const registry = new BackgroundTaskRegistry();
    const tool = new AgentResultTool(registry);
    const result = await tool.invoke({ run_id: "nonexistent" });
    expect(result.isError).toBe(true);
    expect(result.content).toContain("Unknown run_id");
  });

  // Feature: AgentResultTool returns 'still running' for pending task
  // Design: Register a pending task, query it, verify still running
  test("returns still running for pending task", async () => {
    const registry = new BackgroundTaskRegistry();
    const tool = new AgentResultTool(registry);
    // Register a promise that never resolves
    const ctx = new ExecutionContext({
      runId: "bg-1",
      goal: "test",
      maxSteps: 5,
    });
    registry.register(
      "bg-1",
      new Promise<void>(() => {
        // Intentionally never resolves
        void 0;
      }),
      ctx,
    );
    const result = await tool.invoke({ run_id: "bg-1" });
    expect(result.isError).toBe(false);
    expect(result.content).toBe("still running");
  });

  // Feature: AgentResultTool returns result for completed task
  // Design: Register a completed task, query it, verify result
  test("returns result for completed task", async () => {
    const registry = new BackgroundTaskRegistry();
    const tool = new AgentResultTool(registry);
    const ctx = new ExecutionContext({
      runId: "bg-2",
      goal: "test",
      maxSteps: 5,
    });
    ctx.result = "Task completed successfully";
    ctx.markSuccess();
    registry.register("bg-2", Promise.resolve(), ctx);
    const result = await tool.invoke({ run_id: "bg-2" });
    expect(result.isError).toBe(false);
    expect(result.content).toBe("Task completed successfully");
  });
});
