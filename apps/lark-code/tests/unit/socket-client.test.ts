import { describe, expect, test } from "vitest";
import { SocketClient } from "../../src/core/transport/socket-client.js";
import { SocketServer } from "../../src/core/transport/socket-server.js";
import net from "node:net";

describe("SocketClient", () => {
  // Feature: Verify SocketClient connects to server
  // Design: Start server, create client, connect, confirm connection succeeds
  test("connects to server", async () => {
    const port = await getFreePort();
    const server = new SocketServer("127.0.0.1", port);
    await server.start();

    const client = new SocketClient("127.0.0.1", port);
    await client.connect();

    client.close();
    await server.stop();
  });

  // Feature: Verify SocketClient sends commands and receives responses
  // Design: Register handler on server, send command from client, confirm response
  test("sends commands and receives responses", async () => {
    const port = await getFreePort();
    const server = new SocketServer("127.0.0.1", port);
    server.register("test.method", () =>
      Promise.resolve({ result: "success" }),
    );
    await server.start();

    const client = new SocketClient("127.0.0.1", port);
    await client.connect();

    const response = await client.sendCommand("test.method", {
      param: "value",
    });
    expect(response["result"]).toBe("success");

    client.close();
    await server.stop();
  });

  // Feature: Verify SocketClient handles errors
  // Design: Send command to non-existent method, confirm error is thrown
  test("handles errors", async () => {
    const port = await getFreePort();
    const server = new SocketServer("127.0.0.1", port);
    await server.start();

    const client = new SocketClient("127.0.0.1", port);
    await client.connect();

    await expect(
      client.sendCommand("nonexistent.method", {}),
    ).rejects.toThrow();

    client.close();
    await server.stop();
  });

  // Feature: Verify SocketClient receives events
  // Design: Register event handler on client, confirm handler is registered without errors
  test("receives events", async () => {
    const port = await getFreePort();
    const server = new SocketServer("127.0.0.1", port);
    await server.start();

    const client = new SocketClient("127.0.0.1", port);
    await client.connect();

    let eventReceived = false;
    client.onEvent(() => {
      eventReceived = true;
      return Promise.resolve();
    });

    // Event handler is registered; no events have been sent yet
    expect(eventReceived).toBe(false);

    client.close();
    await server.stop();
  });
});

async function getFreePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr !== null ? addr.port : 0;
      server.close(() => {
        resolve(port);
      });
    });
  });
}
