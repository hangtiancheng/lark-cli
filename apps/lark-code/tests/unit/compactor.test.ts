import { describe, expect, test } from "vitest";
import { Compactor } from "../../src/core/compact/compactor.js";
import { EventBus } from "../../src/core/events/bus.js";
import { ExecutionContext } from "../../src/core/context.js";
import type { LLMProvider } from "../../src/core/llm/base.js";
import type { Event } from "../../src/core/bus/events.js";

function stubProvider(): LLMProvider {
  return {
    chat(
      _messages: unknown[],
      _toolSchemas: unknown[],
      _bus: EventBus,
      _runId: string,
      _options?: { step?: number; system?: string | null },
    ) {
      return Promise.resolve({
        stopReason: "end_turn",
        text: "",
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
          contextPercent: 0,
        },
        toolUses: [],
        thinkingBlocks: [],
      });
    },
  };
}

function stubProviderWithSummary(summary: string): LLMProvider {
  return {
    chat(
      _messages: unknown[],
      _toolSchemas: unknown[],
      _bus: EventBus,
      _runId: string,
      _options?: { step?: number; system?: string | null },
    ) {
      return Promise.resolve({
        stopReason: "end_turn",
        text: summary,
        usage: {
          inputTokens: 100,
          outputTokens: 50,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
          contextPercent: 5,
        },
        toolUses: [],
        thinkingBlocks: [],
      });
    },
  };
}

function makeCtx(runId: string): ExecutionContext {
  return new ExecutionContext({ runId, goal: "test", maxSteps: 1 });
}

describe("Compactor", () => {
  // Feature: compact publishes context.compacted event when LLM returns summary
  // Design: Call compact with provider that returns summary, verify event is published
  test("compact publishes context.compacted event with summary", async () => {
    const bus = new EventBus();
    const events: Event[] = [];
    bus.subscribe((e) => {
      events.push(e);
      return Promise.resolve();
    });

    const compactor = new Compactor(bus, "/tmp/session", "session-1");
    const provider = stubProviderWithSummary("## 1. Original Goal\nTest summary");
    await compactor.compact(makeCtx("run-1"), provider);

    const compactEvents = events.filter((e) => e.type === "context.compacted");
    expect(compactEvents).toHaveLength(1);
    // Verify the event was published with correct fields
    const found = compactEvents[0];
    expect(found).toBeDefined();
    expect(found).toHaveProperty("session_id", "session-1");
    expect(found).toHaveProperty("run_id", "run-1");
    expect(found).toHaveProperty("original_tokens");
    expect(found).toHaveProperty("summary_tokens");
    expect(found).toHaveProperty("timestamp");
  });

  // Feature: compactMessages returns null when LLM returns empty text
  // Design: Call compactMessages with provider that returns empty text, verify null
  test("compactMessages returns null when LLM returns empty text", async () => {
    const bus = new EventBus();
    const compactor = new Compactor(bus, "/tmp/session", "session-1");
    const result = await compactor.compactMessages([], stubProvider());
    expect(result).toBeNull();
  });

  // Feature: compactMessages returns CompactionResult when LLM returns summary
  // Design: Call compactMessages with provider that returns summary, verify result
  test("compactMessages returns result when LLM returns summary", async () => {
    const bus = new EventBus();
    const compactor = new Compactor(bus, "/tmp/session", "session-1");
    const messages = [
      { role: "user" as const, content: "Hello world " + "x".repeat(200) },
      { role: "assistant" as const, content: "Hi there " + "y".repeat(200) },
    ];
    const result = await compactor.compactMessages(
      messages,
      stubProviderWithSummary("## 1. Original Goal\nSummary here"),
    );
    expect(result).not.toBeNull();
    if (result) {
      expect(result.summaryText).toBe("## 1. Original Goal\nSummary here");
      expect(result.originalTokenEstimate).toBeGreaterThan(0);
      expect(result.summaryTokens).toBe(50);
    }
  });

  // Feature: compact uses constructor session ID in event
  // Design: Create compactor with specific ID, verify event uses it
  test("compact uses constructor session ID", async () => {
    const bus = new EventBus();
    const events: Event[] = [];
    bus.subscribe((e) => {
      events.push(e);
      return Promise.resolve();
    });

    const compactor = new Compactor(bus, "/tmp/s", "my-session-id");
    await compactor.compact(makeCtx("r2"), stubProviderWithSummary("Summary text"));

    for (const evt of events) {
      if (evt.type === "context.compacted") {
        expect(evt.session_id).toBe("my-session-id");
      }
    }
  });

  // Feature: compactMessages handles LLM failure gracefully
  // Design: Call compactMessages with provider that throws, verify null return
  test("compactMessages returns null on LLM failure", async () => {
    const bus = new EventBus();
    const compactor = new Compactor(bus, "/tmp/session", "session-1");
    const failingProvider: LLMProvider = {
      chat() {
        return Promise.reject(new Error("LLM unavailable"));
      },
    };
    const result = await compactor.compactMessages(
      [{ role: "user" as const, content: "test" }],
      failingProvider,
    );
    expect(result).toBeNull();
  });

  // Feature: compact replaces context messages with summary and acknowledgment
  // Design: Call compact, verify context.messages is replaced with [summary, acknowledgment]
  test("compact replaces context messages", async () => {
    const bus = new EventBus();
    const compactor = new Compactor(bus, "/tmp/session", "session-1");
    const provider = stubProviderWithSummary("## 1. Original Goal\nSummary");

    const ctx = makeCtx("run-1");
    ctx.addAssistantMessage([{ type: "text", text: "old message 1" }]);
    ctx.addAssistantMessage([{ type: "text", text: "old message 2" }]);

    const originalLength = ctx.messages.length;
    expect(originalLength).toBeGreaterThan(0);

    const result = await compactor.compact(ctx, provider);
    expect(result).not.toBeNull();

    // Context should be replaced with exactly 2 messages: summary + acknowledgment
    expect(ctx.messages).toHaveLength(2);
    expect(ctx.messages[0].role).toBe("user");
    expect(ctx.messages[1].role).toBe("assistant");

    const summaryContent = ctx.messages[0].content;
    expect(typeof summaryContent === "string" ? summaryContent : "").toContain("Summary");
  });

  // Feature: compactMessages passes focus parameter to LLM prompt
  // Design: Call compactMessages with focus text, verify provider receives it in messages
  test("compactMessages includes focus in LLM prompt", async () => {
    const bus = new EventBus();
    const compactor = new Compactor(bus, "/tmp/session", "session-1");

    let capturedMessages: unknown[] = [];
    const capturingProvider: LLMProvider = {
      chat(messages) {
        capturedMessages = messages;
        return Promise.resolve({
          stopReason: "end_turn",
          text: "Summary with focus",
          usage: {
            inputTokens: 100,
            outputTokens: 50,
            cacheReadInputTokens: 0,
            cacheCreationInputTokens: 0,
            contextPercent: 5,
          },
          toolUses: [],
          thinkingBlocks: [],
        });
      },
    };

    const messages = [
      { role: "user" as const, content: "Hello" },
      { role: "assistant" as const, content: "Hi" },
    ];

    await compactor.compactMessages(messages, capturingProvider, "Focus on file operations");

    // The focus text should appear in the messages sent to the LLM
    const allContent = JSON.stringify(capturedMessages);
    expect(allContent).toContain("Focus on file operations");
  });
});
