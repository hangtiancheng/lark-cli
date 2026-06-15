import { describe, expect, test } from "vitest";
import { TracingProvider } from "../../src/core/trace/provider.js";
import type { LLMProvider } from "../../src/core/llm/base.js";
import { TraceWriter } from "../../src/core/trace/writer.js";
import { EventBus } from "../../src/core/events/bus.js";
import { readFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (isRecord(value)) {
    return value;
  }
  if (Array.isArray(value)) {
    return Object.fromEntries(value.entries());
  }
  return {};
}

describe("TracingProvider", () => {
  // Feature: Verify TracingProvider wraps LLMProvider and writes trace records
  // Design: Create TracingProvider with mock provider, call chat(), confirm trace records are written
  test("writes trace records for chat calls", async () => {
    const dir = path.join(tmpdir(), `test-trace-${String(Date.now())}`);
    mkdirSync(dir, { recursive: true });
    const tracePath = path.join(dir, "trace.jsonl");
    const writer = new TraceWriter(tracePath);
    writer.start();

    const mockProvider: LLMProvider = {
      chat: () =>
        Promise.resolve({
          stopReason: "end_turn",
          toolUses: [],
          text: "response",
          usage: {
            inputTokens: 100,
            outputTokens: 50,
            cacheReadInputTokens: 0,
            cacheCreationInputTokens: 0,
            contextPercent: 5,
          },
          thinkingBlocks: [],
        }),
    };

    const tracer = new TracingProvider(mockProvider, writer, true);
    const bus = new EventBus();

    await tracer.chat([{ role: "user", content: "test" }], [], bus, "r1", {
      step: 1,
    });

    void writer.stop();

    const content = readFileSync(tracePath, "utf-8");
    expect(content).toContain("CORE→LLM");
    expect(content).toContain("LLM→CORE");
    rmSync(dir, { recursive: true });
  });

  // Feature: Verify TracingProvider passes through to wrapped provider
  // Design: Call chat() on TracingProvider, confirm wrapped provider is called with same arguments
  test("passes through to wrapped provider", async () => {
    const dir = path.join(tmpdir(), `test-trace-${String(Date.now())}`);
    mkdirSync(dir, { recursive: true });
    const tracePath = path.join(dir, "trace.jsonl");
    const writer = new TraceWriter(tracePath);
    writer.start();

    let capturedMessages: unknown[] = [];
    const mockProvider: LLMProvider = {
      chat: (messages) => {
        capturedMessages = messages;
        return Promise.resolve({
          stopReason: "end_turn",
          toolUses: [],
          text: "response",
          usage: {
            inputTokens: 100,
            outputTokens: 50,
            cacheReadInputTokens: 0,
            cacheCreationInputTokens: 0,
            contextPercent: 5,
          },
          thinkingBlocks: [],
        });
      },
    };

    const tracer = new TracingProvider(mockProvider, writer, false);
    const bus = new EventBus();
    const testMessages = [{ role: "user" as const, content: "test message" }];

    await tracer.chat(testMessages, [], bus, "r1");

    // Verify the wrapped provider received the actual messages
    expect(capturedMessages).toHaveLength(1);
    expect(asRecord(capturedMessages[0])["role"]).toBe("user");
    expect(asRecord(capturedMessages[0])["content"]).toBe("test message");
    void writer.stop();
    rmSync(dir, { recursive: true });
  });

  // Feature: Verify TracingProvider includes payload in trace when enabled
  // Design: Create with includeLlmPayload=true, verify trace contains the actual request
  test("includes payload in trace when enabled", async () => {
    const dir = path.join(tmpdir(), `test-trace-${String(Date.now())}`);
    mkdirSync(dir, { recursive: true });
    const tracePath = path.join(dir, "trace.jsonl");
    const writer = new TraceWriter(tracePath);
    writer.start();

    const mockProvider: LLMProvider = {
      chat: () =>
        Promise.resolve({
          stopReason: "end_turn",
          toolUses: [],
          text: "response",
          usage: {
            inputTokens: 100,
            outputTokens: 50,
            cacheReadInputTokens: 0,
            cacheCreationInputTokens: 0,
            contextPercent: 5,
          },
          thinkingBlocks: [],
        }),
    };

    const tracer = new TracingProvider(mockProvider, writer, true);
    const bus = new EventBus();

    await tracer.chat([{ role: "user", content: "hello world" }], [], bus, "r1", {
      step: 1,
    });

    void writer.stop();

    const content = readFileSync(tracePath, "utf-8");
    expect(content).toContain("hello world"); // Payload included
    rmSync(dir, { recursive: true });
  });

  // Feature: Verify TracingProvider excludes payload when disabled
  // Design: Create with includeLlmPayload=false, verify trace omits the request body
  test("excludes payload when disabled", async () => {
    const dir = path.join(tmpdir(), `test-trace-${String(Date.now())}`);
    mkdirSync(dir, { recursive: true });
    const tracePath = path.join(dir, "trace.jsonl");
    const writer = new TraceWriter(tracePath);
    writer.start();

    const mockProvider: LLMProvider = {
      chat: () =>
        Promise.resolve({
          stopReason: "end_turn",
          toolUses: [],
          text: "response",
          usage: {
            inputTokens: 100,
            outputTokens: 50,
            cacheReadInputTokens: 0,
            cacheCreationInputTokens: 0,
            contextPercent: 5,
          },
          thinkingBlocks: [],
        }),
    };

    const tracer = new TracingProvider(mockProvider, writer, false);
    const bus = new EventBus();

    await tracer.chat([{ role: "user", content: "secret message" }], [], bus, "r1");

    void writer.stop();

    const content = readFileSync(tracePath, "utf-8");
    expect(content).not.toContain("secret message"); // Payload excluded
    rmSync(dir, { recursive: true });
  });
});
