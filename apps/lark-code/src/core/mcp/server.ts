// McpServerManager: MCP server lifecycle management (placeholder implementation)
import type { McpClient } from "./client.js";

export class McpServerManager {
  private _clients: McpClient[] = [];

  startAll(_servers: unknown[]): void {
    // S0-S2: MCP is a placeholder implementation
  }

  stopAll(): void {
    for (const client of this._clients) {
      client.disconnect();
    }
    this._clients = [];
  }

  getTools(): unknown[] {
    return [];
  }
}
