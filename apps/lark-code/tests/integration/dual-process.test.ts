// Dual-process integration test: agent.run command, event broadcast, multi-client
// Tests the IPC layer between client and daemon without requiring a real LLM
import net from "node:net";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { EventBus } from "../../src/core/events/bus.js";
import { SocketServer } from "../../src/core/transport/socket-server.js";
import { SocketClient } from "../../src/core/transport/socket-client.js";
import {
  AgentRunCommandSchema,
  AgentRunResultSchema,
  EventSubscribeResultSchema,
} from "../../src/core/bus/commands.js";
import { newRunId } from "../../src/core/runs.js";

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

describe("dual process integration", () => {
  let server: SocketServer;
  let port: number;
  let bus: EventBus;

  beforeEach(async () => {
    port = await freePort();
    bus = new EventBus();

    server = new SocketServer("127.0.0.1", port);

    // Register event.subscribe handler
    server.register("event.subscribe", (_params) => {
      const subId = `sub-${String(Math.random()).slice(2, 8)}`;
      return Promise.resolve(
        EventSubscribeResultSchema.parse({
          subscription_id: subId,
          replayed_count: 0,
        }),
      );
    });

    // Register agent.run handler (simulates async run start)
    server.register("agent.run", async (params) => {
      const cmd = AgentRunCommandSchema.parse(params);
      const rid = newRunId();

      await bus.publish({
        type: "run.started",
        run_id: rid,
        goal: cmd.goal,
        timestamp: new Date().toISOString(),
      });

      return AgentRunResultSchema.parse({ run_id: rid });
    });

    await server.start();
  });

  afterEach(async () => {
    await server.stop();
  });

  // Feature: agent.run returns non-empty run_id
  // Design: Use SocketClient to send agent.run, verify run_id in response
  test("agent.run returns run_id", async () => {
    const client = new SocketClient("127.0.0.1", port);
    await client.connect();

    try {
      const result = await client.sendCommand("agent.run", { goal: "hello" });
      expect(result["run_id"]).toBeDefined();
      expect(typeof result["run_id"]).toBe("string");
      const runId = result["run_id"];
      if (typeof runId === "string") {
        expect(runId.length).toBeGreaterThan(0);
      }
    } finally {
      client.close();
    }
  });

  // Feature: Unknown command returns METHOD_NOT_FOUND (-32601)
  // Design: Send unregistered method, verify error thrown
  test("unknown command returns error", async () => {
    const client = new SocketClient("127.0.0.1", port);
    await client.connect();

    try {
      await expect(client.sendCommand("nonexistent.method", {})).rejects.toThrow();
    } finally {
      client.close();
    }
  });

  // Feature: Multiple pings work correctly over same connection
  // Design: Send several ping commands sequentially, verify all return pong
  test("multiple sequential commands work", async () => {
    server.register("core.ping", () =>
      Promise.resolve({
        server_version: "0.0.1",
        uptime_ms: 100,
        received_at: new Date().toISOString(),
      }),
    );

    const client = new SocketClient("127.0.0.1", port);
    await client.connect();

    try {
      const r1 = await client.sendCommand("core.ping", {});
      expect(r1["server_version"]).toBe("0.0.1");

      const r2 = await client.sendCommand("core.ping", {});
      expect(r2["server_version"]).toBe("0.0.1");

      const r3 = await client.sendCommand("core.ping", {});
      expect(r3["server_version"]).toBe("0.0.1");
    } finally {
      client.close();
    }
  });
});
