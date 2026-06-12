import { describe, expect, test } from "vitest";
import { ToolRegistry } from "../../src/core/tools/registry.js";
import type { BaseTool } from "../../src/core/tools/base.js";
import { toolSuccess } from "../../src/core/tools/base.js";

describe("ToolRegistry", () => {
  // Feature: Verify registering and retrieving a tool by name
  // Design: Register one tool, retrieve it, confirm it's the same instance
  test("register and get tool", () => {
    const registry = new ToolRegistry();
    const tool: BaseTool = {
      name: "test_tool",
      description: "Test tool",
      inputSchema: { type: "object" as const, properties: {} },
      invoke: () => Promise.resolve(toolSuccess("ok")),
    };
    registry.register(tool);
    const retrieved = registry.get("test_tool");
    expect(retrieved).toBe(tool);
  });

  // Feature: Verify get returns undefined for unregistered tool
  // Design: Query non-existent tool name, confirm undefined is returned
  test("get returns undefined for unknown tool", () => {
    const registry = new ToolRegistry();
    const retrieved = registry.get("nonexistent");
    expect(retrieved).toBeUndefined();
  });

  // Feature: Verify registering tool with same name overwrites previous
  // Design: Register two tools with same name, confirm second one is retrieved
  test("registering same name overwrites", () => {
    const registry = new ToolRegistry();
    const tool1: BaseTool = {
      name: "test_tool",
      description: "First",
      inputSchema: { type: "object" as const, properties: {} },
      invoke: () => Promise.resolve(toolSuccess("first")),
    };
    const tool2: BaseTool = {
      name: "test_tool",
      description: "Second",
      inputSchema: { type: "object" as const, properties: {} },
      invoke: () => Promise.resolve(toolSuccess("second")),
    };
    registry.register(tool1);
    registry.register(tool2);
    const retrieved = registry.get("test_tool");
    expect(retrieved?.description).toBe("Second");
  });

  // Feature: Verify toolSchemas returns Anthropic-format schemas for all registered tools
  // Design: Register multiple tools, call toolSchemas(), confirm array structure and field mapping
  test("toolSchemas returns Anthropic format", () => {
    const registry = new ToolRegistry();
    const tool1: BaseTool = {
      name: "tool_a",
      description: "Tool A",
      inputSchema: {
        type: "object" as const,
        properties: { x: { type: "string" } },
      },
      invoke: () => Promise.resolve(toolSuccess("a")),
    };
    const tool2: BaseTool = {
      name: "tool_b",
      description: "Tool B",
      inputSchema: { type: "object" as const, properties: {} },
      invoke: () => Promise.resolve(toolSuccess("b")),
    };
    registry.register(tool1);
    registry.register(tool2);

    const schemas = registry.toolSchemas();
    expect(schemas.length).toBe(2);
    const schema0 = schemas[0];
    if ("name" in schema0) {
      expect(schema0.name).toBe("tool_a");
    }
    if ("description" in schema0) {
      expect(schema0.description).toBe("Tool A");
    }
    const schema1 = schemas[1];
    if ("name" in schema1) {
      expect(schema1.name).toBe("tool_b");
    }
  });

  // Feature: Verify toolSchemas returns empty array for empty registry
  // Design: Create registry without registering tools, confirm empty array
  test("toolSchemas returns empty array when no tools", () => {
    const registry = new ToolRegistry();
    const schemas = registry.toolSchemas();
    expect(schemas).toEqual([]);
  });
});
