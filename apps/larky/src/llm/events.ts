export interface UsageInfo {
  inputTokens: number;
  outputTokens: number;
  // Cache token counts from the API usage block. Anthropic reports these directly;
  // OpenAI/compat usually report 0 (or only cache_read via prompt_tokens_details.cached_tokens).
  // They anchor the compact judgement's
  // real-token baseline (input + cache_read + cache_creation + output).
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
}

/** Tool use delta: Input partial JSON */
export type StreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "thinking_delta"; text: string }
  | { type: "thinking_complete"; thinking: string; signature: string }
  | { type: "tool_call_start"; toolName: string; toolId: string }
  | { type: "tool_call_delta"; text: string }
  | {
      type: "tool_call_complete";
      toolId: string;
      toolName: string;
      arguments: Record<string, unknown>;
    }
  | { type: "stream_end"; stopReason: string; usage: UsageInfo };
