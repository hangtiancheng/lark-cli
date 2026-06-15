import { describe, expect, test } from "vitest";
import { AnthropicProvider } from "../../src/core/llm/provider.js";
import { EventBus } from "../../src/core/events/bus.js";

// Mock MessageStream: emits text events and returns a final message
function makeMockStream(opts: {
  textChunks?: string[];
  stopReason?: string;
  toolUses?: { id: string; name: string; input: Record<string, unknown> }[];
  thinkingBlocks?: { thinking: string }[];
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  throwError?: Error;
}) {
  const textChunks = opts.textChunks ?? [];
  const stopReason = opts.stopReason ?? "end_turn";
  const toolUses = opts.toolUses ?? [];
  const thinkingBlocks = opts.thinkingBlocks ?? [];
  const usage = opts.usage ?? {
    input_tokens: 10,
    output_tokens: 20,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  };

  let textHandler: ((delta: string) => void) | null = null;

  const stream = {
    on(event: string, handler: (delta: string) => void) {
      if (event === "text") {
        textHandler = handler;
      }
      return stream;
    },
    async finalMessage() {
      if (opts.throwError) throw opts.throwError;

      // Emit all text chunks
      if (textHandler) {
        for (const chunk of textChunks) {
          textHandler(chunk);
        }
      }

      // Build content blocks
      const content: unknown[] = [];
      for (const tu of toolUses) {
        content.push({ type: "tool_use", ...tu });
      }
      for (const tb of thinkingBlocks) {
        content.push({ type: "thinking", ...tb });
      }

      return {
        stop_reason: stopReason,
        usage,
        content,
      };
    },
  };

  return stream;
}

// Mock Anthropic client with configurable stream behavior
function makeMockClient(
  streamFactory: () => ReturnType<typeof makeMockStream>,
) {
  return {
    messages: {
      stream: () => streamFactory(),
    },
  };
}

// Helper: collect events from bus
function collectEvents(bus: EventBus): unknown[] {
  const events: unknown[] = [];
  bus.subscribe(async (e) => {
    events.push(e);
  });
  return events;
}

describe("AnthropicProvider", () => {
  // --- Constructor tests ---

  test("throws without ANTHROPIC_API_KEY", () => {
    const orig = process.env["ANTHROPIC_API_KEY"];
    Reflect.deleteProperty(process.env, "ANTHROPIC_API_KEY");
    try {
      expect(() => new AnthropicProvider("claude-sonnet-4-6")).toThrow(
        "ANTHROPIC_API_KEY not set",
      );
    } finally {
      if (orig !== undefined) process.env["ANTHROPIC_API_KEY"] = orig;
    }
  });

  test("succeeds with injected client", () => {
    const client = makeMockClient(() =>
      makeMockStream({ textChunks: ["hello"] }),
    );
    const provider = new AnthropicProvider("claude-sonnet-4-6", client);
    expect(provider).toBeDefined();
    expect(typeof provider.chat).toBe("function");
  });

  // --- chat() event publishing ---

  test("chat publishes llm.model_selected event", async () => {
    const client = makeMockClient(() => makeMockStream({ textChunks: ["hi"] }));
    const provider = new AnthropicProvider("claude-sonnet-4-6", client);
    const bus = new EventBus();
    const events = collectEvents(bus);

    await provider.chat([], [], bus, "run-1");

    const selected = events.find(
      (e: unknown) =>
        (e as Record<string, unknown>)["type"] === "llm.model_selected",
    );
    expect(selected).toBeDefined();
    expect((selected as Record<string, unknown>)["model"]).toBe(
      "claude-sonnet-4-6",
    );
  });

  test("chat publishes llm.token events per chunk", async () => {
    const client = makeMockClient(() =>
      makeMockStream({ textChunks: ["Hello", " ", "world"] }),
    );
    const provider = new AnthropicProvider("claude-sonnet-4-6", client);
    const bus = new EventBus();
    const events = collectEvents(bus);

    await provider.chat([], [], bus, "run-1");

    const tokens = events.filter(
      (e: unknown) => (e as Record<string, unknown>)["type"] === "llm.token",
    );
    expect(tokens).toHaveLength(3);
    expect((tokens[0] as Record<string, unknown>)["token"]).toBe("Hello");
    expect((tokens[1] as Record<string, unknown>)["token"]).toBe(" ");
    expect((tokens[2] as Record<string, unknown>)["token"]).toBe("world");
  });

  test("chat publishes llm.usage event with correct counts", async () => {
    const client = makeMockClient(() =>
      makeMockStream({
        textChunks: ["test"],
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_read_input_tokens: 30,
          cache_creation_input_tokens: 10,
        },
      }),
    );
    const provider = new AnthropicProvider("claude-sonnet-4-6", client);
    const bus = new EventBus();
    const events = collectEvents(bus);

    await provider.chat([], [], bus, "run-1");

    const usage = events.find(
      (e: unknown) => (e as Record<string, unknown>)["type"] === "llm.usage",
    ) as Record<string, unknown>;
    expect(usage).toBeDefined();
    expect(usage["input_tokens"]).toBe(100);
    expect(usage["output_tokens"]).toBe(50);
    expect(usage["cache_read_input_tokens"]).toBe(30);
    expect(usage["cache_creation_input_tokens"]).toBe(10);
  });

  // --- chat() response parsing ---

  test("chat returns correct stopReason", async () => {
    const client = makeMockClient(() =>
      makeMockStream({ textChunks: ["done"], stopReason: "end_turn" }),
    );
    const provider = new AnthropicProvider("claude-sonnet-4-6", client);
    const bus = new EventBus();

    const response = await provider.chat([], [], bus, "run-1");
    expect(response.stopReason).toBe("end_turn");
  });

  test("chat accumulates text from tokens", async () => {
    const client = makeMockClient(() =>
      makeMockStream({ textChunks: ["Hello", " ", "world", "!"] }),
    );
    const provider = new AnthropicProvider("claude-sonnet-4-6", client);
    const bus = new EventBus();

    const response = await provider.chat([], [], bus, "run-1");
    expect(response.text).toBe("Hello world!");
  });

  test("chat extracts tool_use blocks", async () => {
    const client = makeMockClient(() =>
      makeMockStream({
        textChunks: [],
        stopReason: "tool_use",
        toolUses: [
          { id: "tool-use-1", name: "bash", input: { command: "ls" } },
          { id: "tool-use-2", name: "read_file", input: { path: "test.txt" } },
        ],
      }),
    );
    const provider = new AnthropicProvider("claude-sonnet-4-6", client);
    const bus = new EventBus();

    const response = await provider.chat([], [], bus, "run-1");
    expect(response.toolUses).toHaveLength(2);
    expect(response.toolUses[0].name).toBe("bash");
    expect(response.toolUses[1].name).toBe("read_file");
    expect(response.stopReason).toBe("tool_use");
  });

  test("chat extracts thinking blocks", async () => {
    const client = makeMockClient(() =>
      makeMockStream({
        textChunks: ["answer"],
        thinkingBlocks: [{ thinking: "Let me think about this..." }],
      }),
    );
    const provider = new AnthropicProvider("claude-sonnet-4-6", client);
    const bus = new EventBus();

    const response = await provider.chat([], [], bus, "run-1");
    expect(response.thinkingBlocks).toHaveLength(1);
    expect(response.thinkingBlocks[0].thinking).toBe(
      "Let me think about this...",
    );
  });

  test("chat returns empty text for no tokens", async () => {
    const client = makeMockClient(() => makeMockStream({ textChunks: [] }));
    const provider = new AnthropicProvider("claude-sonnet-4-6", client);
    const bus = new EventBus();

    const response = await provider.chat([], [], bus, "run-1");
    expect(response.text).toBe("");
  });

  // --- Retry behavior (tests the Phase 1.1 fix) ---

  test("non-retryable error propagates immediately without retry", async () => {
    let callCount = 0;
    const client = makeMockClient(() => {
      callCount++;
      return makeMockStream({
        throwError: Object.assign(new Error("401 Unauthorized"), {
          code: "AUTH_ERROR",
        }),
      });
    });
    const provider = new AnthropicProvider("claude-sonnet-4-6", client);
    const bus = new EventBus();

    await expect(provider.chat([], [], bus, "run-1")).rejects.toThrow(
      "401 Unauthorized",
    );
    expect(callCount).toBe(1); // No retry
  });

  test("network error triggers retry", async () => {
    let callCount = 0;
    const client = {
      messages: {
        stream: () => {
          callCount++;
          if (callCount === 1) {
            // First attempt: network error
            return makeMockStream({
              throwError: Object.assign(new Error("connection reset"), {
                code: "ECONNRESET",
              }),
            });
          }
          // Second attempt: success
          return makeMockStream({ textChunks: ["recovered"] });
        },
      },
    };
    const provider = new AnthropicProvider("claude-sonnet-4-6", client);
    const bus = new EventBus();

    const response = await provider.chat([], [], bus, "run-1");
    expect(response.text).toBe("recovered");
    expect(callCount).toBe(2); // Retried once
  });

  test("token events emit during retry attempts", async () => {
    let callCount = 0;
    const client = {
      messages: {
        stream: () => {
          callCount++;
          if (callCount === 1) {
            return makeMockStream({
              throwError: Object.assign(new Error("socket hang up"), {
                code: "EPIPE",
              }),
            });
          }
          return makeMockStream({ textChunks: ["retry-text"] });
        },
      },
    };
    const provider = new AnthropicProvider("claude-sonnet-4-6", client);
    const bus = new EventBus();
    const events = collectEvents(bus);

    await provider.chat([], [], bus, "run-1");

    // Token events from attempt 2 should be present (fix verified)
    const tokens = events.filter((e: unknown) => e.type === "llm.token");
    expect(tokens.length).toBeGreaterThanOrEqual(1);
  });

  test("exhausted retries throw the last error", async () => {
    const client = makeMockClient(() =>
      makeMockStream({
        throwError: Object.assign(new Error("ECONNRESET"), {
          code: "ECONNRESET",
        }),
      }),
    );
    const provider = new AnthropicProvider("claude-sonnet-4-6", client);
    const bus = new EventBus();

    await expect(provider.chat([], [], bus, "run-1")).rejects.toThrow(
      "ECONNRESET",
    );
  });
});
