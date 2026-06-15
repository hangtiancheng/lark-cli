import { describe, expect, test } from "vitest";
import { SessionManager } from "../../src/core/session/manager.js";
import { SessionStore } from "../../src/core/session/store.js";
import { EventBus } from "../../src/core/events/bus.js";
import { HandlerError } from "../../src/core/bus/envelope.js";
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

  // Feature: Verify sendMessage on closed session throws SESSION_CLOSED
  // Design: Create session, close it, try to send message, expect HandlerError with code -32011
  test("sendMessage on closed session throws SESSION_CLOSED", async () => {
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

    try {
      await manager.sendMessage(session.id, "Hello");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(HandlerError);
      if (err instanceof HandlerError) {
        expect(err.code).toBe(-32011);
      }
    }
    rmSync(dir, { recursive: true });
  });

  // Feature: Verify sendMessage on nonexistent session throws SESSION_NOT_FOUND
  // Design: Try to send message to non-existent session, expect HandlerError with code -32010
  test("sendMessage on nonexistent session throws SESSION_NOT_FOUND", async () => {
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

    try {
      await manager.sendMessage("nonexistent-session-id", "Hello");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(HandlerError);
      if (err instanceof HandlerError) {
        expect(err.code).toBe(-32010);
      }
    }
    rmSync(dir, { recursive: true });
  });

  // Feature: Verify one_shot mode auto-closes session
  // Design: Create one_shot session, send message, confirm status is closed
  test("one_shot mode auto-closes session", async () => {
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

    const session = await manager.create("one_shot", "One Shot Session");
    expect(session.status).toBe("active");

    await manager.sendMessage(session.id, "Run this task");

    const meta = store.readMeta(session.id);
    expect(meta.status).toBe("closed");
    rmSync(dir, { recursive: true });
  });

  // Feature: Verify concurrent sendMessage rejects with SESSION_BUSY
  // Design: Send two messages concurrently, second should reject with SESSION_BUSY (-32012)
  test("concurrent sendMessage rejects with SESSION_BUSY", async () => {
    const dir = path.join(tmpdir(), `test-session-mgr-${String(Date.now())}`);
    mkdirSync(dir, { recursive: true });
    const store = new SessionStore(dir);
    const bus = new EventBus();

    // Slow runner that takes 1 second
    const runnerFactory = () => ({
      runAndCapture: async () => {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        return { status: "success", result: "", reason: null };
      },
    });
    const manager = new SessionManager(store, runnerFactory, bus);

    const session = await manager.create("chat", "Test Session");

    // Start first message (will be processing for 1 second)
    const firstMsgPromise = manager.sendMessage(session.id, "First message");

    // Immediately try second message - should reject with SESSION_BUSY
    try {
      await manager.sendMessage(session.id, "Second message");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(HandlerError);
      if (err instanceof HandlerError) {
        expect(err.code).toBe(-32012);
      }
    }

    // Wait for first message to complete
    await firstMsgPromise;
    rmSync(dir, { recursive: true });
  });
});
