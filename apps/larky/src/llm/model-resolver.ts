import type { ProviderConfig } from "../config/config.js";
import { createClient, type LLMClient } from "./client.js";

const MODEL_ALIASES: Record<string, string> = {
  haiku: "claude-haiku-4-5-20251001",
  sonnet: "claude-sonnet-4-6-20250514",
  opus: "claude-opus-4-6-20250514",
};

export function resolveModelId(shortName: string): string {
  return MODEL_ALIASES[shortName] ?? shortName;
}

// Returns a function that builds a client for a given short model name,
// reusing the base provider config (api key, base url, protocol) but swapping the model.
export function createModelResolver(
  baseConfig: ProviderConfig,
  systemPrompt: string,
): (shortName: string) => Promise<LLMClient> {
  return (shortName) => {
    return createClient(
      {
        ...baseConfig,
        model: resolveModelId(shortName),
      },
      systemPrompt,
    );
  };
}
