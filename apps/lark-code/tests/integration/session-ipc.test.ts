// Session IPC integration test: session.create, session.get_history, session.close over raw TCP
import net from "node:net";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { EventBus } from "../../src/core/events/bus.js";
import { isRecord } from "../../src/core/bus/envelope.js";
import { SocketServer } from "../../src/core/transport/socket-server.js";
import { SessionManager } from "../../src/core/session/manager.js";
import { SessionStore } from "../../src/core/session/store.js";
import {
  SessionCreateCommandSchema,
  SessionCreateResultSchema,
  SessionGetHistoryCommandSchema,
  SessionGetHistoryResultSchema,
  SessionCloseCommandSchema,
  SessionCloseResultSchema,
} from "../../src/core/bus/commands.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

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

function sendRequest(
  port: number,
  req: Record<string, unknown>,
): Promise<string> {
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

function parseResult(raw: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed)) throw new Error("invalid response");
  const result = parsed["result"];
  if (!isRecord(result)) throw new Error("missing result");
  return result;
}

describe("session IPC integration", () => {
  let server: SocketServer;
  let port: number;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "lark-session-test-"));
    port = await freePort();

    const store = new SessionStore(tmpDir);
    const bus = new EventBus();
    const manager = new SessionManager(
      store,
      () => ({
        runAndCapture: () =>
          Promise.resolve({
            status: "success",
            result: "",
            reason: null,
          }),
      }),
      bus,
    );

    server = new SocketServer("127.0.0.1", port);

    server.register("session.create", async (params) => {
      const cmd = SessionCreateCommandSchema.parse(params);
      const session = await manager.create(cmd.mode, cmd.title);
      return SessionCreateResultSchema.parse({
        session_id: session.id,
        status: session.status,
      });
    });

    server.register("session.get_history", (params) => {
      const cmd = SessionGetHistoryCommandSchema.parse(params);
      const messages = manager.getHistory(cmd.session_id);
      return Promise.resolve(SessionGetHistoryResultSchema.parse({ messages }));
    });

    server.register("session.close", async (params) => {
      const cmd = SessionCloseCommandSchema.parse(params);
      await manager.close(cmd.session_id);
      return SessionCloseResultSchema.parse({ status: "closed" });
    });

    await server.start();
  });

  afterEach(async () => {
    await server.stop();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // Feature: session.create returns session_id and active status
  // Design: Send session.create over TCP, verify response fields
  test("session.create returns session_id and status", async () => {
    const result = parseResult(
      await sendRequest(port, {
        jsonrpc: "2.0",
        id: "create-1",
        method: "session.create",
        params: { mode: "chat", title: "ipc test" },
      }),
    );

    expect(result["session_id"]).toBeDefined();
    expect(typeof result["session_id"]).toBe("string");
    expect(result["status"]).toBe("active");
  });

  // Feature: session.get_history returns empty messages for new session
  // Design: Create session, get history, verify empty
  test("session.get_history returns empty for new session", async () => {
    const createResult = parseResult(
      await sendRequest(port, {
        jsonrpc: "2.0",
        id: "create-2",
        method: "session.create",
        params: { mode: "chat" },
      }),
    );
    const sessionId = createResult["session_id"];

    const historyResult = parseResult(
      await sendRequest(port, {
        jsonrpc: "2.0",
        id: "history-1",
        method: "session.get_history",
        params: { session_id: sessionId },
      }),
    );

    expect(historyResult["messages"]).toEqual([]);
  });

  // Feature: session.close sets status to closed
  // Design: Create then close session, verify status
  test("session.close sets status to closed", async () => {
    const createResult = parseResult(
      await sendRequest(port, {
        jsonrpc: "2.0",
        id: "create-3",
        method: "session.create",
        params: { mode: "chat" },
      }),
    );
    const sessionId = createResult["session_id"];

    const closeResult = parseResult(
      await sendRequest(port, {
        jsonrpc: "2.0",
        id: "close-1",
        method: "session.close",
        params: { session_id: sessionId },
      }),
    );

    expect(closeResult["status"]).toBe("closed");
  });
});
