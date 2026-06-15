import { describe, expect, test, beforeEach, afterEach } from "vitest";
import { StdoutPrinter } from "../../src/cli/commands/run.js";

describe("StdoutPrinter", () => {
  let logCalls: string[];
  let errorCalls: string[];
  let writeCalls: string[];
  let origLog: typeof console.log;
  let origError: typeof console.error;
  let printer: StdoutPrinter;

  beforeEach(() => {
    logCalls = [];
    errorCalls = [];
    writeCalls = [];
    origLog = console.log;
    origError = console.error;
    console.log = (...args: unknown[]) => {
      const first = args[0];
      logCalls.push(typeof first === "string" ? first : JSON.stringify(first));
    };
    console.error = (...args: unknown[]) => {
      const first = args[0];
      errorCalls.push(typeof first === "string" ? first : JSON.stringify(first));
    };
    printer = new StdoutPrinter((chunk: string) => {
      writeCalls.push(chunk);
    });
  });

  afterEach(() => {
    console.log = origLog;
    console.error = origError;
  });

  // Feature: run.started event prints run ID
  // Design: Send run.started event, verify console output
  test("handles run.started", () => {
    printer.handle({ type: "run.started", run_id: "abc123" });
    expect(logCalls).toContain("[run] abc123");
  });

  // Feature: step.started event prints step number
  // Design: Send step.started event, verify output
  test("handles step.started", () => {
    printer.handle({ type: "step.started", step: 3 });
    expect(logCalls).toContain("[step 3] planning...");
  });

  // Feature: llm.token writes inline via injected writer
  // Design: Send token event, verify writer called
  test("handles llm.token inline", () => {
    printer.handle({ type: "llm.token", token: "Hello" });
    expect(writeCalls).toContain("Hello");
  });

  // Feature: tool.call_started prints tool name
  // Design: Send tool.call_started, verify output with tool_name
  test("handles tool.call_started", () => {
    printer.handle({ type: "tool.call_started", tool_name: "bash" });
    expect(logCalls).toContain("[tool] bash");
  });

  // Feature: tool.call_finished prints tool name and elapsed time
  // Design: Send tool.call_finished, verify output includes elapsed_ms
  test("handles tool.call_finished", () => {
    printer.handle({
      type: "tool.call_finished",
      tool_name: "read_file",
      elapsed_ms: 42,
    });
    expect(logCalls).toContain("[tool] read_file ok 42ms");
  });

  // Feature: tool.call_failed prints error to stderr
  // Design: Send tool.call_failed, verify console.error called
  test("handles tool.call_failed", () => {
    printer.handle({
      type: "tool.call_failed",
      tool_name: "bash",
      error_message: "command not found",
    });
    expect(errorCalls).toContain("[tool] bash FAIL command not found");
  });

  // Feature: run.finished prints status summary with elapsed time
  // Design: Send run.started then run.finished, verify summary
  test("handles run.finished with elapsed time", () => {
    printer.handle({ type: "run.started", run_id: "r1" });
    printer.handle({
      type: "run.finished",
      status: "success",
      steps: 5,
    });
    const lastCall = logCalls[logCalls.length - 1] ?? "";
    expect(lastCall).toMatch(/\[run\] success 5 steps/);
  });

  // Feature: inline tokens followed by non-token event inserts newline
  // Design: Send token then step.finished, verify newline is inserted
  test("ensureNewline after inline tokens", () => {
    printer.handle({ type: "llm.token", token: "text" });
    printer.handle({ type: "step.finished", step: 1 });
    expect(writeCalls).toContain("\n");
  });

  // Feature: unknown event types are silently ignored
  // Design: Send unknown event, verify no output
  test("ignores unknown event types", () => {
    printer.handle({ type: "unknown.event" });
    expect(logCalls).toHaveLength(0);
    expect(errorCalls).toHaveLength(0);
  });
});
