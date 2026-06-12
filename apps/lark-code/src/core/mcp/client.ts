// McpClient: JSON-RPC 2.0 over stdio/TCP (Placeholder implementation)
export class McpClient {
  private _name: string;
  private _connected = false;

  constructor(name: string) {
    this._name = name;
  }

  connect(): void {
    this._connected = true;
  }

  disconnect(): void {
    this._connected = false;
  }

  listTools(): Record<string, unknown>[] {
    return [];
  }

  callTool(name: string, _args: Record<string, unknown>): unknown {
    throw new Error(`MCP tool ${name} not available`);
  }
}
