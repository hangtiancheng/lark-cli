// LLM related value types
import type Anthropic from "@anthropic-ai/sdk";

export interface UsageStats {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  contextPercent: number;
}

// Use SDK's ToolUseBlock directly to avoid custom types
export type ToolUseBlock = Anthropic.ToolUseBlock;

export interface LlmResponse {
  stopReason: string; // "end_turn" | "tool_use" | "max_tokens"
  toolUses: ToolUseBlock[];
  text: string;
  usage: UsageStats | null;
  // thinking blocks — use SDK's ThinkingBlock type
  thinkingBlocks: Anthropic.ThinkingBlock[];
}
