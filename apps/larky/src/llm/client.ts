import type { ProviderConfig } from "../config/config.js";
import type { ConversationManager } from "../conversation/conversation.js";
import type { StreamEvent } from "./events.js";

export interface ToolSchema {
  input_schema:
    | {
        properties?: unknown;
        required?: string[];
      }
    | undefined;
  name: string;
  description: string;
}

export interface LLMClient {
  stream(
    conversationManager: ConversationManager,
    toolSchemas: Record<string, unknown>[],
    abortSignal?: AbortSignal,
  ): AsyncGenerator<StreamEvent>;
}

export interface MaxTokensSetter {
  setMaxOutputTokens(maxTokens: number): void;
}

export async function createClient(
  config: ProviderConfig,
  systemPrompt: string,
) {
  switch (config.protocol) {
    case "anthropic": {
      const { AnthropicClient } = await import("./anthropic.js");
      return new AnthropicClient(config, systemPrompt);
    }

    case "openai": {
      //
    }

    case "openai-compat": {
      //
		}
			
		default:
			throw new Error(`Unknown protocol: ${config.protocol}`)
  }
}
