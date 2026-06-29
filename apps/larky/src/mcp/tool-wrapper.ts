import { asErrorString } from "@/utils/index.js";
import type { Tool, ToolResult, ToolContext, ToolCategory, ToolSchema } from "../tools/types.js";
import type { MCPClient, MCPTool } from "./client.js";

function sanitizeName(serverName: string, toolName: string): string {
  const clean = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `mcp__${clean(serverName)}__${clean(toolName)}`;
}

export class MCPToolWrapper implements Tool {
  name: string;
  description: string;
  category: ToolCategory = "command" as const;

  // MCP tools are lazily loaded by default to avoid cramming all schemas into the prompt

  deferred = true;

  private client: MCPClient;
  private originalName: string;
  private inputSchema: ToolSchema["input_schema"];

  constructor(client: MCPClient, serverName: string, tool: MCPTool) {
    this.name = sanitizeName(serverName, tool.name);
    this.description = tool.description;
    this.originalName = tool.name;
    this.client = client;
    this.inputSchema = tool.inputSchema;
  }

  schema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      input_schema: this.inputSchema,
    };
  }

  async execute(_ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    try {
      const output = await this.client.callTool(this.originalName, args);
      return { output, isError: false };
    } catch (err) {
      return {
        output: `MCP tool error: ${asErrorString(err)}`,
        isError: true,
      };
    }
  }
}
