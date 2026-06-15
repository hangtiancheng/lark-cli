// McpClient: JSON-RPC 2.0 over stdio/TCP for Model Context Protocol communication
import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import { createInterface } from "node:readline";

// Application-level error from MCP server (connection OK, but tool call failed)
export class McpToolError extends Error {
  readonly code: number;
  constructor(message: string, code: number) {
    super(message);
    this.name = "McpToolError";
    this.code = code;
  }
}

// Connection-level error: MCP server unreachable or disconnected
export class McpServerUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpServerUnavailableError";
  }
}

// Tool definition discovered from an MCP server
export interface McpToolDef {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

const READ_TIMEOUT_MS = 30_000; // 30 seconds per line read

// Type guard: narrow unknown to Record<string, unknown>
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// Safely convert an unknown value to a display string
function toDisplayString(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

// Full MCP JSON-RPC 2.0 client supporting stdio subprocess and TCP transports
export class McpClient {
  private _id = 0;
  private _proc: ChildProcess | null = null;
  private _tcpSocket: net.Socket | null = null;
  private _rl: ReturnType<typeof createInterface> | null = null;
  private _transport: "stdio" | "tcp" | "" = "";
  private _lock = new PromiseQueue();
  private _stderrLines: string[] = [];
  private _connected = false;

  // Connect via stdio: spawn a subprocess and perform MCP initialize handshake
  async connectStdio(command: string, args: string[], env?: Record<string, string>): Promise<void> {
    const mergedEnv = { ...process.env, ...(env ?? {}) };
    this._proc = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: mergedEnv,
    });

    this._proc.stderr?.on("data", (chunk: Buffer) => {
      const line = chunk.toString("utf-8").trim();
      if (line) this._stderrLines.push(line);
    });

    this._proc.on("exit", (_code) => {
      if (this._connected) {
        this._connected = false;
      }
    });

    if (!this._proc.stdout) {
      throw new McpServerUnavailableError("stdio subprocess has no stdout");
    }

    this._rl = createInterface({ input: this._proc.stdout, terminal: false });
    this._transport = "stdio";
    this._connected = true;
    await this._initialize();
  }

  // Connect via TCP: open a socket and perform MCP initialize handshake
  async connectTcp(host: string, port: number): Promise<void> {
    this._tcpSocket = await this._connectSocket(host, port);
    this._rl = createInterface({ input: this._tcpSocket, terminal: false });
    this._transport = "tcp";
    this._connected = true;
    await this._initialize();
  }

  // List tools provided by the MCP server
  async listTools(): Promise<McpToolDef[]> {
    const response = await this._call("tools/list", {});
    const tools: McpToolDef[] = [];
    const rawTools = response["tools"];
    if (!Array.isArray(rawTools)) return tools;
    for (const t of rawTools) {
      if (!isRecord(t)) continue;
      const name = typeof t["name"] === "string" ? t["name"] : "";
      const description = typeof t["description"] === "string" ? t["description"] : "";
      const schemaRaw: unknown = t["inputSchema"];
      const inputSchema = isRecord(schemaRaw) ? schemaRaw : {};
      tools.push({ name, description, inputSchema });
    }
    return tools;
  }

  // Call a tool on the MCP server; concatenate all text content parts
  async callTool(name: string, arguments_: Record<string, unknown>): Promise<string> {
    const response = await this._call("tools/call", {
      name,
      arguments: arguments_,
    });
    const parts: string[] = [];
    const content = response["content"];
    if (Array.isArray(content)) {
      for (const item of content) {
        if (isRecord(item) && item["type"] === "text") {
          const text = item["text"];
          if (typeof text === "string") {
            parts.push(text);
          }
        }
      }
    }
    return parts.join("\n");
  }

  // Close connection and terminate stdio subprocess gracefully
  async close(): Promise<void> {
    this._connected = false;
    if (this._rl) {
      this._rl.close();
      this._rl = null;
    }
    if (this._transport === "stdio" && this._proc) {
      this._proc.kill("SIGTERM");
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          if (this._proc) this._proc.kill("SIGKILL");
          resolve();
        }, 5000);
        this._proc?.on("exit", () => {
          clearTimeout(timeout);
          resolve();
        });
      });
      this._proc = null;
    }
    if (this._transport === "tcp" && this._tcpSocket) {
      this._tcpSocket.destroy();
      this._tcpSocket = null;
    }
  }

  // Send MCP initialize request and initialized notification
  private async _initialize(): Promise<void> {
    await this._call("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "lark-code", version: "0.1" },
    });
    await this._notify("notifications/initialized", {});
  }

  // Send a JSON-RPC request and wait for the matching response
  private async _call(
    method: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    this._id++;
    const reqId = this._id;
    const request = {
      jsonrpc: "2.0",
      id: reqId,
      method,
      params,
    };

    return this._lock.enqueue(async () => {
      await this._writeLine(JSON.stringify(request));
      return this._readResponse(reqId);
    });
  }

  // Send a JSON-RPC notification (no response expected)
  private async _notify(method: string, params: Record<string, unknown>): Promise<void> {
    const notification = { jsonrpc: "2.0", method, params };
    await this._writeLine(JSON.stringify(notification));
  }

  // Read lines until we find the response matching our request id
  private async _readResponse(reqId: number): Promise<Record<string, unknown>> {
    if (!this._rl) {
      throw new McpServerUnavailableError("reader unavailable");
    }

    const reqIdStr = String(reqId);

    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new McpServerUnavailableError("MCP server read timeout"));
      }, READ_TIMEOUT_MS);

      const onLine = (line: string): void => {
        if (!line.trim()) return;
        try {
          const parsed: unknown = JSON.parse(line);
          if (!isRecord(parsed)) return;
          const msg = parsed;
          const msgId = msg["id"];
          // Server-initiated notification — skip
          if (msgId === undefined || msgId === null) return;
          if (toDisplayString(msgId) === reqIdStr) {
            cleanup();
            if ("error" in msg) {
              const rawError = msg["error"];
              const errMsg = isRecord(rawError)
                ? toDisplayString(rawError["message"])
                : toDisplayString(rawError);
              const errCode =
                isRecord(rawError) && typeof rawError["code"] === "number" ? rawError["code"] : -1;
              reject(new McpToolError(errMsg, errCode));
            } else {
              const result = msg["result"];
              resolve(isRecord(result) ? result : {});
            }
          }
        } catch {
          // Ignore non-JSON lines
        }
      };

      const onClose = (): void => {
        cleanup();
        reject(new McpServerUnavailableError("MCP server closed connection"));
      };

      const cleanup = (): void => {
        clearTimeout(timeout);
        if (this._rl) {
          this._rl.off("line", onLine);
          this._rl.off("close", onClose);
        }
      };

      if (this._rl) {
        this._rl.on("line", onLine);
        this._rl.on("close", onClose);
      }
    });
  }

  // Write a JSON line to the transport
  private async _writeLine(line: string): Promise<void> {
    const data = Buffer.from(line + "\n", "utf-8");

    if (this._transport === "stdio" && this._proc) {
      const stdin = this._proc.stdin;
      if (!stdin) {
        throw new McpServerUnavailableError("stdio writer unavailable");
      }
      return new Promise<void>((resolve, reject) => {
        stdin.write(data, (err) => {
          if (err) {
            reject(new McpServerUnavailableError(err.message));
          } else {
            resolve();
          }
        });
      });
    }

    if (this._transport === "tcp" && this._tcpSocket) {
      const socket = this._tcpSocket;
      return new Promise<void>((resolve, reject) => {
        const ok = socket.write(data, (err) => {
          if (err) {
            reject(new McpServerUnavailableError(err.message));
          } else {
            resolve();
          }
        });
        if (!ok) {
          socket.once("drain", () => {
            resolve();
          });
        }
      });
    }

    throw new McpServerUnavailableError("no transport available");
  }

  // Open a TCP socket connection
  private _connectSocket(host: string, port: number): Promise<net.Socket> {
    return new Promise<net.Socket>((resolve, reject) => {
      const socket = net.createConnection(port, host, () => {
        resolve(socket);
      });
      socket.on("error", (err) => {
        reject(new McpServerUnavailableError(err.message));
      });
    });
  }
}

// Promise queue to serialize concurrent JSON-RPC calls (prevent write interleaving)
// Specialized for Record<string, unknown> — the only type used by _call()
class PromiseQueue {
  private _queue: {
    fn: () => Promise<Record<string, unknown>>;
    resolve: (value: Record<string, unknown>) => void;
    reject: (reason: unknown) => void;
  }[] = [];
  private _running = false;

  enqueue(fn: () => Promise<Record<string, unknown>>): Promise<Record<string, unknown>> {
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      this._queue.push({ fn, resolve, reject });
      void this._drain();
    });
  }

  private async _drain(): Promise<void> {
    if (this._running) return;
    this._running = true;
    while (this._queue.length > 0) {
      const item = this._queue.shift();
      if (!item) break;
      try {
        const result = await item.fn();
        item.resolve(result);
      } catch (err: unknown) {
        item.reject(err);
      }
    }
    this._running = false;
  }
}
