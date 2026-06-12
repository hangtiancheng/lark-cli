import { describe, expect, test } from "vitest";
import { SessionManager } from "../../src/core/session/manager.js";
import { SessionStore } from "../../src/core/session/store.js";
import { EventBus } from "../../src/core/events/bus.js";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

describe("SessionManager", () => {
  // Feature: Verify SessionManager creates sessions
  // Design: Create session, confirm it's returned with correct ID
  test("creates sessions", async () => {
    const dir = path.join(tmpdir(), `test-session-mgr-${String(Date.now())}`);
    mkdirSync(dir, { recursive: true });
    const store = new SessionStore(dir);
    const bus = new EventBus();
    const runnerFactory = () => ({
      runAndCapture: async () => {
        await Promise.resolve();
        return { status: "success", result: "", reason: null };
      },
    });
    const manager = new SessionManager(store, runnerFactory, bus);

    const session = await manager.create("chat", "Test Session");
    expect(session.title).toBe("Test Session");
    expect(session.mode).toBe("chat");
    expect(session.status).toBe("active");
    rmSync(dir, { recursive: true });
  });

  // Feature: Verify SessionManager sends messages
  // Design: Create session, send message, confirm message is stored
  test("sends messages", async () => {
    const dir = path.join(tmpdir(), `test-session-mgr-${String(Date.now())}`);
    mkdirSync(dir, { recursive: true });
    const store = new SessionStore(dir);
    const bus = new EventBus();
    const runnerFactory = () => ({
      runAndCapture: async () => {
        await Promise.resolve();
        return { status: "success", result: "", reason: null };
      },
    });
    const manager = new SessionManager(store, runnerFactory, bus);

    const session = await manager.create("chat", "Test Session");
    const runId = await manager.sendMessage(session.id, "Hello");

    expect(runId).toBeDefined();
    const messages = store.readMessages(session.id);
    expect(messages.length).toBeGreaterThan(0);
    rmSync(dir, { recursive: true });
  });

  // Feature: Verify SessionManager closes sessions
  // Design: Create session, close it, confirm status is closed
  test("closes sessions", async () => {
    const dir = path.join(tmpdir(), `test-session-mgr-${String(Date.now())}`);
    mkdirSync(dir, { recursive: true });
    const store = new SessionStore(dir);
    const bus = new EventBus();
    const runnerFactory = () => ({
      runAndCapture: async () => {
        await Promise.resolve();
        return { status: "success", result: "", reason: null };
      },
    });
    const manager = new SessionManager(store, runnerFactory, bus);

    const session = await manager.create("chat", "Test Session");
    await manager.close(session.id);

    const meta = store.readMeta(session.id);
    expect(meta.status).toBe("closed");
    rmSync(dir, { recursive: true });
  });

  // Feature: Verify SessionManager gets history
  // Design: Create session, send messages, get history, confirm messages are returned
  test("gets history", async () => {
    const dir = path.join(tmpdir(), `test-session-mgr-${String(Date.now())}`);
    mkdirSync(dir, { recursive: true });
    const store = new SessionStore(dir);
    const bus = new EventBus();
    const runnerFactory = () => ({
      runAndCapture: async () => {
        await Promise.resolve();
        return { status: "success", result: "", reason: null };
      },
    });
    const manager = new SessionManager(store, runnerFactory, bus);

    const session = await manager.create("chat", "Test Session");
    await manager.sendMessage(session.id, "Message 1");
    await manager.sendMessage(session.id, "Message 2");

    const history = manager.getHistory(session.id);
    expect(history.length).toBeGreaterThan(0);
    rmSync(dir, { recursive: true });
  });

  // Feature: Verify SessionManager publishes events
  // Design: Create session, confirm session.created event is published
  test("publishes events", async () => {
    const dir = path.join(tmpdir(), `test-session-mgr-${String(Date.now())}`);
    mkdirSync(dir, { recursive: true });
    const store = new SessionStore(dir);
    const bus = new EventBus();
    const runnerFactory = () => ({
      runAndCapture: async () => {
        await Promise.resolve();
        return { status: "success", result: "", reason: null };
      },
    });
    const manager = new SessionManager(store, runnerFactory, bus);

    const events: string[] = [];
    bus.subscribe((event) => {
      events.push(event.type);
      return Promise.resolve();
    });

    await manager.create("chat", "Test Session");
    expect(events).toContain("session.created");
    rmSync(dir, { recursive: true });
  });
});
