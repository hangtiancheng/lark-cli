// McpTool: wrap an MCP server tool as a BaseTool for transparent use in ToolRegistry
import type { BaseTool, ToolResult } from "../tools/base.js";
import { toolSuccess, toolError } from "../tools/base.js";
import type { McpClient } from "./client.js";

export interface McpToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

// Wrap an MCP tool as a BaseTool so ToolRegistry can call it transparently
export class McpTool implements BaseTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;

  private _client: McpClient;
  private _serverName: string;
  private _toolDef: McpToolDef;

  // Initialize MCP tool wrapper; tool name is prefixed with server_name__ to prevent naming conflicts
  constructor(client: McpClient, serverName: string, toolDef: McpToolDef) {
    this._client = client;
    this._serverName = serverName;
    this._toolDef = toolDef;
    this.name = `${serverName}__${toolDef.name}`;
    this.description = toolDef.description;
    this.inputSchema = toolDef.inputSchema;
  }

  // Invoke the tool on the MCP server; returns is_error=true on connection or execution failure
  invoke(params: Record<string, unknown>): Promise<ToolResult> {
    try {
      const content = this._client.callTool(this._toolDef.name, params);
      const res = toolSuccess(String(content));
      return Promise.resolve(res);
    } catch (exc: unknown) {
      const msg = exc instanceof Error ? exc.message : String(exc);
      if (msg.includes("not available")) {
        const err = toolError(
          `mcp server '${this._serverName}' unavailable: ${msg}`,
          "runtime_error",
        );
        return Promise.resolve(err);
      }
      const err = toolError(
        `mcp tool '${this.name}' error: ${msg}`,
        "runtime_error",
      );
      return Promise.resolve(err);
    }
  }
}
