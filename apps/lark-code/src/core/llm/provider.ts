// Anthropic LLM provider: streaming calls with prompt caching and retry logic
import process from "node:process";

import Anthropic from "@anthropic-ai/sdk";

import type { EventBus } from "../events/bus.js";
import type { LLMProvider } from "./base.js";
import type { LlmResponse, ToolUseBlock, UsageStats } from "./types.js";
import type { TextBlockParam, ToolUnion } from "@anthropic-ai/sdk/resources";

// Model context window size mapping
const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  "claude-sonnet-4-6": 200_000,
  "claude-haiku-4-5-20251001": 200_000,
  "claude-opus-4-7": 200_000,
};

const MAX_STREAM_RETRIES = 3;
const RETRY_BACKOFF_MS = [1000, 2000, 4000];

const SYSTEM_PROMPT =
  "You are a helpful AI assistant. " +
  "Use the available tools to complete the user's goal. " +
  "When the goal is fully achieved, respond with a final answer and do not call any more tools.";

// Return the max context window token count for a given model
function contextWindow(model: string): number {
  return MODEL_CONTEXT_WINDOWS[model] ?? 200_000;
}

// Return current UTC timestamp as ISO 8601 string
function now(): string {
  return new Date().toISOString();
}

// Wait for the specified number of milliseconds
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Check if an error is a transient network failure worth retrying
function isRetryableError(exc: unknown): boolean {
  if (!(exc instanceof Error)) return false;
  const code = "code" in exc && typeof exc.code === "string" ? exc.code : undefined;
  if (
    code === "ECONNRESET" ||
    code === "ECONNREFUSED" ||
    code === "ETIMEDOUT" ||
    code === "EPIPE" ||
    code === "EAI_AGAIN"
  ) {
    return true;
  }
  const msg = exc.message.toLowerCase();
  return msg.includes("socket hang up") || msg.includes("connection reset");
}

export class AnthropicProvider implements LLMProvider {
  private _client: Anthropic;
  private _model: string;

  // Initialize Anthropic client; inject client for testing to skip API key check
  constructor(model: string, client?: Anthropic) {
    if (client) {
      this._client = client;
    } else {
      const apiKey = process.env["ANTHROPIC_API_KEY"];
      if (!apiKey) {
        throw new Error("ANTHROPIC_API_KEY not set");
      }
      const baseURL = process.env["ANTHROPIC_BASE_URL"];
      this._client = new Anthropic({
        ...(baseURL ? { baseURL } : {}),
        apiKey,
      });
    }
    this._model = model;
  }

  // Stream Anthropic API call, emit events per token, return LlmResponse; auto-retry on network failures
  async chat(
    messages: Anthropic.MessageParam[],
    toolSchemas: ToolUnion[],
    bus: EventBus,
    runId: string,
    options?: { step?: number; system?: string | null },
  ): Promise<LlmResponse> {
    const step = options?.step ?? 0;
    const system = options?.system ?? null;

    await bus.publish({
      type: "llm.model_selected",
      run_id: runId,
      model: this._model,
      strategy: "static",
      timestamp: now(),
    });

    // Build system blocks with prompt caching
    const systemBlocks: TextBlockParam[] = [
      {
        type: "text",
        text: system ?? SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ];

    // Build tools array; last tool gets cache_control
    const tools: ToolUnion[] = [...toolSchemas];
    if (tools.length > 0) {
      const lastIdx = tools.length - 1;
      const last = { ...tools[lastIdx] };
      last.cache_control = { type: "ephemeral" };
      tools[lastIdx] = last;
    }

    // Build request parameters
    const args: Anthropic.MessageCreateParamsStreaming = {
      model: this._model,
      max_tokens: 8192,
      system: systemBlocks,
      messages,
      stream: true,
    };
    if (tools.length > 0) {
      args.tools = tools;
    }

    let textParts: string[] = [];
    let finalMessage: Anthropic.Message | null = null;

    for (let attempt = 1; attempt <= MAX_STREAM_RETRIES; attempt++) {
      textParts = [];
      try {
        const stream = this._client.messages.stream(args);

        // Collect tokens via text event (MessageStream has no textStream property)
        // Only publish token events on the first attempt to avoid TUI duplicates
        const isFirstAttempt = attempt === 1;
        stream.on("text", (textDelta) => {
          if (isFirstAttempt) {
            void bus.publish({
              type: "llm.token",
              run_id: runId,
              token: textDelta,
              timestamp: now(),
            });
          }
          textParts.push(textDelta);
        });

        finalMessage = await stream.finalMessage();
        break;
      } catch (exc) {
        if (!isRetryableError(exc)) {
          throw exc;
        }
        if (attempt === MAX_STREAM_RETRIES) {
          console.error(
            `stream failed after ${String(MAX_STREAM_RETRIES)} attempts run_id=${runId} step=${String(step)}:`,
            exc,
          );
          throw exc;
        }
        const delay = RETRY_BACKOFF_MS[attempt - 1] ?? 0;
        console.warn(
          `stream dropped (attempt ${String(attempt)}/${String(MAX_STREAM_RETRIES)}) run_id=${runId} step=${String(step)}: ${String(exc)} — retrying in ${String(delay)}ms`,
        );
        await sleep(delay);
      }
    }

    if (!finalMessage) {
      throw new Error("LLM stream failed: no final message");
    }

    const usage = finalMessage.usage;
    const cacheReadInputTokens = usage.cache_read_input_tokens ?? 0;
    const cacheCreationInputTokens = usage.cache_creation_input_tokens ?? 0;
    const contextPercent = usage.input_tokens / contextWindow(this._model);

    await bus.publish({
      type: "llm.usage",
      run_id: runId,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      cache_read_input_tokens: cacheReadInputTokens,
      cache_creation_input_tokens: cacheCreationInputTokens,
      context_percent: contextPercent,
      timestamp: now(),
    });

    const toolUses: ToolUseBlock[] = [];
    const thinkingBlocks: Anthropic.ThinkingBlock[] = [];

    for (const block of finalMessage.content) {
      if (block.type === "tool_use") {
        toolUses.push(block);
      } else if (block.type === "thinking") {
        thinkingBlocks.push(block);
      }
    }

    const usageStats: UsageStats = {
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      cacheReadInputTokens,
      cacheCreationInputTokens,
      contextPercent,
    };

    return {
      stopReason: finalMessage.stop_reason ?? "end_turn",
      toolUses,
      text: textParts.join(""),
      usage: usageStats,
      thinkingBlocks,
    };
  }
}
