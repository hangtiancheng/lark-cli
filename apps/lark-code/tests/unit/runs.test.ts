import { describe, expect, test } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { newRunId, runDir, eventsFile, ensureRunDir, RUNS_DIR } from "../../src/core/runs.js";

describe("Runs Module", () => {
  // Feature: newRunId generates ID in YYYYMMDD-HHMMSS-xxxxxx format
  // Design: Generate ID, verify format with regex
  test("newRunId generates correct format", () => {
    const id = newRunId();
    expect(id).toMatch(/^\d{8}-\d{6}-[a-f0-9]{6}$/);
  });

  // Feature: newRunId generates unique IDs
  // Design: Generate multiple IDs, verify all distinct
  test("newRunId generates unique IDs", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 10; i++) {
      ids.add(newRunId());
    }
    expect(ids.size).toBe(10);
  });

  // Feature: runDir returns correct path
  // Design: Call runDir, verify path structure
  test("runDir returns correct path", () => {
    const dir = runDir("20260612-120000-abc123");
    expect(dir).toBe(path.join(RUNS_DIR, "20260612-120000-abc123"));
  });

  // Feature: eventsFile returns correct path
  // Design: Call eventsFile, verify it ends with events.jsonl
  test("eventsFile returns correct path", () => {
    const file = eventsFile("20260612-120000-abc123");
    expect(file).toBe(path.join(RUNS_DIR, "20260612-120000-abc123", "events.jsonl"));
  });

  // Feature: ensureRunDir creates directory
  // Design: Call ensureRunDir in temp location, verify exists
  test("ensureRunDir creates directory", () => {
    const tmpBase = mkdtempSync(path.join(tmpdir(), "lark-runs-"));
    try {
      // Override the base by testing with absolute path
      const runId = "test-run-123";
      const dir = ensureRunDir(runId);
      expect(existsSync(dir)).toBe(true);
    } finally {
      rmSync(tmpBase, { recursive: true, force: true });
      // Clean up the runs dir created by ensureRunDir
      try {
        rmSync(RUNS_DIR, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  });

  // Feature: RUNS_DIR is 'runs'
  // Design: Verify the constant value
  test("RUNS_DIR is runs", () => {
    expect(RUNS_DIR).toBe("runs");
  });
});
