// LLM Provider interface definition
import type Anthropic from "@anthropic-ai/sdk";

import type { EventBus } from "../events/bus.js";
import type { LlmResponse } from "./types.js";

export interface LLMProvider {
  // Stream LLM call, publish progress events, return complete response
  chat(
    messages: Anthropic.MessageParam[],
    toolSchemas: Anthropic.ToolUnion[],
    bus: EventBus,
    runId: string,
    options?: {
      step?: number;
      system?: string | null;
    },
  ): Promise<LlmResponse>;
}
