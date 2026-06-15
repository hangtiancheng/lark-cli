import OpenAI from "openai";
import type { LLMClient, MaxTokensSetter } from "./client.js";
import {
  getMaxOutputTokens,
  resolveAPIKey,
  type ProviderConfig,
} from "../config/config.js";
import { AuthenticationError } from "./errors.js";
import type {
  ConversationManager,
  Message,
} from "../conversation/conversation.js";
import type { StreamEvent } from "./events.js";

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
    tools: Record<string, unknown>[],
    abortSignal?: AbortSignal,
  ): AsyncGenerator<StreamEvent> {
    const messages = buildOpenAIInput(conversation.getMessages());

    const input: OpenAI.Responses.ResponseCreateParamsStreaming["input"] = [];


    yield {

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
