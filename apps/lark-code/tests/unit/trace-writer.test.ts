import { describe, expect, test } from "vitest";
import { TraceWriter } from "../../src/core/trace/writer.js";
import { readFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

describe("TraceWriter", () => {
  // Feature: Verify TraceWriter writes trace records to file
  // Design: Create writer, emit record, stop, read file, confirm record is written
  test("writes trace records to file", () => {
    const dir = path.join(tmpdir(), `test-trace-${String(Date.now())}`);
    mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, "trace.jsonl");
    const writer = new TraceWriter(filePath);
    writer.start();

    writer.emit({
      ts: new Date().toISOString(),
      direction: "CORE→LLM",
      layer: "llm",
      kind: "request",
      run_id: "r1",
      step: 1,
      client_id: "c1",
      data: { model: "claude-3", messages: [] },
    });

    void writer.stop();

    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain("CORE→LLM");
    expect(content).toContain("claude-3");
    rmSync(dir, { recursive: true });
  });

  // Feature: Verify TraceWriter creates parent directories
  // Design: Create writer with nested path, confirm directories are created
  test("creates parent directories", () => {
    const baseDir = path.join(tmpdir(), `test-trace-${String(Date.now())}`);
    const dir = path.join(baseDir, "nested");
    const filePath = path.join(dir, "trace.jsonl");
    const writer = new TraceWriter(filePath);
    writer.start();
    void writer.stop();
    rmSync(baseDir, { recursive: true });
  });

  // Feature: Verify TraceWriter handles multiple records
  // Design: Emit multiple records, stop, confirm all are written
  test("handles multiple records", () => {
    const dir = path.join(tmpdir(), `test-trace-${String(Date.now())}`);
    mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, "trace.jsonl");
    const writer = new TraceWriter(filePath);
    writer.start();

    writer.emit({
      ts: new Date().toISOString(),
      direction: "CORE→LLM",
      layer: "llm",
      kind: "request",
      run_id: "r1",
      step: 1,
      client_id: "c1",
      data: {},
    });
    writer.emit({
      ts: new Date().toISOString(),
      direction: "LLM→CORE",
      layer: "llm",
      kind: "response",
      run_id: "r1",
      step: 1,
      client_id: "c1",
      data: {},
    });

    void writer.stop();

    const content = readFileSync(filePath, "utf-8");
    const lines = content.trim().split("\n");
    expect(lines.length).toBe(2);
    rmSync(dir, { recursive: true });
  });
});
