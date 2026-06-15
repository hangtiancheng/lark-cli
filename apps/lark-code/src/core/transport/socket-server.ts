// TCP server: read NDJSON lines, dispatch to registered CommandHandler, handle JSON-RPC errors
import { AsyncLocalStorage } from "node:async_hooks";
import net from "node:net";
import { createInterface } from "node:readline";
import {
  HandlerError,
  INTERNAL_ERROR,
  INVALID_REQUEST,
  JsonRpcRequestSchema,
  METHOD_NOT_FOUND,
  PARSE_ERROR,
  makeError,
} from "../bus/envelope.js";
import type { JsonRpcSuccess } from "../bus/envelope.js";
import type { TraceWriter } from "../trace/writer.js";

export type CommandHandler = (params: Record<string, unknown>) => Promise<unknown>;

// Per-connection context: the socket currently being processed (for handlers to read connection context)
const writerStorage = new AsyncLocalStorage<net.Socket>();

// Return the Socket for the current handler call's connection
export function getConnectionWriter(): net.Socket {
  const socket = writerStorage.getStore();
  if (!socket) {
    throw new Error("getConnectionWriter() called outside of handler context");
  }
  return socket;
}

const MAX_LINE_BYTES = 64 * 1024 * 1024; // 64 MB per frame

// Send JSON line to socket and record trace
async function sendJson(socket: net.Socket, data: unknown): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const line = JSON.stringify(data) + "\n";
    const ok = socket.write(line, "utf-8", (err) => {
      if (err) reject(err);
      else resolve();
    });
    if (!ok) {
      // Backpressure: wait for drain event
      socket.once("drain", () => {
        resolve();
      });
    }
  });
}

export class SocketServer {
  private _host: string;
  private _port: number;
  private _handlers = new Map<string, CommandHandler>();
  private _server: net.Server | null = null;
  private _activeSockets = new Set<net.Socket>();
  private _trace: TraceWriter | undefined;

  constructor(host: string, port: number, options?: { trace?: TraceWriter }) {
    this._host = host;
    this._port = port;
    this._trace = options?.trace;
  }

  // Register a command handler for a given method name
  register(method: string, handler: CommandHandler): void {
    this._handlers.set(method, handler);
  }

  // Start TCP server; throw error if port is already in use
  async start(): Promise<string> {
    // Probe if port is already in use
    const isOccupied = await this._probePort();
    if (isOccupied) {
      throw new Error(`core already running at ${this._host}:${String(this._port)}`);
    }

    return new Promise<string>((resolve, reject) => {
      this._server = net.createServer((socket) => {
        this._handleConnection(socket);
      });

      this._server.on("error", reject);

      this._server.listen(this._port, this._host, () => {
        resolve(`${this._host}:${String(this._port)}`);
      });
    });
  }

  // Close server: disconnect all active connections first, then close server
  async stop(): Promise<void> {
    const server = this._server;
    if (!server) return;

    for (const socket of this._activeSockets) {
      socket.destroy();
    }
    this._activeSockets.clear();

    return new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
      // 2s timeout for forced shutdown
      setTimeout(() => {
        resolve();
      }, 2000);
    });
  }

  // Probe if port is already in use
  private _probePort(): Promise<boolean> {
    return new Promise((resolve) => {
      const probe = net.createConnection(this._port, this._host, () => {
        probe.destroy();
        resolve(true);
      });
      probe.on("error", () => {
        resolve(false);
      });
    });
  }

  // Handle a single client connection
  private _handleConnection(socket: net.Socket): void {
    this._activeSockets.add(socket);

    const rl = createInterface({
      input: socket,
      terminal: false,
    });

    let currentLineBytes = 0;

    rl.on("line", (line) => {
      currentLineBytes += Buffer.byteLength(line, "utf-8") + 1;
      if (currentLineBytes > MAX_LINE_BYTES) {
        void sendJson(socket, makeError(null, INVALID_REQUEST, "Request too large"));
        socket.destroy();
        return;
      }
      // Execute each command independently to avoid blocking the read loop with long-running handlers
      void writerStorage.run(socket, () => this._handleLine(line, socket));
    });

    rl.on("close", () => {
      this._activeSockets.delete(socket);
      socket.destroy();
    });

    socket.on("error", () => {
      this._activeSockets.delete(socket);
      rl.close();
    });
  }

  // Parse a single JSON-RPC request line and call the corresponding handler, write result or error back to client
  private async _handleLine(line: string, socket: net.Socket): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (e) {
      await sendJson(socket, makeError(null, PARSE_ERROR, `Parse error: ${String(e)}`));
      return;
    }

    const reqResult = JsonRpcRequestSchema.safeParse(parsed);
    if (!reqResult.success) {
      await sendJson(socket, makeError(null, INVALID_REQUEST, "Invalid Request"));
      return;
    }

    const req = reqResult.data;

    // Trace: CLIENT->CORE command
    if (this._trace) {
      this._trace.emit({
        ts: new Date().toISOString(),
        direction: "CLIENT→CORE",
        layer: "ipc",
        kind: "command",
        run_id: null,
        step: null,
        client_id: null,
        data: { method: req.method, params: req.params },
      });
    }

    const handler = this._handlers.get(req.method);
    if (!handler) {
      const errorResponse = makeError(req.id, METHOD_NOT_FOUND, `Method not found: ${req.method}`);
      // Trace: CORE->CLIENT error
      if (this._trace) {
        this._trace.emit({
          ts: new Date().toISOString(),
          direction: "CORE→CLIENT",
          layer: "ipc",
          kind: "error",
          run_id: null,
          step: null,
          client_id: null,
          data: { method: req.method, error: "method_not_found" },
        });
      }
      await sendJson(socket, errorResponse);
      return;
    }

    try {
      const result = await handler(req.params);
      const response: JsonRpcSuccess = {
        jsonrpc: "2.0",
        id: req.id,
        result,
      };
      // Trace: CORE->CLIENT response
      if (this._trace) {
        this._trace.emit({
          ts: new Date().toISOString(),
          direction: "CORE→CLIENT",
          layer: "ipc",
          kind: "response",
          run_id: null,
          step: null,
          client_id: null,
          data: { method: req.method },
        });
      }
      await sendJson(socket, response);
    } catch (e) {
      // Trace: CORE->CLIENT handler error
      if (this._trace) {
        this._trace.emit({
          ts: new Date().toISOString(),
          direction: "CORE→CLIENT",
          layer: "ipc",
          kind: "error",
          run_id: null,
          step: null,
          client_id: null,
          data: {
            method: req.method,
            error: e instanceof Error ? e.message : String(e),
          },
        });
      }
      if (e instanceof HandlerError) {
        await sendJson(socket, makeError(req.id, e.code, e.message, e.data));
      } else if (e instanceof Error) {
        console.error(`handler ${req.method} raised:`, e);
        await sendJson(socket, makeError(req.id, INTERNAL_ERROR, "Internal error"));
      }
    }
  }
}
