import { describe, expect, test } from "vitest";
import { z } from "zod";
import { invokeTool } from "../../src/core/tools/invocation.js";
import { ToolRegistry } from "../../src/core/tools/registry.js";
import type { BaseTool } from "../../src/core/tools/base.js";
import { toolSuccess, toolError } from "../../src/core/tools/base.js";
import { EventBus } from "../../src/core/events/bus.js";
import type { ToolUseBlock } from "../../src/core/llm/types.js";
import type { PermissionManager } from "../../src/core/permissions/manager.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPermissionManager(value: unknown): value is PermissionManager {
  if (!isRecord(value)) return false;
  return (
    typeof value["evaluate"] === "function" &&
    typeof value["checkAndWait"] === "function" &&
    typeof value["respond"] === "function" &&
    typeof value["cancelSession"] === "function"
  );
}

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
      invoke: () => Promise.resolve(toolError("error message", "runtime_error")),
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

  // Feature: Verify invokeTool validates params with paramsModel
  // Design: Tool with Zod schema rejects invalid params with schema_error
  test("validates params with paramsModel", async () => {
    const tool: BaseTool = {
      name: "validated_tool",
      description: "Validated tool",
      inputSchema: { type: "object" as const, properties: {} },
      paramsModel: z.object({ name: z.string() }),
      invoke: (params) => Promise.resolve(toolSuccess(`Hello ${String(params["name"])}`)),
    };
    const registry = new ToolRegistry();
    registry.register(tool);

    const bus = new EventBus();
    const toolUse: ToolUseBlock = {
      id: "call_1",
      name: "validated_tool",
      input: { name: 123 }, // Invalid: should be string
      type: "tool_use",
      caller: { type: "direct" },
    };
    const result = await invokeTool(registry, toolUse, bus, "r1");

    expect(result.isError).toBe(true);
    expect(result.errorType).toBe("schema_error");
    expect(result.content).toContain("expected string");
  });

  // Feature: Verify invokeTool classifies timeout errors
  // Design: Tool that exceeds timeout returns timeout error
  test("classifies timeout as timeout error", async () => {
    const tool: BaseTool = {
      name: "slow_tool",
      description: "Slow tool",
      inputSchema: { type: "object" as const, properties: {} },
      invoke: () =>
        new Promise((resolve) =>
          setTimeout(() => {
            resolve(toolSuccess("done"));
          }, 10000),
        ),
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

    expect(result.isError).toBe(true);
    expect(result.errorType).toBe("timeout");
  }, 15000);

  // Feature: Verify invokeTool catches exceptions as runtime_error
  // Design: Tool that throws Error is caught and classified as runtime_error
  test("catches exceptions as runtime_error", async () => {
    const tool: BaseTool = {
      name: "throw_tool",
      description: "Throw tool",
      inputSchema: { type: "object" as const, properties: {} },
      invoke: () => {
        throw new Error("unexpected failure");
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

    expect(result.isError).toBe(true);
    expect(result.errorType).toBe("runtime_error");
    expect(result.content).toContain("unexpected failure");
  });

  // Feature: Verify tool.call_started is always published first
  // Design: Even for failing tools, started event comes before failed event
  test("publishes tool.call_started before other events", async () => {
    const tool: BaseTool = {
      name: "fail_fast",
      description: "Fails immediately",
      inputSchema: { type: "object" as const, properties: {} },
      invoke: () => Promise.resolve(toolError("fail", "runtime_error")),
    };
    const registry = new ToolRegistry();
    registry.register(tool);

    const bus = new EventBus();
    const events: string[] = [];
    bus.subscribe((e) => {
      events.push(e.type);
      return Promise.resolve();
    });
    const toolUse: ToolUseBlock = {
      id: "call_1",
      name: "fail_fast",
      input: {},
      type: "tool_use",
      caller: { type: "direct" },
    };
    await invokeTool(registry, toolUse, bus, "r1");

    expect(events[0]).toBe("tool.call_started");
    expect(events).toContain("tool.call_failed");
  });

  // Feature: Verify invokeTool respects permission denial
  // Design: PermissionManager denies tool, returns permission_denied error
  test("respects permission denial", async () => {
    const tool: BaseTool = {
      name: "protected_tool",
      description: "Protected tool",
      inputSchema: { type: "object" as const, properties: {} },
      invoke: () => Promise.resolve(toolSuccess("should not run")),
    };
    const registry = new ToolRegistry();
    registry.register(tool);

    const bus = new EventBus();
    const toolUse: ToolUseBlock = {
      id: "call_1",
      name: "protected_tool",
      input: {},
      type: "tool_use",
      caller: { type: "direct" },
    };

    // Mock PermissionManager that always denies
    const mockPermissionManager = {
      evaluate: (): "ask" => "ask",
      checkAndWait: (): Promise<[boolean, string]> => Promise.resolve([false, "deny_once"]),
      respond: (_toolUseId: string, _decision: string): void => undefined,
      cancelSession: (_sessionId: string): void => undefined,
    };

    if (!isPermissionManager(mockPermissionManager)) {
      throw new Error("Invalid PermissionManager mock");
    }

    const result = await invokeTool(registry, toolUse, bus, "r1", {
      permissionManager: mockPermissionManager,
      sessionId: "s1",
    });

    expect(result.isError).toBe(true);
    expect(result.errorType).toBe("permission_denied");
  });
});
