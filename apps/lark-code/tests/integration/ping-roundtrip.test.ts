// Feature: Verify real daemon responds to core.ping command and returns PongResult
// Design: Start SocketServer instance (not subprocess), use raw TCP to send JSON-RPC frames for end-to-end validation
import net from "node:net";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { PongResultSchema } from "../../src/core/bus/commands.js";
import { isRecord } from "../../src/core/bus/envelope.js";
import { SocketServer } from "../../src/core/transport/socket-server.js";

// Get a random available port
function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const addr = s.address();
      const port = typeof addr === "object" && addr !== null ? addr.port : 0;
      s.close(() => {
        resolve(port);
      });
    });
  });
}

// Type-safe helper to parse JSON-RPC response
function parseResponse(raw: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed)) throw new Error("invalid JSON-RPC response");
  return parsed;
}

// Type-safe helper to extract result from parsed response
function getResult(resp: Record<string, unknown>): Record<string, unknown> {
  const result = resp["result"];
  if (!isRecord(result)) throw new Error("missing result in response");
  return result;
}

// Type-safe helper to extract error from parsed response
function getError(resp: Record<string, unknown>): Record<string, unknown> {
  const error = resp["error"];
  if (!isRecord(error)) throw new Error("missing error in response");
  return error;
}

// Send a raw JSON-RPC request over TCP and return the response string
function sendRequest(port: number, req: Record<string, unknown>): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(port, "127.0.0.1", () => {
      socket.write(JSON.stringify(req) + "\n");
    });
    let data = "";
    socket.on("data", (chunk: Buffer) => {
      data += chunk.toString();
      if (data.includes("\n")) {
        resolve(data.trim());
        socket.destroy();
      }
    });
    socket.on("error", reject);
    setTimeout(() => {
      reject(new Error("timeout"));
    }, 5000);
  });
}

describe("ping roundtrip integration", () => {
  let server: SocketServer;
  let port: number;

  beforeEach(async () => {
    port = await freePort();
    server = new SocketServer("127.0.0.1", port);
    server.register("core.ping", () =>
      Promise.resolve(
        PongResultSchema.parse({
          server_version: "0.0.1",
          uptime_ms: 100,
          received_at: new Date().toISOString(),
        }),
      ),
    );
    await server.start();
  });

  afterEach(async () => {
    await server.stop();
  });

  // Feature: Verify real daemon responds to core.ping with PongResult containing version, uptime, timestamp
  // Design: Send JSON-RPC frame over raw TCP connection, directly validate wire protocol end-to-end correctness
  test("ping returns pong", async () => {
    const response = await sendRequest(port, {
      jsonrpc: "2.0",
      id: "test-1",
      method: "core.ping",
      params: { client: "test/0.0.1" },
    });

    const resp = parseResponse(response);
    expect(resp["jsonrpc"]).toBe("2.0");
    expect(resp["id"]).toBe("test-1");
    expect(resp["result"]).toBeDefined();
    const result = getResult(resp);
    expect(result["server_version"]).toBe("0.0.1");
    expect(typeof result["uptime_ms"]).toBe("number");
    const uptimeMs = result["uptime_ms"];
    if (typeof uptimeMs === "number") {
      expect(uptimeMs).toBeGreaterThanOrEqual(0);
    }
    expect(result["received_at"]).toBeDefined();
  });

  // Feature: Verify METHOD_NOT_FOUND error code (-32601) for unregistered methods
  // Design: Check exact JSON-RPC error code, confirm routing failure path complies with JSON-RPC 2.0 spec
  test("unknown method returns METHOD_NOT_FOUND", async () => {
    const response = await sendRequest(port, {
      jsonrpc: "2.0",
      id: "test-2",
      method: "core.nonexistent",
      params: {},
    });

    const resp = parseResponse(response);
    expect(resp["error"]).toBeDefined();
    const error = getError(resp);
    expect(error["code"]).toBe(-32601);
  });

  // Feature: Verify PARSE_ERROR (-32700) for non-JSON data without crashing
  // Design: Send raw text instead of JSON, check error code, confirm robustness against malformed input
  test("invalid JSON returns PARSE_ERROR", async () => {
    const response = await new Promise<string>((resolve, reject) => {
      const socket = net.createConnection(port, "127.0.0.1", () => {
        socket.write("not valid json\n");
      });
      let data = "";
      socket.on("data", (chunk: Buffer) => {
        data += chunk.toString();
        if (data.includes("\n")) {
          resolve(data.trim());
          socket.destroy();
        }
      });
      socket.on("error", reject);
      setTimeout(() => {
        reject(new Error("timeout"));
      }, 5000);
    });

    const resp = parseResponse(response);
    expect(resp["error"]).toBeDefined();
    const error = getError(resp);
    expect(error["code"]).toBe(-32700);
  });
});
