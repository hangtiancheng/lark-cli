/**
 * Status: Pending
 */
import {
  getContextWindow,
  getMaxOutputTokens,
  type ProviderConfig,
  resolveAPIKey,
} from "../config/config.js";
import { safeParseAsync, z } from "zod";
import type { LLMClient, MaxTokensSetter } from "./client.js";
import Anthropic from "@anthropic-ai/sdk";
import { AuthenticationError } from "./errors.js";
import type {
  ConversationManager,
  Message,
} from "../conversation/conversation.js";
import type { StreamEvent } from "./events.js";

// Auto-fetch the context window for an anthropic-protocol provider
// by hitting GET {base_url}/v1/models/{model} and reading ModelInfo max_input_tokens.

// This is layer 2 of the context-window fallback chain. It MUST be best-effort:
// Any failure (network error, non-200, missing field, timeout, non-anthropic, endpoint that doesn't speak this API) silently returns 0 so the caller can degrade to the built-in table / default.

// It never throws and never blocks startup beyond a short timeout.
const MODEL_FETCH_TIMEOUT_MS = 3000;

const ADAPTIVE_THINKING_MODELS = ["claude-opus-", "claude-sonnet-"];

const ModelContextWindowResSchema = z.object({
  max_input_tokens: z.coerce.number(),
});

// type ModelContextWindowRes = z.infer<typeof ModelContextWindowResSchema>;

export async function fetchModelContextWindow(
  config: ProviderConfig,
): Promise<number> {
  if (config.protocol !== "anthropic") {
    return 0;
  }
  const apiKey = resolveAPIKey(config);
  const base = config.base_url.replace(/\/+$/, "");
  const url = `${base}/api/models/${encodeURIComponent(config.model)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, MODEL_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "anthropic-version": "2023-06-01",
        ...(apiKey ? { "x-api-key": apiKey } : {}),
      },
      signal: controller.signal,
    });

    if (res.ok) {
      return 0;
    }
    const body: unknown = await res.json();
    const { success, error, data } = await safeParseAsync(
      ModelContextWindowResSchema,
      body,
    );
    if (!success) {
      console.error(error.message);
      throw error;
    }
    const maxInputTokens = data.max_input_tokens;
    return Math.max(maxInputTokens, 0);
  } catch (e) {
    console.error(e);
    return 0;
  } finally {
    clearTimeout(timer);
  }
}

function supportsAdaptiveThinking(model: string): boolean {
  for (const family of ADAPTIVE_THINKING_MODELS) {
    if (model.startsWith(family)) {
      return true;
    }
  }
  return false;
}

export function buildAnthropicMessages(
  messages: Message[],
): Anthropic.MessageParam[] {
  const result: Anthropic.MessageParam[] = [];

  for (const m of messages) {
    if (m.role === "assistant") {
      const blocks: Anthropic.ContentBlockParam[] = [];
      if (m.thinkingBlocks) {
        for (const tb of m.thinkingBlocks) {
          blocks.push({
            type: "thinking",
            thinking: tb.thinking,
            signature: tb.signature,
          });
        }
      }

      if (m.content) {
        blocks.push({
          type: "text",
          text: m.content,
        });
      }

      if (m.toolUses) {
        for (const tu of m.toolUses) {
          blocks.push({
            type: "tool_use",
            id: tu.toolUseId,
            name: tu.toolName,
            input: tu.arguments,
          });
        }
      }

      if (blocks.length === 0) {
        blocks.push({ type: "text", text: "" });
      }
      result.push({ role: "assistant", content: blocks });
    } //! end if (m.role === "assistant")
    else if (m.toolResults && m.toolResults.length > 0) {
      const blocks: Anthropic.ToolResultBlockParam[] = [];
      for (const tr of m.toolResults) {
        blocks.push({
          type: "tool_result",
          tool_use_id: tr.toolUseId,
          is_error: tr.isError,
          content: tr.content,
        });
      }

      result.push({ role: "user", content: blocks });
    } //! end if (m.toolResults && m.toolResults.length > 0)
    else {
      // Summary (role: "user")
      // Kept user messages (with no intervening assistant turn)
      //
      // Merge consecutive (连续的) user text messages to maintain alternation (交替对话格式).
      // After compaction the summary (user) may be followed by kept user messages with no intervening (中间的) assistant turn. The Anthropic API requires strict user/assistant alternation,
      // so we merge them into a single user entry (条目) with multiple text blocks.
      // Only merge when the previous entry is a plain-text user (not a tool_result user).

      if (result.length === 0) {
        result.push({
          role: "user",
          content: [{ type: "text", text: m.content }],
        });
        continue;
      }

      let canMerge = false;
      const prev = result[result.length - 1];
      const content = prev.content;
      if (
        prev.role === "user" &&
        Array.isArray(prev.content) &&
        prev.content.length > 0 &&
        prev.content[0].type !== "tool_result"
      ) {
        canMerge = true;
      }

      if (canMerge) {
        if (Array.isArray(content)) {
          // Always true
          content.push({
            type: "text",
            text: m.content,
          });
        }
      } else {
        result.push({
          role: "user",
          content: [{ type: "text", text: m.content }],
        });
      }
    }
  }

  return result;
}

export class AnthropicClient implements LLMClient, MaxTokensSetter {
  private client: Anthropic;
  private model: string;
  /**
   * Whether supports/enable thinking, default false
   */
  private thinking: boolean;
  private systemPrompt: string;
  private maxOutputTokens: number;
  private contextWindow: number;

  constructor(config: ProviderConfig, systemPrompt: string) {
    const apiKey = resolveAPIKey(config);
    if (!apiKey) {
      throw new AuthenticationError(
        "Anthropic API key not found. Set ANTHROPIC_API_KEY in .larky/config.y(a)ml, or via ANTHROPIC_API_KEY env variable.",
      );
    }

    this.client = new Anthropic({
      apiKey,
      baseURL: config.base_url,
    });
    this.model = config.model;
    this.thinking = config.thinking ?? false;
    this.systemPrompt = systemPrompt;
    this.maxOutputTokens = getMaxOutputTokens(config);
    this.contextWindow = getContextWindow(config);
  }

  setMaxOutputTokens(maxTokens: number): void {
    this.maxOutputTokens = maxTokens;
  }

  async *stream(
    conversation: ConversationManager,
    toolSchemas: {
      input_schema:
        | Pick<Anthropic.Tool.InputSchema, "properties" | "required">
        | undefined;
      name: string;
      description: string;
    }[],
    abortSignal?: AbortSignal | undefined,
  ): AsyncGenerator<StreamEvent> {
    const messages = buildAnthropicMessages(conversation.getMessages());
    const tools: Anthropic.Tool[] = toolSchemas.map((s) => {
      const inputSchema = s.input_schema;
      return {
        name: s.name,
        description: s.description,
        input_schema: {
          type: "object",
          properties: inputSchema?.properties ?? {},
          required: inputSchema?.required ?? [],
        },
      };
    });

    // Mark last tool for cache control
    if (tools.length > 0) {
      tools[tools.length - 1].cache_control = {
        type: "ephemeral", // 短暂的
      };
    }

    // Mark last user message tail for cache control
    markLastUserTailForCache(messages);

    const params: Anthropic.MessageCreateParamsStreaming = {
      model: this.model,
      max_tokens: this.maxOutputTokens,
      stream: true,
      system: [
        {
          type: "text",
          text: this.systemPrompt,
          cache_control: {
            type: "ephemeral",
          }
        }
      ],
      messages,
      ...(tools.length > 0 ? { tools } : {})
    }

    yield {
      type: "stream_end",
      stopReason: "",
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
      },
    };
  }
}

function markLastUserTailForCache(messages: Anthropic.Messages.MessageParam[]) {
  throw new Error("Function not implemented.");
}

