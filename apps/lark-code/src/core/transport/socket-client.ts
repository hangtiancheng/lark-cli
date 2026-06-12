// TCP client: connect to core daemon, send commands and receive events
import net from "node:net";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";

import type { JsonRpcRequest } from "../bus/envelope.js";
import { isRecord } from "../bus/envelope.js";

export type EventHandler = (event: Record<string, unknown>) => Promise<void>;

// IPC error: JSON-RPC error response
export class IpcError extends Error {
  readonly code: number;

  constructor(code: number, message: string) {
    super(`[${String(code)}] ${message}`);
    this.name = "IpcError";
    this.code = code;
  }
}

export class SocketClient {
  private _host: string;
  private _port: number;
  private _socket: net.Socket | null = null;
  private _pending = new Map<
    string,
    {
      resolve: (v: Record<string, unknown>) => void;
      reject: (e: Error) => void;
    }
  >();
  private _eventHandlers: EventHandler[] = [];

  constructor(host: string, port: number) {
    this._host = host;
    this._port = port;
  }

  // Establish TCP connection to core daemon and start reading messages
  async connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this._socket = net.createConnection(this._port, this._host, () => {
        this._startReading();
        resolve();
      });
      this._socket.on("error", reject);
    });
  }

  // Start reading lines from the socket and dispatching responses/events
  private _startReading(): void {
    if (!this._socket) return;

    const rl = createInterface({
      input: this._socket,
      terminal: false,
    });

    rl.on("line", (line) => {
      void this._dispatch(line);
    });

    rl.on("close", () => {
      for (const [, pending] of this._pending) {
        pending.reject(new Error("connection closed"));
      }
      this._pending.clear();
    });
  }

  // Close TCP connection
  close(): void {
    if (this._socket) {
      this._socket.destroy();
      this._socket = null;
    }
  }

  // Register callback for server-pushed events
  onEvent(handler: EventHandler): void {
    this._eventHandlers.push(handler);
  }

  // Send JSON-RPC command and wait for response
  async sendCommand(
    method: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (!this._socket) {
      throw new Error("not connected - call connect() first");
    }

    const reqId = randomUUID();
    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: reqId,
      method,
      params,
    };

    const { promise, resolve, reject } =
      Promise.withResolvers<Record<string, unknown>>();
    this._pending.set(reqId, { resolve, reject });

    this._socket.write(JSON.stringify(request) + "\n", "utf-8");
    return promise;
  }

  // Continuously read server messages, dispatch RPC responses or events
  async runEventLoop(): Promise<void> {
    if (!this._socket) {
      throw new Error("not connected - call connect() first");
    }

    const rl = createInterface({
      input: this._socket,
      terminal: false,
    });

    return new Promise<void>((resolve) => {
      rl.on("line", (line) => {
        void this._dispatch(line);
      });

      rl.on("close", () => {
        // Connection closed, cancel all pending requests
        for (const [, pending] of this._pending) {
          pending.reject(new Error("connection closed"));
        }
        this._pending.clear();
        resolve();
      });
    });
  }

  // Parse a single message line and route to pending promise or event handler
  private async _dispatch(line: string): Promise<void> {
    let msg: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(line);
      if (!isRecord(parsed)) return;
      msg = parsed;
    } catch {
      return;
    }

    if ("jsonrpc" in msg) {
      const reqIdRaw = msg["id"];
      const reqId = typeof reqIdRaw === "string" ? reqIdRaw : undefined;
      if (reqId && this._pending.has(reqId)) {
        const pending = this._pending.get(reqId);
        if (!pending) return;
        this._pending.delete(reqId);
        if ("error" in msg) {
          const errRaw = msg["error"];
          const errObj =
            typeof errRaw === "object" && errRaw !== null ? errRaw : null;
          const errCode = errObj && "code" in errObj ? errObj.code : undefined;
          const errMsg =
            errObj && "message" in errObj ? errObj.message : undefined;
          pending.reject(
            new IpcError(
              typeof errCode === "number" ? errCode : -1,
              typeof errMsg === "string" ? errMsg : "unknown",
            ),
          );
        } else {
          const result = msg["result"];
          pending.resolve(isRecord(result) ? result : {});
        }
      }
    } else if (msg["kind"] === "event") {
      const eventData = msg["event"];
      if (isRecord(eventData)) {
        for (const handler of this._eventHandlers) {
          await handler(eventData);
        }
      }
    }
  }
}
