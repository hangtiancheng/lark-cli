import { describe, expect, test } from "vitest";
import { McpTool } from "../../src/core/mcp/tool.js";
import { McpClient, type McpToolDef } from "../../src/core/mcp/client.js";

describe("McpTool", () => {
  // Feature: McpTool name is prefixed with server name
  // Design: Create McpTool, verify name includes server__tool prefix
  test("name is prefixed with server name", () => {
    const client = new McpClient();
    const toolDef: McpToolDef = {
      name: "search",
      description: "Search the web",
      inputSchema: { type: "object", properties: {} },
    };
    const tool = new McpTool(client, "my_server", toolDef);

    expect(tool.name).toBe("my_server__search");
    expect(tool.description).toBe("Search the web");
  });

  // Feature: McpTool invoke returns error when client is not connected
  // Design: Invoke on disconnected client, verify error result
  test("invoke returns error when MCP server unavailable", async () => {
    const client = new McpClient();
    const toolDef: McpToolDef = {
      name: "search",
      description: "Search",
      inputSchema: { type: "object", properties: {} },
    };
    const tool = new McpTool(client, "my_server", toolDef);

    const result = await tool.invoke({ query: "test" });
    expect(result.isError).toBe(true);
    expect(result.content).toContain("unavailable");
    expect(result.errorType).toBe("runtime_error");
  });

  // Feature: McpTool invoke error message includes server name
  // Design: Verify the error message contains the server name and tool name
  test("invoke error includes server and tool names", async () => {
    const client = new McpClient();
    const toolDef: McpToolDef = {
      name: "fail_tool",
      description: "Always fails",
      inputSchema: { type: "object", properties: {} },
    };
    const tool = new McpTool(client, "srv", toolDef);

    const result = await tool.invoke({});
    expect(result.isError).toBe(true);
    expect(result.content).toContain("srv");
  });

  // Feature: McpTool preserves inputSchema from definition
  // Design: Verify the inputSchema matches constructor arg
  test("inputSchema matches tool definition", () => {
    const client = new McpClient();
    const schema = {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
      },
      required: ["query"],
    };
    const toolDef: McpToolDef = {
      name: "search",
      description: "Search",
      inputSchema: schema,
    };
    const tool = new McpTool(client, "srv", toolDef);

    expect(tool.inputSchema).toEqual(schema);
  });
});
