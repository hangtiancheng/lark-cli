import { describe, expect, test } from "vitest";
import { invokeTool } from "../../src/core/tools/invocation.js";
import { ToolRegistry } from "../../src/core/tools/registry.js";
import type { BaseTool } from "../../src/core/tools/base.js";
import { toolSuccess, toolError } from "../../src/core/tools/base.js";
import { EventBus } from "../../src/core/events/bus.js";
import type { ToolUseBlock } from "../../src/core/llm/types.js";

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

    expect(callCount).toBeGreaterThan(1);
    expect(result.isError).toBe(true);
  });
});
