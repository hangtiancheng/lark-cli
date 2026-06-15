import { describe, expect, test } from "vitest";
import { AgentLoop } from "../../src/core/loop.js";
import { ExecutionContext } from "../../src/core/context.js";
import { ToolRegistry } from "../../src/core/tools/registry.js";
import { EventBus } from "../../src/core/events/bus.js";
import type { LLMProvider } from "../../src/core/llm/base.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (isRecord(value)) {
    return value;
  }
  return {};
}

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
      invoke: () => Promise.resolve({ content: "result", isError: false, errorType: null }),
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

  // Feature: Verify AgentLoop handles LLM errors gracefully
  // Design: Provider throws, confirm context marked as failed with "llm_error"
  test("handles LLM errors", async () => {
    const mockProvider: LLMProvider = {
      chat: () => Promise.reject(new Error("API failure")),
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
    expect(ctx.status).toBe("failed");
    expect(ctx.reason).toBe("llm_error");
  });

  // Feature: Verify AgentLoop continues on tool failure
  // Design: Tool returns error, confirm loop continues to next step
  test("continues on tool failure", async () => {
    let callCount = 0;
    const mockProvider: LLMProvider = {
      chat: () => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            stopReason: "tool_use",
            toolUses: [
              {
                id: "call_1",
                name: "failing_tool",
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
          text: "Recovered",
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
      name: "failing_tool",
      description: "Always fails",
      inputSchema: { type: "object" as const, properties: {} },
      invoke: () =>
        Promise.resolve({
          content: "error",
          isError: true,
          errorType: "runtime_error",
        }),
    });
    const bus = new EventBus();
    const loop = new AgentLoop(mockProvider, registry, bus);

    await loop.run(ctx);
    expect(ctx.isDone()).toBe(true);
    expect(ctx.status).toBe("success");
    expect(callCount).toBe(2); // Continued after tool failure
  });

  // Feature: Verify AgentLoop respects AbortSignal cancellation
  // Design: Abort signal during run, confirm context marked as cancelled and error thrown
  test("respects cancellation", async () => {
    const controller = new AbortController();
    let callCount = 0;
    const mockProvider: LLMProvider = {
      chat: () => {
        callCount++;
        if (callCount === 1) {
          controller.abort();
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
          text: "Should not reach",
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
      invoke: () => Promise.resolve({ content: "result", isError: false, errorType: null }),
    });
    const bus = new EventBus();
    const loop = new AgentLoop(mockProvider, registry, bus, {
      signal: controller.signal,
    });

    await expect(loop.run(ctx)).rejects.toThrow("cancelled");
    expect(ctx.isDone()).toBe(true);
    expect(ctx.status).toBe("failed");
    expect(ctx.reason).toBe("cancelled");
  });

  // Feature: Verify AgentLoop propagates is_error flag
  // Design: Tool returns isError=true, confirm flag is preserved in tool result
  test("propagates is_error flag", async () => {
    let callCount = 0;
    const mockProvider: LLMProvider = {
      chat: () => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            stopReason: "tool_use",
            toolUses: [
              {
                id: "call_1",
                name: "error_tool",
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
      name: "error_tool",
      description: "Returns error",
      inputSchema: { type: "object" as const, properties: {} },
      invoke: () =>
        Promise.resolve({
          content: "failed",
          isError: true,
          errorType: "runtime_error",
        }),
    });
    const bus = new EventBus();
    const loop = new AgentLoop(mockProvider, registry, bus);

    await loop.run(ctx);

    // Check context.messages for tool_result with is_error flag
    const toolResultMsg = ctx.messages.find(
      (m) =>
        m.role === "user" &&
        Array.isArray(m.content) &&
        m.content.some((b) => {
          const record = asRecord(b);
          return record["type"] === "tool_result";
        }),
    );
    expect(toolResultMsg).toBeDefined();
    if (!toolResultMsg || !Array.isArray(toolResultMsg.content)) {
      throw new Error("Expected toolResultMsg with array content");
    }
    const content = toolResultMsg.content;
    const toolResult = content.find((b) => {
      const record = asRecord(b);
      return record["type"] === "tool_result";
    });
    expect(toolResult).toBeDefined();
    if (!toolResult) {
      throw new Error("Expected toolResult to be defined");
    }
    const resultRecord = asRecord(toolResult);
    expect(resultRecord["is_error"]).toBe(true);
  });

  // Feature: Verify AgentLoop increments step counter
  // Design: Run multi-step loop, confirm step counter increments correctly
  test("increments step counter", async () => {
    let callCount = 0;
    const mockProvider: LLMProvider = {
      chat: () => {
        callCount++;
        if (callCount < 3) {
          return Promise.resolve({
            stopReason: "tool_use",
            toolUses: [
              {
                id: `call_${String(callCount)}`,
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
      invoke: () => Promise.resolve({ content: "result", isError: false, errorType: null }),
    });
    const bus = new EventBus();
    const loop = new AgentLoop(mockProvider, registry, bus);

    await loop.run(ctx);
    expect(ctx.step).toBe(3);
    expect(callCount).toBe(3);
  });

  // Feature: Verify AgentLoop handles max_tokens with tool_use
  // Design: Provider returns max_tokens with tool_use, confirm error tool result added
  test("handles max_tokens with tool_use", async () => {
    let callCount = 0;
    const mockProvider: LLMProvider = {
      chat: () => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            stopReason: "max_tokens",
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
      invoke: () => Promise.resolve({ content: "result", isError: false, errorType: null }),
    });
    const bus = new EventBus();
    const loop = new AgentLoop(mockProvider, registry, bus);

    await loop.run(ctx);

    // Check context.messages for error tool_result from max_tokens
    const toolResultMsg = ctx.messages.find(
      (m) =>
        m.role === "user" &&
        Array.isArray(m.content) &&
        m.content.some((b) => {
          const record = asRecord(b);
          return record["type"] === "tool_result" && record["is_error"] === true;
        }),
    );
    expect(toolResultMsg).toBeDefined();
    if (!toolResultMsg || !Array.isArray(toolResultMsg.content)) {
      throw new Error("Expected toolResultMsg with array content");
    }
    const content = toolResultMsg.content;
    const errorResult = content.find((b) => {
      const record = asRecord(b);
      return record["type"] === "tool_result" && record["is_error"] === true;
    });
    expect(errorResult).toBeDefined();
    if (!errorResult) {
      throw new Error("Expected errorResult to be defined");
    }
    const errorRecord = asRecord(errorResult);
    expect(errorRecord["content"]).toContain("output token limit");
  });
});
