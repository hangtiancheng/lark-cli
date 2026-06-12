import { describe, expect, test } from "vitest";
import { NoteSaveTool } from "../../src/core/tools/builtin/note-save.js";
import { SessionStore } from "../../src/core/session/store.js";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

describe("NoteSaveTool", () => {
  // Feature: Verify NoteSaveTool saves notes
  // Design: Create tool with session store, save note, confirm it's stored
  test("saves notes", async () => {
    const dir = path.join(tmpdir(), `test-notes-${String(Date.now())}`);
    mkdirSync(dir, { recursive: true });
    const store = new SessionStore(dir);
    const sessionId = "session-1";
    const runId = "run-1";

    const tool = new NoteSaveTool(store, sessionId, runId);
    const result = await tool.invoke({ content: "Important note" });
    expect(result.isError).toBe(false);
    expect(result.content).toBe("saved");

    const notes = store.readNotes(sessionId);
    expect(notes).toContain("Important note");
    rmSync(dir, { recursive: true });
  });

  // Feature: Verify NoteSaveTool rejects empty content
  // Design: Save empty note, confirm error
  test("rejects empty content", async () => {
    const dir = path.join(tmpdir(), `test-notes-${String(Date.now())}`);
    mkdirSync(dir, { recursive: true });
    const store = new SessionStore(dir);
    const sessionId = "session-1";
    const runId = "run-1";

    const tool = new NoteSaveTool(store, sessionId, runId);
    const result = await tool.invoke({ content: "" });
    expect(result.isError).toBe(true);
    expect(result.content).toContain("empty");
    rmSync(dir, { recursive: true });
  });

  // Feature: Verify NoteSaveTool trims whitespace
  // Design: Save note with whitespace, confirm it's trimmed
  test("trims whitespace", async () => {
    const dir = path.join(tmpdir(), `test-notes-${String(Date.now())}`);
    mkdirSync(dir, { recursive: true });
    const store = new SessionStore(dir);
    const sessionId = "session-1";
    const runId = "run-1";

    const tool = new NoteSaveTool(store, sessionId, runId);
    const result = await tool.invoke({ content: "  trimmed note  " });
    expect(result.isError).toBe(false);

    const notes = store.readNotes(sessionId);
    expect(notes).toContain("trimmed note");
    rmSync(dir, { recursive: true });
  });
});
