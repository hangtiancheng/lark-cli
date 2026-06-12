// Feature: Verify SocketServer basic start/stop and connection cleanup
// Design: Use real TCP connections to verify server lifecycle behavior
import net from "node:net";

import { afterEach, describe, expect, test } from "vitest";

import { SocketServer } from "../../src/core/transport/socket-server.js";
import { isRecord } from "../../src/core/bus/envelope.js";

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

describe("SocketServer", () => {
  let server: SocketServer | null = null;

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = null;
    }
  });

  // Feature: Verify SocketServer can start and stop without broadcaster
  // Design: Instantiate SocketServer(host, port) directly, pass if start/stop don't throw
  test("server starts and stops without error", async () => {
    const port = await freePort();
    server = new SocketServer("127.0.0.1", port);
    const addr = await server.start();
    expect(addr).toBe(`127.0.0.1:${String(port)}`);
  });

  // Feature: Verify registered handler correctly processes ping request
  // Design: Start server, send JSON-RPC ping frame via raw TCP, verify pong response format
  test("registered handler processes ping request", async () => {
    const port = await freePort();
    server = new SocketServer("127.0.0.1", port);
    server.register("core.ping", () =>
      Promise.resolve({
        server_version: "0.0.1",
        uptime_ms: 100,
        received_at: new Date().toISOString(),
      }),
    );
    await server.start();

    const response = await new Promise<string>((resolve, reject) => {
      const socket = net.createConnection(port, "127.0.0.1", () => {
        const req = JSON.stringify({
          jsonrpc: "2.0",
          id: "test-1",
          method: "core.ping",
          params: { client: "test" },
        });
        socket.write(req + "\n");
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
    });

    const resp = parseResponse(response);
    expect(resp["jsonrpc"]).toBe("2.0");
    expect(resp["id"]).toBe("test-1");
    expect(resp["result"]).toBeDefined();
    const result = getResult(resp);
    expect(result["server_version"]).toBe("0.0.1");
  });

  // Feature: Verify METHOD_NOT_FOUND error code (-32601) for unregistered methods
  // Design: Send request for unregistered method, check exact JSON-RPC error code
  test("unknown method returns METHOD_NOT_FOUND", async () => {
    const port = await freePort();
    server = new SocketServer("127.0.0.1", port);
    await server.start();

    const response = await new Promise<string>((resolve, reject) => {
      const socket = net.createConnection(port, "127.0.0.1", () => {
        const req = JSON.stringify({
          jsonrpc: "2.0",
          id: "test-2",
          method: "core.nonexistent",
          params: {},
        });
        socket.write(req + "\n");
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
    });

    const resp = parseResponse(response);
    expect(resp["error"]).toBeDefined();
    const error = getError(resp);
    expect(error["code"]).toBe(-32601);
  });

  // Feature: Verify PARSE_ERROR (-32700) for non-JSON data without crashing
  // Design: Send raw text instead of JSON, check error code
  test("invalid JSON returns PARSE_ERROR", async () => {
    const port = await freePort();
    server = new SocketServer("127.0.0.1", port);
    await server.start();

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
    });

    const resp = parseResponse(response);
    expect(resp["error"]).toBeDefined();
    const error = getError(resp);
    expect(error["code"]).toBe(-32700);
  });
});
