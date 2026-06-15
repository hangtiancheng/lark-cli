import type { ProviderConfig } from "../config/config.js";
import type { ConversationManager } from "../conversation/conversation.js";
import type { StreamEvent } from "./events.js";

export interface LLMClient {
	stream(
		conversationManager: ConversationManager,
		tools: Record<string, unknown>,
		abortSignal?: AbortSignal,
	): AsyncGenerator<StreamEvent>;
}

export interface MaxTokensSetter {
	setMaxOutputTokens(maxTokens: number): void;
}

export async function createClient(config: ProviderConfig) {}
