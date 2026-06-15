import { describe, expect, test } from "vitest";
import { invokeTool } from "../../src/core/tools/invocation.js";
import { ToolRegistry } from "../../src/core/tools/registry.js";
import type { BaseTool } from "../../src/core/tools/base.js";
import { toolSuccess, toolError } from "../../src/core/tools/base.js";
import { EventBus } from "../../src/core/events/bus.js";
import type { ToolUseBlock } from "../../src/core/llm/types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (isRecord(value)) {
    return value;
  }
  if (Array.isArray(value)) {
    return Object.fromEntries(value.entries());
  }
  return {};
}

describe("Tool Retry", () => {
  // Feature: Verify invokeTool retries on runtime_error
  // Design: Create tool that fails twice then succeeds, confirm it's retried
  test("retries on runtime_error", async () => {
    let callCount = 0;
    const tool: BaseTool = {
      name: "retry_tool",
      description: "Retry tool",
      inputSchema: { type: "object" as const, properties: {} },
      invoke: () => {
        callCount++;
        if (callCount < 3) {
          return Promise.resolve(toolError("temporary error", "runtime_error"));
        }
        return Promise.resolve(toolSuccess("success"));
      },
    };
    const registry = new ToolRegistry();
    registry.register(tool);

    const bus = new EventBus();
    const toolUse: ToolUseBlock = {
      id: "call_1",
      name: "retry_tool",
      input: {},
      type: "tool_use",
      caller: { type: "direct" },
    };
    const result = await invokeTool(registry, toolUse, bus, "r1");

    expect(callCount).toBe(3);
    expect(result.isError).toBe(false);
    expect(result.content).toBe("success");
  });

  // Feature: Verify invokeTool retries on rate_limited
  // Design: Create tool that fails with rate_limited then succeeds, confirm it's retried
  test("retries on rate_limited", async () => {
    let callCount = 0;
    const tool: BaseTool = {
      name: "rate_tool",
      description: "Rate tool",
      inputSchema: { type: "object" as const, properties: {} },
      invoke: () => {
        callCount++;
        if (callCount < 2) {
          return Promise.resolve(toolError("rate limited", "rate_limited"));
        }
        return Promise.resolve(toolSuccess("success"));
      },
    };
    const registry = new ToolRegistry();
    registry.register(tool);

    const bus = new EventBus();
    const toolUse: ToolUseBlock = {
      id: "call_1",
      name: "rate_tool",
      input: {},
      type: "tool_use",
      caller: { type: "direct" },
    };
    const result = await invokeTool(registry, toolUse, bus, "r1");

    expect(callCount).toBe(2);
    expect(result.isError).toBe(false);
  });

  // Feature: Verify invokeTool does not retry on schema_error
  // Design: Create tool that fails with schema_error, confirm it's not retried
  test("does not retry on schema_error", async () => {
    let callCount = 0;
    const tool: BaseTool = {
      name: "schema_tool",
      description: "Schema tool",
      inputSchema: { type: "object" as const, properties: {} },
      invoke: () => {
        callCount++;
        return Promise.resolve(toolError("schema error", "schema_error"));
      },
    };
    const registry = new ToolRegistry();
    registry.register(tool);

    const bus = new EventBus();
    const toolUse: ToolUseBlock = {
      id: "call_1",
      name: "schema_tool",
      input: {},
      type: "tool_use",
      caller: { type: "direct" },
    };
    const result = await invokeTool(registry, toolUse, bus, "r1");

    expect(callCount).toBe(1);
    expect(result.isError).toBe(true);
  });

  // Feature: Verify invokeTool gives up after max retries
  // Design: Create tool that always fails, confirm it gives up after max retries
  test("gives up after max retries", async () => {
    let callCount = 0;
    const tool: BaseTool = {
      name: "fail_tool",
      description: "Fail tool",
      inputSchema: { type: "object" as const, properties: {} },
      invoke: () => {
        callCount++;
        return Promise.resolve(toolError("permanent error", "runtime_error"));
      },
    };
    const registry = new ToolRegistry();
    registry.register(tool);

    const bus = new EventBus();
    const toolUse: ToolUseBlock = {
      id: "call_1",
      name: "fail_tool",
      input: {},
      type: "tool_use",
      caller: { type: "direct" },
    };
    const result = await invokeTool(registry, toolUse, bus, "r1");

    expect(callCount).toBe(3); // MAX_RETRIES=2 means 3 total attempts (1 + 2 retries)
    expect(result.isError).toBe(true);
    expect(result.errorType).toBe("runtime_error");
  });

  // Feature: Verify invokeTool does not retry on timeout
  // Design: Tool that exceeds timeout returns timeout error, no retry
  test("does not retry on timeout", async () => {
    let callCount = 0;
    const tool: BaseTool = {
      name: "slow_tool",
      description: "Slow tool",
      inputSchema: { type: "object" as const, properties: {} },
      invoke: () => {
        callCount++;
        return new Promise((resolve) =>
          setTimeout(() => {
            resolve(toolSuccess("done"));
          }, 10000),
        );
      },
    };
    const registry = new ToolRegistry();
    registry.register(tool);

    const bus = new EventBus();
    const toolUse: ToolUseBlock = {
      id: "call_1",
      name: "slow_tool",
      input: {},
      type: "tool_use",
      caller: { type: "direct" },
    };
    const result = await invokeTool(registry, toolUse, bus, "r1", {
      timeout: 50,
    });

    expect(callCount).toBe(1); // No retry on timeout
    expect(result.isError).toBe(true);
    expect(result.errorType).toBe("timeout");
  }, 15000);

  // Feature: Verify error_class in tool.call_failed events
  // Design: Failing tool publishes events with correct error_class
  test("publishes failed events with correct error_class", async () => {
    let callCount = 0; // TODO: You may want to add `callCount` tests
    const tool: BaseTool = {
      name: "err_tool",
      description: "Error tool",
      inputSchema: { type: "object" as const, properties: {} },
      invoke: () => {
        callCount++;
        return Promise.resolve(toolError("fail", "runtime_error"));
      },
    };
    const registry = new ToolRegistry();
    registry.register(tool);

    const bus = new EventBus();
    const events: unknown[] = [];
    bus.subscribe((e) => {
      events.push(e);
      return Promise.resolve();
    });
    const toolUse: ToolUseBlock = {
      id: "call_1",
      name: "err_tool",
      input: {},
      type: "tool_use",
      caller: { type: "direct" },
    };
    await invokeTool(registry, toolUse, bus, "r1");

    const failedEvents = events.filter((e: unknown) => asRecord(e)["type"] === "tool.call_failed");
    expect(failedEvents.length).toBeGreaterThan(0);
    for (const fe of failedEvents) {
      expect(asRecord(fe)["error_class"]).toBe("runtime_error");
    }
    expect(callCount).toBe(3); // MAX_RETRIES=2, so 3 total attempts
  });

  // Feature: Verify RateLimitedError exception triggers retry
  // Design: Tool that throws RateLimitedError is retried with rate_limited error_class
  test("retries on RateLimitedError exception", async () => {
    let callCount = 0;
    const { RateLimitedError } = await import("../../src/core/tools/errors.js");
    const tool: BaseTool = {
      name: "rl_tool",
      description: "Rate limited tool",
      inputSchema: { type: "object" as const, properties: {} },
      invoke: () => {
        callCount++;
        if (callCount < 2) {
          throw new RateLimitedError("too many requests");
        }
        return Promise.resolve(toolSuccess("ok"));
      },
    };
    const registry = new ToolRegistry();
    registry.register(tool);

    const bus = new EventBus();
    const events: unknown[] = [];
    bus.subscribe((e) => {
      events.push(e);
      return Promise.resolve();
    });
    const toolUse: ToolUseBlock = {
      id: "call_1",
      name: "rl_tool",
      input: {},
      type: "tool_use",
      caller: { type: "direct" },
    };
    const result = await invokeTool(registry, toolUse, bus, "r1");

    expect(callCount).toBe(2);
    expect(result.isError).toBe(false);
    const failedEvents = events.filter((e: unknown) => asRecord(e)["type"] === "tool.call_failed");
    expect(failedEvents.length).toBe(1);
    expect(asRecord(failedEvents[0])["error_class"]).toBe("rate_limited");
  });

  // Feature: Verify runtime exceptions trigger retry
  // Design: Tool that throws a generic Error is caught as runtime_error and retried
  test("retries on thrown exceptions as runtime_error", async () => {
    let callCount = 0;
    const tool: BaseTool = {
      name: "throw_tool",
      description: "Throw tool",
      inputSchema: { type: "object" as const, properties: {} },
      invoke: () => {
        callCount++;
        if (callCount < 2) {
          throw new Error("unexpected failure");
        }
        return Promise.resolve(toolSuccess("recovered"));
      },
    };
    const registry = new ToolRegistry();
    registry.register(tool);

    const bus = new EventBus();
    const toolUse: ToolUseBlock = {
      id: "call_1",
      name: "throw_tool",
      input: {},
      type: "tool_use",
      caller: { type: "direct" },
    };
    const result = await invokeTool(registry, toolUse, bus, "r1");

    expect(callCount).toBe(2);
    expect(result.isError).toBe(false);
    expect(result.content).toBe("recovered");
  });
});
