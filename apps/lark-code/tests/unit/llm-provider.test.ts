import { describe, expect, test } from "vitest";
import { AnthropicProvider } from "../../src/core/llm/provider.js";
import { EventBus } from "../../src/core/events/bus.js";
import type Anthropic from "@anthropic-ai/sdk";

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

function isAnthropic(value: unknown): value is Anthropic {
  if (!isRecord(value)) {
    return false;
  }
  if (!("messages" in value)) {
    return false;
  }
  if (!isRecord(value["messages"])) {
    return false;
  }
  if (!("stream" in value["messages"])) {
    return false;
  }
  return typeof value["messages"]["stream"] === "function";
}

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
    finalMessage() {
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
function makeMockClient(streamFactory: () => ReturnType<typeof makeMockStream>) {
  return {
    messages: {
      stream: () => streamFactory(),
    },
  };
}

// Helper: create AnthropicProvider with mock client (type-safe wrapper)
function makeProvider(
  model: string,
  streamFactory: () => ReturnType<typeof makeMockStream>,
): AnthropicProvider {
  const mockClient = makeMockClient(streamFactory);
  if (!isAnthropic(mockClient)) {
    throw new Error("Mock client failed Anthropic type guard");
  }
  return new AnthropicProvider(model, mockClient);
}

// Helper: collect events from bus
function collectEvents(bus: EventBus): unknown[] {
  const events: unknown[] = [];
  bus.subscribe((e) => {
    events.push(e);
    return Promise.resolve();
  });
  return events;
}

describe("AnthropicProvider", () => {
  // --- Constructor tests ---

  test("throws without ANTHROPIC_API_KEY", () => {
    const orig = process.env["ANTHROPIC_API_KEY"];
    Reflect.deleteProperty(process.env, "ANTHROPIC_API_KEY");
    try {
      expect(() => new AnthropicProvider("claude-sonnet-4-6")).toThrow("ANTHROPIC_API_KEY not set");
    } finally {
      if (orig !== undefined) process.env["ANTHROPIC_API_KEY"] = orig;
    }
  });

  test("succeeds with injected client", () => {
    const provider = makeProvider("claude-sonnet-4-6", () =>
      makeMockStream({ textChunks: ["hello"] }),
    );
    expect(provider).toBeDefined();
    expect(typeof provider.chat).toBe("function");
  });

  // --- chat() event publishing ---

  test("chat publishes llm.model_selected event", async () => {
    const provider = makeProvider("claude-sonnet-4-6", () =>
      makeMockStream({ textChunks: ["hi"] }),
    );
    const bus = new EventBus();
    const events = collectEvents(bus);

    await provider.chat([], [], bus, "run-1");

    const selected = events.find((e: unknown) => asRecord(e)["type"] === "llm.model_selected");
    expect(selected).toBeDefined();
    expect(asRecord(selected)["model"]).toBe("claude-sonnet-4-6");
  });

  test("chat publishes llm.token events per chunk", async () => {
    const provider = makeProvider("claude-sonnet-4-6", () =>
      makeMockStream({ textChunks: ["Hello", " ", "world"] }),
    );
    const bus = new EventBus();
    const events = collectEvents(bus);

    await provider.chat([], [], bus, "run-1");

    const tokens = events.filter((e: unknown) => asRecord(e)["type"] === "llm.token");
    expect(tokens).toHaveLength(3);
    expect(asRecord(tokens[0])["token"]).toBe("Hello");
    expect(asRecord(tokens[1])["token"]).toBe(" ");
    expect(asRecord(tokens[2])["token"]).toBe("world");
  });

  test("chat publishes llm.usage event with correct counts", async () => {
    const provider = makeProvider("claude-sonnet-4-6", () =>
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
    const bus = new EventBus();
    const events = collectEvents(bus);

    await provider.chat([], [], bus, "run-1");

    const usage = events.find((e: unknown) => asRecord(e)["type"] === "llm.usage");
    expect(usage).toBeDefined();
    expect(asRecord(usage)["input_tokens"]).toBe(100);
    expect(asRecord(usage)["output_tokens"]).toBe(50);
    expect(asRecord(usage)["cache_read_input_tokens"]).toBe(30);
    expect(asRecord(usage)["cache_creation_input_tokens"]).toBe(10);
  });

  // --- chat() response parsing ---

  test("chat returns correct stopReason", async () => {
    const provider = makeProvider("claude-sonnet-4-6", () =>
      makeMockStream({ textChunks: ["done"], stopReason: "end_turn" }),
    );
    const bus = new EventBus();

    const response = await provider.chat([], [], bus, "run-1");
    expect(response.stopReason).toBe("end_turn");
  });

  test("chat accumulates text from tokens", async () => {
    const provider = makeProvider("claude-sonnet-4-6", () =>
      makeMockStream({ textChunks: ["Hello", " ", "world", "!"] }),
    );
    const bus = new EventBus();

    const response = await provider.chat([], [], bus, "run-1");
    expect(response.text).toBe("Hello world!");
  });

  test("chat extracts tool_use blocks", async () => {
    const provider = makeProvider("claude-sonnet-4-6", () =>
      makeMockStream({
        textChunks: [],
        stopReason: "tool_use",
        toolUses: [
          { id: "tool-use-1", name: "bash", input: { command: "ls" } },
          { id: "tool-use-2", name: "read_file", input: { path: "test.txt" } },
        ],
      }),
    );
    const bus = new EventBus();

    const response = await provider.chat([], [], bus, "run-1");
    expect(response.toolUses).toHaveLength(2);
    expect(response.toolUses[0].name).toBe("bash");
    expect(response.toolUses[1].name).toBe("read_file");
    expect(response.stopReason).toBe("tool_use");
  });

  test("chat extracts thinking blocks", async () => {
    const provider = makeProvider("claude-sonnet-4-6", () =>
      makeMockStream({
        textChunks: ["answer"],
        thinkingBlocks: [{ thinking: "Let me think about this..." }],
      }),
    );
    const bus = new EventBus();

    const response = await provider.chat([], [], bus, "run-1");
    expect(response.thinkingBlocks).toHaveLength(1);
    expect(response.thinkingBlocks[0].thinking).toBe("Let me think about this...");
  });

  test("chat returns empty text for no tokens", async () => {
    const provider = makeProvider("claude-sonnet-4-6", () => makeMockStream({ textChunks: [] }));
    const bus = new EventBus();

    const response = await provider.chat([], [], bus, "run-1");
    expect(response.text).toBe("");
  });

  // --- Retry behavior (tests the Phase 1.1 fix) ---

  test("non-retryable error propagates immediately without retry", async () => {
    let callCount = 0;
    const mockClient = {
      messages: {
        stream: () => {
          callCount++;
          return makeMockStream({
            throwError: Object.assign(new Error("401 Unauthorized"), {
              code: "AUTH_ERROR",
            }),
          });
        },
      },
    };
    if (!isAnthropic(mockClient)) {
      throw new Error("Mock client failed Anthropic type guard");
    }
    const provider = new AnthropicProvider("claude-sonnet-4-6", mockClient);
    const bus = new EventBus();

    await expect(provider.chat([], [], bus, "run-1")).rejects.toThrow("401 Unauthorized");
    expect(callCount).toBe(1); // No retry
  });

  test("network error triggers retry", async () => {
    let callCount = 0;
    const mockClient = {
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
    if (!isAnthropic(mockClient)) {
      throw new Error("Mock client failed Anthropic type guard");
    }
    const provider = new AnthropicProvider("claude-sonnet-4-6", mockClient);
    const bus = new EventBus();

    const response = await provider.chat([], [], bus, "run-1");
    expect(response.text).toBe("recovered");
    expect(callCount).toBe(2); // Retried once
  });

  test("token events suppressed on retry to avoid duplicates", async () => {
    let callCount = 0;
    const mockClient = {
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
    if (!isAnthropic(mockClient)) {
      throw new Error("Mock client failed Anthropic type guard");
    }
    const provider = new AnthropicProvider("claude-sonnet-4-6", mockClient);
    const bus = new EventBus();
    const events = collectEvents(bus);

    const response = await provider.chat([], [], bus, "run-1");

    // Text is still collected from retry, but no token events are published
    expect(response.text).toBe("retry-text");
    const tokens = events.filter((e: unknown) => asRecord(e)["type"] === "llm.token");
    expect(tokens.length).toBe(0);
  });

  test("exhausted retries throw the last error", async () => {
    const mockClient = makeMockClient(() =>
      makeMockStream({
        throwError: Object.assign(new Error("ECONNRESET"), {
          code: "ECONNRESET",
        }),
      }),
    );
    if (!isAnthropic(mockClient)) {
      throw new Error("Mock client failed Anthropic type guard");
    }
    const provider = new AnthropicProvider("claude-sonnet-4-6", mockClient);
    const bus = new EventBus();

    await expect(provider.chat([], [], bus, "run-1")).rejects.toThrow("ECONNRESET");
  });
});
