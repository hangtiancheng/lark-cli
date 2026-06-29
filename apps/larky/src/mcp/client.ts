// Note that because some servers are still using SSE, clients may need to support both transports during the migration period.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  StreamableHTTPClientTransport,
  type StreamableHTTPClientTransportOptions,
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  SSEClientTransport,
  type SSEClientTransportOptions,
} from "@modelcontextprotocol/sdk/client/sse.js";
import type { MCPServerConfig } from "../config/config.js";
import type { ToolSchema } from "@/tools/types.js";

type MCPTransport =
  | StdioClientTransport
  | StreamableHTTPClientTransport
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  | SSEClientTransport;

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: ToolSchema["input_schema"];
}

// Expand ${VAR} / $VAR references in config values from the environment so
// secrets (API keys etc.) can live in env vars rather than the config file.

// expandEnv("api_key: ${OPENAI_API_KEY}")
// if OPENAI_API_KEY=sk-xxx, returns "api_key: sk-xxx"

// expandEnv("host: $DATABASE_HOST")
// if DATABASE_HOST=localhost, returns "host: localhost"
function expandEnv(value: string): string {
  return value.replace(
    /\$\{(\w+)\}|\$(\w+)/g,
    (_, a: string, b: string) => process.env[a || b] ?? "",
  );
}

function asDict(obj: Record<string, string | undefined>): Record<string, string> {
  const dict: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    dict[k] = v ?? "";
  }
  return dict;
}

export class MCPClient {
  name: string;
  private config: MCPServerConfig;
  private client: Client | null = null;
  private transport: MCPTransport | null = null;

  constructor(config: MCPServerConfig) {
    this.name = config.name;
    this.config = config;
  }

  async connect(): Promise<void> {
    if (this.config.command) {
      // stdio transport
      const env: NodeJS.ProcessEnv = process.env;
      if (this.config.env) {
        for (const [k, v] of Object.entries(this.config.env)) {
          env[k] = expandEnv(v);
        }
      }

      this.transport = new StdioClientTransport({
        command: this.config.command,
        args: this.config.args ?? [],
        env: asDict(env),
        stderr: "ignore",
      });
    } else if (this.config.url) {
      // http / sse transport

      const url = new URL(this.config.url);
      const headers: Record<string, string> = {};
      if (this.config.headers) {
        for (const [k, v] of Object.entries(this.config.headers)) {
          headers[k] = expandEnv(v);
        }
      }

      const opts: StreamableHTTPClientTransportOptions | SSEClientTransportOptions = {
        requestInit: { headers },
      };

      this.transport =
        this.config.transport === "sse"
          ? // eslint-disable-next-line @typescript-eslint/no-deprecated
            new SSEClientTransport(url, opts)
          : new StreamableHTTPClientTransport(url, opts);
    } else {
      throw new Error(
        `MCP server '${this.name}': needs either 'command' (stdio) or 'url' (http/sse)`,
      );
    }

    this.client = new Client({ name: "larky", version: "0.1.0" }, {});
    await this.client.connect(this.transport);
  }

  // The server's instructions from the initialize result, if any.
  getInstructions(): string {
    return this.client?.getInstructions() ?? "";
  }

  async listTools(): Promise<MCPTool[]> {
    if (!this.client) {
      throw new Error("Not connected");
    }
    const result = await this.client.listTools();
    return result.tools.map(
      ({ name, description, inputSchema: { properties, ...inputSchemaRest } }) => ({
        name,
        description: description ?? "",
        inputSchema: { ...inputSchemaRest, properties: properties ?? {} },
      }),
    );
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    if (!this.client) {
      throw new Error("Not connected");
    }
    const result = await this.client.callTool({ name, arguments: args });
    if (result.content && Array.isArray(result.content)) {
      return result.content
        .map((c: { type: string; text?: string }) =>
          c.type === "text" ? (c.text ?? "") : JSON.stringify(c),
        )
        .join("\n");
    }
    return JSON.stringify(result);
  }

  async disconnect(): Promise<void> {
    try {
      await this.client?.close();
    } catch {
      // ignore
    }
    this.client = null;
    this.transport = null;
  }
}
