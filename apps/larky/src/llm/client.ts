import type { ConversationManager } from "../conversation/conversation.js";

export interface LLMClient {
  stream(
    conv: ConversationManager,
    tools: Record<string, unknown>,
    abortSignal?: AbortSignal,
  ): AsyncGenerator<StreamEvent>;
}
