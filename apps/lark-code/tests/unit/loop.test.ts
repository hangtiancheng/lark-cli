import { describe, expect, test } from "vitest";
import { AgentLoop } from "../../src/core/loop.js";
import { ExecutionContext } from "../../src/core/context.js";
import { ToolRegistry } from "../../src/core/tools/registry.js";
import { EventBus } from "../../src/core/events/bus.js";
import type { LLMProvider } from "../../src/core/llm/base.js";

describe("AgentLoop", () => {
  // Feature: Verify AgentLoop terminates on end_turn
  // Design: Create mock provider that returns end_turn, confirm loop completes
  test("terminates on end_turn", async () => {
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

    const ctx = new ExecutionContext({
      runId: "r1",
      goal: "test",
      maxSteps: 5,
    });
    const registry = new ToolRegistry();
    const bus = new EventBus();
    const loop = new AgentLoop(mockProvider, registry, bus);

    await loop.run(ctx);
    expect(ctx.isDone()).toBe(true);
    expect(ctx.status).toBe("success");
  });

  // Feature: Verify AgentLoop stops at max_steps
  // Design: Create mock provider that always returns tool_use, confirm loop stops at max_steps
  test("stops at max_steps", async () => {
    const mockProvider: LLMProvider = {
      chat: () =>
        Promise.resolve({
          stopReason: "tool_use",
          toolUses: [
            {
              id: "call_1",
              name: "test",
              input: {},
              type: "tool_use",
              caller: { type: "direct" },
            },
          ],
          text: "",
          usage: null,
          thinkingBlocks: [],
        }),
    };

    const ctx = new ExecutionContext({
      runId: "r1",
      goal: "test",
      maxSteps: 2,
    });
    const registry = new ToolRegistry();
    const bus = new EventBus();
    const loop = new AgentLoop(mockProvider, registry, bus);

    await loop.run(ctx);
    expect(ctx.isDone()).toBe(true);
    expect(ctx.status).toBe("failed");
    expect(ctx.reason).toContain("max_steps");
  });

  // Feature: Verify AgentLoop executes tools
  // Design: Create mock provider that returns tool_use, confirm tool is executed
  test("executes tools", async () => {
    let toolUseed = false;
    const mockProvider: LLMProvider = {
      chat: () => {
        if (!toolUseed) {
          toolUseed = true;
          return Promise.resolve({
            stopReason: "tool_use",
            toolUses: [
              {
                id: "call_1",
                name: "test_tool",
                input: {},
                type: "tool_use",
                caller: { type: "direct" },
              },
            ],
            text: "",
            usage: null,
            thinkingBlocks: [],
          });
        }
        return Promise.resolve({
          stopReason: "end_turn",
          toolUses: [],
          text: "Done",
          usage: null,
          thinkingBlocks: [],
        });
      },
    };

    const ctx = new ExecutionContext({
      runId: "r1",
      goal: "test",
      maxSteps: 5,
    });
    const registry = new ToolRegistry();
    registry.register({
      name: "test_tool",
      description: "Test tool",
      inputSchema: { type: "object" as const, properties: {} },
      invoke: () =>
        Promise.resolve({ content: "result", isError: false, errorType: null }),
    });
    const bus = new EventBus();
    const loop = new AgentLoop(mockProvider, registry, bus);

    await loop.run(ctx);
    expect(toolUseed).toBe(true);
  });

  // Feature: Verify AgentLoop publishes step events
  // Design: Run loop, confirm step.started and step.finished events are published
  test("publishes step events", async () => {
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

    const ctx = new ExecutionContext({
      runId: "r1",
      goal: "test",
      maxSteps: 5,
    });
    const registry = new ToolRegistry();
    const bus = new EventBus();
    const events: string[] = [];
    bus.subscribe((event) => {
      events.push(event.type);
      return Promise.resolve();
    });
    const loop = new AgentLoop(mockProvider, registry, bus);

    await loop.run(ctx);
    expect(events).toContain("step.started");
    expect(events).toContain("step.finished");
  });
});
