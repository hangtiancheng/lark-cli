import OpenAI from "openai";
import type { LLMClient, MaxTokensSetter } from "./client.js";
import {
  getMaxOutputTokens,
  resolveAPIKey,
  type ProviderConfig,
} from "../config/config.js";
import {
  AuthenticationError,
  ContextTooLongError,
  LLMError,
  NetworkError,
  RateLimitError,
} from "./errors.js";
import type {
  ConversationManager,
  Message,
} from "../conversation/conversation.js";
import type { StreamEvent } from "./events.js";
import { asRecord, asString } from "../utils/index.js";

const enum OpenAIErrorCode {
  /** 413 Payload Too Large — The request entity is larger than the server is willing or able to process. */
  PromptTooLong = 413,
  /** 401 Unauthorized — The request lacks valid authentication credentials. */
  InvalidAPIKey = 401,
  /** 429 Too Many Requests — The client has sent too many requests in a given amount of time, triggering rate limiting. */
  RateLimitError = 429,
  /** 400 Bad Request — The request was invalid or malformed. */
  BadRequest = 400,
}

export class OpenAIClient implements LLMClient, MaxTokensSetter {
  private client: OpenAI;
  private model: string;
  private systemPrompt: string;
  private maxOutputTokens: number;

  constructor(config: ProviderConfig, systemPrompt: string) {
    const apiKey = resolveAPIKey(config);
    if (!apiKey) {
      throw new AuthenticationError(
        "OpenAI API key not found. Set OPENAI_API_KEY in .larky/config.y(a)ml, or via OPENAI_API_KEY env variable.",
      );
    }

    this.client = new OpenAI({
      apiKey,
      baseURL: config.base_url,
    });
    this.model = config.model;
    this.systemPrompt = systemPrompt;
    this.maxOutputTokens = getMaxOutputTokens(config);
  }
  async *stream(
    conversation: ConversationManager,
    toolSchemas: {
      input_schema: {
        properties?: unknown;
        required?: string[];
      } | null;
      name: string;
      description: string;
    }[],
    abortSignal?: AbortSignal,
  ): AsyncGenerator<StreamEvent> {
    const messages = buildOpenAIInput(conversation.getMessages());

    const input: OpenAI.Responses.ResponseCreateParamsStreaming["input"] = [];
    input.push({
      role: "system" as const,
      content: this.systemPrompt,
    });

    for (const message of messages) {
      input.push(message);
    }

    const tools: OpenAI.Responses.FunctionTool[] = toolSchemas.map((s) => {
      const schema = s.input_schema;
      return {
        type: "function" as const,
        name: s.name,
        description: s.description,
        parameters: schema,
        strict: true,
      };
    });

    const params: OpenAI.Responses.ResponseCreateParamsStreaming = {
      model: this.model,
      input,
      stream: true,
      max_output_tokens: this.maxOutputTokens,
      ...(tools.length > 0 ? { tools } : {}),
    };

    let inputTokens = 0;
    let outputTokens = 0;
    let cacheReadInputTokens = 0;
    // There is no cache_creation concept here, so it stays 0.
    const cacheCreationInputTokens = 0;

    try {
      const stream = await this.client.responses.create(params, {
        ...(abortSignal ? { signal: abortSignal } : {}),
      });

      let currentToolName = "";
      let currentToolId = "";
      let jsonAccumulate = "";

      for await (const event of stream) {
        if (event.type === "response.output_text.delta") {
          yield {
            type: "text_delta",
            text: event.delta,
          };
        } // end if (event.type === "response.output_text.delta")
        else if (event.type === "response.output_item.added") {
          if (event.item.type === "function_call") {
            currentToolName = event.item.name;
            currentToolId = event.item.call_id;
            jsonAccumulate = "";

            yield {
              type: "tool_use_start",
              toolName: currentToolName,
              toolId: currentToolId,
            };
          }
        } // end if (event.type === "response.output_item.added")
        else if (event.type === "response.output_item.done") {
          if (event.item.type === "function_call" && currentToolName) {
            let args: Record<string, unknown> = {};
            try {
              const parsed: unknown = JSON.parse(jsonAccumulate);
              args = asRecord(parsed);
              yield {
                type: "tool_use_complete",
                toolId: currentToolId,
                toolName: currentToolName,
                arguments: args,
              };

              // Reset
              currentToolName = "";
              currentToolId = "";
              jsonAccumulate = "";
            } catch (e) {
              console.error(e);
            }
          }
        } // end if (event.type === "response.output_item.done")
        else if (event.type === "response.completed") {
          const usage = event.response.usage;
          if (usage) {
            outputTokens = usage.output_tokens;

            // Responses API exposes the cached prefix via
            // input_tokens_details.cached_tokens, absent -> 0.
            // There is no cache_creation concept here, so it stays 0.
            cacheReadInputTokens = usage.input_tokens_details.cached_tokens;

            // input_tokens already includes the cached prefix;
            // subtract so the usage anchor (input + cache_read) doesn't double-count it.
            inputTokens = Math.max(
              0,
              usage.input_tokens - cacheReadInputTokens,
            );
          } // end if (usage)

          // Parse the actual stop reason from the Responses API.
          // When the response status is "incomplete",
          // check incomplete_details.reason
          // for 'max_output_tokens' so the agent loop's max_tokens recovery can trigger.
          // Otherwise default to "end_turn".
          let stopReason = "end_turn";
          const resp = event.response;
          if (resp.status === "incomplete") {
            const details = resp.incomplete_details;
            if (details?.reason === "max_output_tokens") {
              stopReason = "max_tokens";
            }
          }

          yield {
            type: "stream_end",
            stopReason,
            usage: {
              inputTokens,
              outputTokens,
              cacheReadInputTokens,
              cacheCreationInputTokens, // 0
            },
          };
        } // end if (event.type === "response.completed")
      }
    } catch (e) {
      console.error(e);
      throw classifyOpenAIError(e);
    }
  }

  setMaxOutputTokens(maxTokens: number): void {
    this.maxOutputTokens = maxTokens;
  }
}

type OpenAIMessageParam =
  | {
      role: "assistant" | "user" | "system";
      content: string;
    }
  | {
      type: "function_call";
      name: string;
      call_id: string;
      arguments: string;
    }
  | {
      type: "function_call_output";
      call_id: string;
      output: string;
    };

export function buildOpenAIInput(messages: Message[]): OpenAIMessageParam[] {
  const result: OpenAIMessageParam[] = [];
  for (const m of messages) {
    if (m.toolUses && m.toolUses.length > 0) {
      if (m.content) {
        result.push({
          role: "assistant",
          content: m.content,
        });
      } // end if (m.content)

      for (const tu of m.toolUses) {
        result.push({
          type: "function_call",
          name: tu.toolName,
          call_id: tu.toolUseId,
          arguments: JSON.stringify(tu.arguments),
        });
      }
    } // end if (m.toolUses && m.toolUses.length > 0)
    else if (m.toolResults && m.toolResults.length > 0) {
      for (const tr of m.toolResults) {
        result.push({
          type: "function_call_output",
          call_id: tr.toolUseId,
          output: tr.content,
        });
      }
    } // end if (m.toolResults && m.toolResults.length > 0)
    else {
      result.push({
        role: m.role,
        content: m.content,
      });
    }
  }

  return result;
}

function containsContextLengthError(msg: string): boolean {
  return (
    /context_length_exceeded/i.test(msg) ||
    /Maximum\sContext\sLength/i.test(msg) ||
    /Prompts?\s+Too\s+Long/i.test(msg)
  );
}

export function buildChatCompletionMessage(
  messages: Message[],
): OpenAI.ChatCompletionMessageParam[] {
  const params: OpenAI.ChatCompletionMessageParam[] = [];
  for (const m of messages) {
    if (m.toolUses && m.toolUses.length > 0) {
      params.push({
        role: "assistant",
        content: m.content || null,
        tool_calls: m.toolUses.map((tu) => ({
          id: tu.toolUseId,
          type: "function" as const,
          function: {
            name: tu.toolName,
            arguments: JSON.stringify(tu.arguments),
          },
        })),
      });
    } // if (m.toolUses && m.toolUses.length > 0)
    else if (m.toolResults && m.toolResults.length > 0) {
      for (const tr of m.toolResults) {
        params.push({
          role: "tool",
          tool_call_id: tr.toolUseId,
          content: tr.content,
        });
      }
    } // end if (m.toolResults && m.toolResults.length > 0)
    else if (m.role === "assistant") {
      params.push({
        role: "assistant",
        content: m.content,
      });
    } // if (m.role === "assistant")
    else {
      // user (includes system-reminder turns) and any stray system messages

      params.push({
        role: m.role === "system" ? "system" : "user",
        content: m.content,
      });
    }
  }
  return params;
}

export class OpenAICompatClient implements LLMClient, MaxTokensSetter {
  private client: OpenAI;
  private model: string;
  private systemPrompt: string;
  private maxOutputTokens: number;

  constructor(config: ProviderConfig, systemPrompt: string) {
    const apiKey = resolveAPIKey(config);
    if (!apiKey) {
      throw new AuthenticationError(
        "OpenAI API key not found. Set OPENAI_API_KEY in .larky/config.y(a)ml, or via OPENAI_API_KEY env variable.",
      );
    }
    this.client = new OpenAI({ apiKey, baseURL: config.base_url });
    this.model = config.model;
    this.systemPrompt = systemPrompt;
    this.maxOutputTokens = getMaxOutputTokens(config);
  }

  setMaxOutputTokens(maxTokens: number): void {
    this.maxOutputTokens = maxTokens;
  }

  async *stream(
    conversation: ConversationManager,
    toolSchemas: {
      input_schema: {
        properties?: unknown;
        required?: string[];
      } | null;
      name: string;
      description: string;
    }[],
    abortSignal?: AbortSignal,
  ): AsyncGenerator<StreamEvent> {
    const messages: OpenAI.ChatCompletionMessageParam[] = [
      {
        role: "system",
        content: this.systemPrompt,
      },

      ...buildChatCompletionMessages(conversation.getMessages()),
    ];

    const tools: OpenAI.ChatCompletionTool[] = toolSchemas.map((ts) => ({
      // name: ts.name,
      // description: ts.description,
      type: "function" as const,
      function: {
        name: ts.name,
        description: ts.description,
        arguments: ts.input_schema,
      },
    }));

    const params: OpenAI.ChatCompletionCreateParamsStreaming = {
      model: this.model,
      messages,
      stream: true,
      max_tokens: this.maxOutputTokens,
      ...(tools.length > 0 ? { tools } : {}),
    };

    let inputTokens = 0;
    let outputTokens = 0;
    let cacheReadInputTokens = 0;
    // There is no cache_creation concept here, so it stays 0.
    const cacheCreationInputTokens = 0;

    try {
      const stream = await this.client.chat.completions.create(params, {
        ...(abortSignal ? { signal: abortSignal } : {}),
      });

      const toolUses = new Map<
        number,
        {
          id: string;
          name: string;
          args: string;
        }
      >();

      /** enum: "length" | "tool_calls" */
      let finishReason: string | null = null;
      for await (const chunk of stream) {
        const delta = chunk.choices[0].delta;
        // if (!delta) continue;
        if (delta.content) {
          yield { type: "text_delta", text: delta.content };
        } // end if (delta.content)

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            if (!toolUses.has(tc.index)) {
              toolUses.set(tc.index, {
                id: tc.id ?? "",
                name: tc.function?.name ?? "",
                args: "",
              });

              if (tc.id) {
                yield {
                  type: "tool_use_start",
                  toolName: tc.function?.name ?? "",
                  toolId: tc.id ?? "",
                };
              }
            } // end if (!toolUses.has(tc.index))

            const existing = toolUses.get(tc.index);
            if (existing) {
              if (tc.id) {
                existing.id = tc.id;
              }

              if (tc.function?.name) {
                existing.name = tc.function.name;
              }

              if (tc.function?.arguments) {
                existing.args += tc.function.arguments;
                yield {
                  type: "tool_use_delta",
                  text: tc.function.arguments,
                };
              }
            } // end if (existing)
          }
        } // end if (delta.tool_calls)

        if (chunk.choices[0].finish_reason) {
          finishReason = chunk.choices[0].finish_reason;
          for (const tu of toolUses.values()) {
            const parsed: unknown = JSON.parse(tu.args);
            const args = asRecord(parsed);
            yield {
              type: "tool_use_complete",
              toolName: tu.name,
              toolId: tu.id,
              arguments: args,
            };
          }
        } // end if (chunk.choices[0].finish_reason)

        if (chunk.usage) {
          outputTokens = chunk.usage.completion_tokens;

          // Responses API exposes the cached prefix via
          // input_tokens_details.cached_tokens, absent -> 0.
          // There is no cache_creation concept here, so it stays 0.
          cacheReadInputTokens =
            chunk.usage.prompt_tokens_details?.cached_tokens ?? 0;

          // input_tokens already includes the cached prefix;
          // subtract so the usage anchor (input + cache_read) doesn't double-count it.
          inputTokens = Math.max(
            0,
            chunk.usage.prompt_tokens - cacheReadInputTokens,
          );
        }
      }

      // Map Chat Completions finish_reason to Larky's internal stop reason.
      // "length" means the model hit max_tokens
      // "tool_calls" means tool use;
      // "stop" (or anything else) means normal end_turn

      let stopReason: string;
      if (finishReason === "length") {
        stopReason = "max_tokens";
      } else if (finishReason === "tool_calls" || toolUses.size > 0) {
        stopReason = "tool_use";
      } else {
        stopReason = "end_turn";
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
      console.error(err);
      throw classifyOpenAIError(err);
    }
  }
}
function classifyOpenAIError(err: unknown) {
  if (err instanceof OpenAI.APIError) {
    if (
      err.status === OpenAIErrorCode.PromptTooLong ||
      (err.status === OpenAIErrorCode.BadRequest &&
        containsContextLengthError(err.message))
    ) {
      return new ContextTooLongError(`Context Too Long: ${err.message}`);
    }

    if (err.status === OpenAIErrorCode.InvalidAPIKey) {
      return new AuthenticationError(`Invalid API key: ${err.message}`);
    }

    if (err.status === OpenAIErrorCode.RateLimitError) {
      return new RateLimitError(`Rate limit error, please wait.`);
    }

    return new LLMError(
      `OpenAI API error (${asString(err.status)}): ${err.message}`,
    );
  }

  return new NetworkError(
    `Network error: ${err instanceof Error ? err.message : asString(err)}`,
  );
}

// Convert Larky's conversation into Chat Completions messages,
// preserving assistant tool_calls and tool_results (role: "tool") turns
// so multi-turn tool use works over the openai-compat (Chat Completions) endpoint.

export function buildChatCompletionMessages(
  messages: Message[],
): OpenAI.ChatCompletionMessageParam[] {
  const params: OpenAI.ChatCompletionMessageParam[] = [];
  for (const m of messages) {
    if (m.toolUses && m.toolUses.length > 0) {
      params.push({
        role: "assistant",
        content: m.content || null,
        tool_calls: m.toolUses.map((tu) => ({
          id: tu.toolUseId,
          type: "function" as const,
          function: {
            name: tu.toolName,
            arguments: JSON.stringify(tu.arguments),
          },
        })),
      });
    } // end if (m.toolUses && m.toolUses.length > 0)
    else if (m.toolResults && m.toolResults.length > 0) {
      for (const tr of m.toolResults) {
        params.push({
          role: "tool",
          tool_call_id: tr.toolUseId,
          content: tr.content,
        });
      }
    } // end if (m.toolResults && m.toolResults.length > 0)
    else if (m.role === "assistant") {
      params.push({
        role: "assistant",
        content: m.content,
      });
    } // end if (m.role === "assistant")
    else {
      params.push({
        role: m.role === "system" ? "system" : "user",
        content: m.content,
      });
    }
  }
  return params;
}
