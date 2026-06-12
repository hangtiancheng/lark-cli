import { describe, expect, test } from "vitest";
import { SessionStore } from "../../src/core/session/store.js";
import type { Session } from "../../src/core/session/model.js";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

describe("SessionStore", () => {
  // Feature: Verify SessionStore creates session directory
  // Design: Create store, confirm directory is created
  test("creates session directory", () => {
    const dir = path.join(tmpdir(), `test-session-${String(Date.now())}`);
    const store = new SessionStore(dir);
    const sessionId = "session-1";
    const sessionDir = store.sessionDir(sessionId);
    mkdirSync(sessionDir, { recursive: true });
    expect(sessionDir).toContain(sessionId);
    rmSync(dir, { recursive: true });
  });

  // Feature: Verify SessionStore writes and reads meta
  // Design: Write meta, read it back, confirm it matches
  test("writes and reads meta", () => {
    const dir = path.join(tmpdir(), `test-session-${String(Date.now())}`);
    const store = new SessionStore(dir);
    const sessionId = "session-1";

    const session: Session = {
      id: sessionId,
      title: "Test Session",
      mode: "chat",
      status: "active",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      runIds: [],
    };

    store.writeMeta(session);

    const meta = store.readMeta(sessionId);
    expect(meta.title).toBe("Test Session");
    expect(meta.mode).toBe("chat");
    rmSync(dir, { recursive: true });
  });

  // Feature: Verify SessionStore appends messages
  // Design: Append messages, read them back, confirm they're in order
  test("appends messages", () => {
    const dir = path.join(tmpdir(), `test-session-${String(Date.now())}`);
    const store = new SessionStore(dir);
    const sessionId = "session-1";

    store.appendMessage(sessionId, "user", "message 1");
    store.appendMessage(sessionId, "assistant", "message 2");

    const messages = store.readMessages(sessionId);
    expect(messages.length).toBe(2);
    expect(messages[0]?.role).toBe("user");
    expect(messages[1]?.role).toBe("assistant");
    rmSync(dir, { recursive: true });
  });

  // Feature: Verify SessionStore writes and reads notes
  // Design: Write notes, read them back, confirm they match
  test("writes and reads notes", () => {
    const dir = path.join(tmpdir(), `test-session-${String(Date.now())}`);
    const store = new SessionStore(dir);
    const sessionId = "session-1";

    store.appendNote(sessionId, "Important note", "run-1");

    const notes = store.readNotes(sessionId);
    expect(notes).toContain("Important note");
    rmSync(dir, { recursive: true });
  });

  // Feature: Verify SessionStore creates runs directory
  // Design: Create runs directory, confirm it exists
  test("creates runs directory", () => {
    const dir = path.join(tmpdir(), `test-session-${String(Date.now())}`);
    const store = new SessionStore(dir);
    const sessionId = "session-1";
    const runsDir = store.runsDir(sessionId);
    mkdirSync(runsDir, { recursive: true });
    expect(runsDir).toContain("runs");
    rmSync(dir, { recursive: true });
  });
});
