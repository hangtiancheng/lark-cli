import { describe, expect, test } from "vitest";
import { invokeTool } from "../../src/core/tools/invocation.js";
import { ToolRegistry } from "../../src/core/tools/registry.js";
import type { BaseTool } from "../../src/core/tools/base.js";
import { toolSuccess, toolError } from "../../src/core/tools/base.js";
import { EventBus } from "../../src/core/events/bus.js";
import type { ToolUseBlock } from "../../src/core/llm/types.js";

describe("Tool Invocation", () => {
  // Feature: Verify invokeTool calls tool and returns result
  // Design: Create simple tool, invoke it, confirm result is returned
  test("calls tool and returns result", async () => {
    const tool: BaseTool = {
      name: "test_tool",
      description: "Test tool",
      inputSchema: { type: "object" as const, properties: {} },
      invoke: () => Promise.resolve(toolSuccess("result")),
    };
    const registry = new ToolRegistry();
    registry.register(tool);

    const bus = new EventBus();
    const toolUse: ToolUseBlock = {
      id: "call_1",
      name: "test_tool",
      input: {},
      type: "tool_use",
      caller: { type: "direct" },
    };
    const result = await invokeTool(registry, toolUse, bus, "r1");

    expect(result.isError).toBe(false);
    expect(result.content).toBe("result");
  });

  // Feature: Verify invokeTool handles tool errors
  // Design: Create tool that returns error, invoke it, confirm error is returned
  test("handles tool errors", async () => {
    const tool: BaseTool = {
      name: "error_tool",
      description: "Error tool",
      inputSchema: { type: "object" as const, properties: {} },
      invoke: () =>
        Promise.resolve(toolError("error message", "runtime_error")),
    };
    const registry = new ToolRegistry();
    registry.register(tool);

    const bus = new EventBus();
    const toolUse: ToolUseBlock = {
      id: "call_1",
      name: "error_tool",
      input: {},
      type: "tool_use",
      caller: { type: "direct" },
    };
    const result = await invokeTool(registry, toolUse, bus, "r1");

    expect(result.isError).toBe(true);
    expect(result.content).toBe("error message");
  });

  // Feature: Verify invokeTool returns error for unknown tool
  // Design: Invoke non-existent tool, confirm error is returned
  test("returns error for unknown tool", async () => {
    const registry = new ToolRegistry();
    const bus = new EventBus();

    const result = await invokeTool(
      registry,
      {
        id: "call_1",
        name: "unknown_tool",
        input: {},
        type: "tool_use",
        caller: { type: "direct" },
      },
      bus,
      "r1",
    );

    expect(result.isError).toBe(true);
    expect(result.content).toContain("unknown tool");
  });

  // Feature: Verify invokeTool publishes events
  // Design: Invoke tool, confirm tool.call_started and tool.call_finished events are published
  test("publishes events", async () => {
    const tool: BaseTool = {
      name: "event_tool",
      description: "Event tool",
      inputSchema: { type: "object" as const, properties: {} },
      invoke: () => Promise.resolve(toolSuccess("result")),
    };
    const registry = new ToolRegistry();
    registry.register(tool);

    const bus = new EventBus();
    const events: string[] = [];
    bus.subscribe((event) => {
      events.push(event.type);
      return Promise.resolve();
    });

    await invokeTool(
      registry,
      {
        id: "call_1",
        name: "event_tool",
        input: {},
        type: "tool_use",
        caller: { type: "direct" },
      },
      bus,
      "r1",
    );

    expect(events).toContain("tool.call_started");
    expect(events).toContain("tool.call_finished");
  });
});
