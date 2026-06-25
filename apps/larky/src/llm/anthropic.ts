/**
 * Status: Done
 */

import Anthropic from "@anthropic-ai/sdk";
import { safeParseAsync, z } from "zod";
import {
  getContextWindow,
  getMaxOutputTokens,
  type ProviderConfig,
  resolveAPIKey,
} from "../config/config.js";
import type { ConversationManager, Message } from "../conversation/conversation.js";
import { asErrorString, asRecord, asString, DANGEROUSLY_JSON, isRecord } from "../utils/index.js";
import type { LLMClient } from "./client.js";
import {
  AuthenticationError,
  ContextTooLongError,
  LLMError,
  NetworkError,
  RateLimitError,
} from "./errors.js";
import type { StreamEvent } from "./events.js";
import type { ToolSchema } from "@/tools/types.js";

enum AnthropicErrorCode {
  /** 413 Payload Too Large — The request entity is larger than the server is willing or able to process. */
  PromptTooLong = 413,
  /** 401 Unauthorized — The request lacks valid authentication credentials. */
  InvalidAPIKey = 401,
  /** 429 Too Many Requests — The client has sent too many requests in a given amount of time, triggering rate limiting. */
  RateLimitError = 429,
}

// Auto-fetch the context window for an anthropic-protocol provider
// by hitting GET {base_url}/v1/models/{model} and reading ModelInfo.max_input_tokens.

// This is layer 2 of the context-window fallback chain. It MUST be best-effort:
// Any failure (network error, non-200, missing field, timeout, non-anthropic, endpoint that doesn't speak this API) silently returns 0 so the caller can degrade to the built-in table / default.

// It never throws and never blocks, startup beyond a short timeout.
const MODEL_FETCH_TIMEOUT_MS = 3000;

const ModelContextWindowResSchema = z.object({
  max_input_tokens: z.coerce.number(),
});

// type ModelContextWindowRes = z.infer<typeof ModelContextWindowResSchema>;

export async function fetchModelContextWindow(config: ProviderConfig): Promise<number> {
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
    const { success, error, data } = await safeParseAsync(ModelContextWindowResSchema, body);
    if (!success) {
      console.error(error.message);
      return 0;
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

/**
 * FIXME: Always return true
 */
function supportsAdaptiveThinking(): boolean {
  return true;
}

export function buildAnthropicMessages(messages: Message[]): Anthropic.MessageParam[] {
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
      } // end if (m.thinkingBlocks)

      if (m.content) {
        blocks.push({
          type: "text",
          text: m.content,
        });
      } // end if (m.content)

      if (m.toolUses) {
        for (const tu of m.toolUses) {
          blocks.push({
            type: "tool_use", // tool use **request**
            id: tu.toolUseId,
            name: tu.toolName,
            input: tu.arguments,
          });
        }
      } // end if (m.toolUses)

      if (blocks.length === 0) {
        blocks.push({ type: "text", text: "" });
      }
      result.push({ role: "assistant", content: blocks });
    } //! end if (m.role === "assistant")
    else if (m.toolResults && m.toolResults.length > 0) {
      const blocks: Anthropic.ToolResultBlockParam[] = [];
      for (const tr of m.toolResults) {
        blocks.push({
          type: "tool_result", // tool result
          tool_use_id: tr.toolUseId,
          is_error: tr.isError,
          content: tr.content,
        });
      }

      result.push({ role: "user", content: blocks });
    } //! end if (m.toolResults && m.toolResults.length > 0)

    // 第一条消息的 role 必须是 user
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
      let content = prev.content;
      if (
        prev.role === "user" &&
        (typeof content === "string" ||
          (Array.isArray(content) &&
            content.length > 0 &&
            // content[0].type !== "tool_result"
            content[0].type === "text"))
      ) {
        canMerge = true;
      }

      if (canMerge) {
        // Convert
        if (typeof content === "string") {
          // First assign to prev.content, then assign to content
          content = prev.content =
            content.trim().length > 0
              ? [
                  {
                    type: "text",
                    text: content,
                  },
                ]
              : [];
        }
        content.push({
          type: "text",
          text: m.content,
        });
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

export class AnthropicClient implements LLMClient {
  private client: Anthropic;
  private model: string;
  /**
   * Whether supports/enable thinking, default false
   */
  private thinking: boolean;
  private systemPrompt: string;
  private maxOutputTokens: number;
  /** Currently not used */
  private contextWindow: number;

  constructor(config: ProviderConfig, systemPrompt: string) {
    const apiKey = resolveAPIKey(config);
    if (!apiKey) {
      throw new AuthenticationError(
        "Anthropic API key not found, set ANTHROPIC_API_KEY in .larky/config.y(a)ml, or via ANTHROPIC_API_KEY env variable.",
      );
    }

    this.client = new Anthropic({
      apiKey,
      baseURL: config.base_url,
    });
    this.model = config.model;
    this.thinking = config.thinking ?? true;
    this.systemPrompt = systemPrompt;
    this.maxOutputTokens = getMaxOutputTokens(config);
    this.contextWindow = getContextWindow(config);
  }

  setMaxOutputTokens(maxTokens: number): void {
    this.maxOutputTokens = maxTokens;
  }

  async *stream(
    conversation: ConversationManager,
    toolSchemas: ToolSchema[],
    abortSignal?: AbortSignal,
  ): AsyncGenerator<StreamEvent> {
    const messages = buildAnthropicMessages(conversation.getMessages());
    const antToolSchemas: Anthropic.Tool[] = toolSchemas.map((s) => {
      const inputSchema = s.input_schema;
      return {
        name: s.name,
        description: s.description,
        input_schema: {
          type: "object" as const,
          properties: inputSchema.properties,
          required: inputSchema.required ?? [],
        },
      };
    });

    // Mark last tool for cache control
    if (antToolSchemas.length > 0) {
      // Mark last tool schema for cache control
      antToolSchemas[antToolSchemas.length - 1].cache_control = {
        type: "ephemeral", // 短暂的
      };

      // for (const schema of antToolSchemas) {
      //   schema.cache_control = {
      //     type: "ephemeral",
      //   };
      // }
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
            type: "ephemeral", // Prompt cache
          },
        },
      ],
      messages,
      ...(antToolSchemas.length > 0 ? { tools: antToolSchemas } : {}),
    };

    if (this.thinking) {
      if (supportsAdaptiveThinking()) {
        params.thinking = {
          type: "enabled",
          budget_tokens: this.maxOutputTokens - 1,
        };
      }
    } else {
      params.thinking = {
        type: "enabled",
        budget_tokens: this.maxOutputTokens - 1,
      };
    }

    let inputTokens = 0;
    let outputTokens = 0;
    let cacheReadInputTokens = 0;
    let cacheCreationInputTokens = 0;
    let stopReason = "end_turn";

    let thinkingAccumulate = "";
    let thinkingSignature = "";
    let inThinking = false;
    let startTime = 0;

    try {
      const response = this.client.messages.stream(params, {
        ...(abortSignal ? { signal: abortSignal } : {}),
      });

      let currentToolName = "";
      let currentToolId = "";
      let jsonAccumulate = "";

      for await (const event of response) {
        switch (event.type) {
          case "content_block_start": {
            const block = event.content_block;
            if (block.type === "thinking") {
              inThinking = true;
              thinkingAccumulate = "";
              thinkingSignature = "";
            } // end if (block.type === "thinking")
            else if (block.type === "tool_use") {
              currentToolId = block.id;
              currentToolName = block.name;
              jsonAccumulate = "";
              yield {
                type: "tool_call_start",
                toolName: currentToolName,
                toolId: currentToolId,
              };
            }
            break;
          } // end case "content_block_start"

          case "content_block_delta": {
            const delta = event.delta;
            if (delta.type === "thinking_delta") {
              thinkingAccumulate += delta.thinking;
              yield {
                type: "thinking_delta",
                text: delta.thinking,
              };
            }
            // end if (delta.type === "thinking_delta")
            else if (delta.type === "signature_delta") {
              console.log("delta.signature", delta.signature);
              thinkingSignature = delta.signature;
            }
            // end if (delta.type === "signature_delta")
            else if (delta.type === "text_delta") {
              yield {
                type: "text_delta",
                text: delta.text,
              };
            }
            // end if (delta.type === "text_delta")
            else if (delta.type === "input_json_delta") {
              jsonAccumulate += delta.partial_json;
              yield {
                type: "tool_call_delta",
                text: delta.partial_json,
              };
            } // end if (delta.type === "input_json_delta")
            break;
          } // end case "content_block_delta"

          case "content_block_stop": {
            if (inThinking) {
              yield {
                type: "thinking_complete",
                thinking: thinkingAccumulate,
                signature: thinkingSignature,
              };
              inThinking = false;
            } // end if (inThinking)

            if (currentToolName) {
              let args: Record<string, unknown> = {};
              if (jsonAccumulate) {
                try {
                  const parsed: unknown = JSON.parse(jsonAccumulate);
                  args = isRecord(parsed)
                    ? asRecord(parsed)
                    : { [DANGEROUSLY_JSON]: jsonAccumulate };
                } catch (err) {
                  console.error(err);
                  args = {
                    [DANGEROUSLY_JSON]: jsonAccumulate,
                  };
                }
              } // end if (jsonAccumulate)

              yield {
                type: "tool_call_complete",
                toolId: currentToolId,
                toolName: currentToolName,
                arguments: args,
              };

              // Reset
              currentToolName = "";
              currentToolId = "";
              jsonAccumulate = "";
            } // end if (currentToolName)
            break;
          } // end case "content_block_stop"

          case "message_delta": {
            if (event.delta.stop_reason) {
              stopReason = event.delta.stop_reason;
            }
            if (event.usage.output_tokens) {
              outputTokens = event.usage.output_tokens;
            }
            break;
          } // end case "message_delta"

          case "message_start": {
            startTime = performance.now();
            inputTokens = event.message.usage.input_tokens;
            outputTokens = event.message.usage.output_tokens;
            cacheReadInputTokens = event.message.usage.cache_read_input_tokens ?? 0;
            cacheCreationInputTokens = event.message.usage.cache_creation_input_tokens ?? 0;
            break;
          } // end "message_start"

          case "message_stop": {
            const stopTime = performance.now();
            const elapsed = stopTime - startTime;
            console.log(`Message elapsed: ${String(elapsed)}ms`);
            break;
          }
        }
      }

      yield {
        type: "stream_end",
        stopReason,
        usage: {
          inputTokens,
          outputTokens,
          cacheReadInputTokens,
          cacheCreationInputTokens,
        },
      };
    } catch (err) {
      throw classifyAnthropicError(err);
    }
  }
}

/**
 * @param messages
 */
function markLastUserTailForCache(messages: Anthropic.Messages.MessageParam[]) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role !== "user") {
      continue;
    }

    let content = messages[i].content;
    if (
      (typeof content === "string" && content.length === 0) ||
      (Array.isArray(content) && content.length === 0)
    ) {
      return;
    }
    if (typeof content === "string") {
      content = messages[i].content = [
        {
          type: "text",
          text: content,
        },
      ];
    }
    const last: Anthropic.Messages.ContentBlockParam = content[content.length - 1];

    // Sets the property of target, equivalent to target[propertyKey] = value when receiver === target.
    Reflect.set(last, "cache_control", {
      type: "ephemeral",
    });
  }
}

function classifyAnthropicError(err: unknown) {
  if (err instanceof Anthropic.APIError) {
    if (
      err.status === AnthropicErrorCode.PromptTooLong ||
      /prompts?\s+too\s+long/i.test(err.message)
    ) {
      return new ContextTooLongError(`Prompt too long: ${err.message}`);
    }

    if (err.status === AnthropicErrorCode.InvalidAPIKey) {
      return new AuthenticationError(`Invalid API key: ${err.message}`);
    } // end if (err.status === 401)

    if (err.status === AnthropicErrorCode.RateLimitError) {
      const retryAfter: unknown = asRecord(err.headers)["retry-after"];
      let message = "Rate Limited";
      if (retryAfter) {
        const s = Number.parseInt(asString(retryAfter));
        if (Number.isNaN(s)) {
          message += ", please wait.";
        }
        message += `, retry after ${asString(s)}s.`;
      } else {
        message += ", please wait.";
      }

      return new RateLimitError(message, retryAfter ? asString(retryAfter) : undefined);
    } // end if (err.status === 429)

    return new LLMError(`Anthropic API error (${asString(err.status)}): ${err.message}`);
  } // end if (err instanceof Anthropic.APIError)

  return new NetworkError(`Network error: ${asErrorString(err)}`);
}
