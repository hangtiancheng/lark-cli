// McpTool: wrap an MCP server tool as a BaseTool for transparent use in ToolRegistry
import type { BaseTool, ToolResult } from "../tools/base.js";
import { toolSuccess, toolError } from "../tools/base.js";
import type { McpClient, McpToolDef } from "./client.js";

// Wrap an MCP tool as a BaseTool so ToolRegistry can call it transparently
// Tool name is prefixed with serverName__ to prevent naming conflicts between servers
export class McpTool implements BaseTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;

  private _client: McpClient;
  private _serverName: string;
  private _rawName: string;

  constructor(client: McpClient, serverName: string, toolDef: McpToolDef) {
    this._client = client;
    this._serverName = serverName;
    this._rawName = toolDef.name;
    this.name = `${serverName}__${toolDef.name}`;
    this.description = toolDef.description || `MCP tool from ${serverName}`;
    this.inputSchema =
      Object.keys(toolDef.inputSchema).length > 0
        ? toolDef.inputSchema
        : { type: "object", properties: {} };
  }

  // Invoke the tool on the MCP server; returns isError=true on connection or execution failure
  async invoke(params: Record<string, unknown>): Promise<ToolResult> {
    try {
      const content = await this._client.callTool(this._rawName, params);
      return toolSuccess(content);
    } catch (exc: unknown) {
      if (exc instanceof Error && exc.name === "McpServerUnavailableError") {
        return toolError(
          `mcp server '${this._serverName}' unavailable: ${exc.message}`,
          "runtime_error",
        );
      }
      if (exc instanceof Error && exc.name === "McpToolError") {
        return toolError(`mcp tool '${this.name}' error: ${exc.message}`, "runtime_error");
      }
      const msg = exc instanceof Error ? exc.message : String(exc);
      return toolError(`mcp tool '${this.name}' unexpected error: ${msg}`, "runtime_error");
    }
  }
}
