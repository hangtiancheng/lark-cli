import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import yaml from "js-yaml";

const ENV_KEY_MAP = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  "openai-compat": "OPENAI_API_KEY",
};

const VALID_PROTOCOLS = new Set(["anthropic", "openai", "openai-compat"]);

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export interface ProviderConfig {
  name: string;
  protocol: string;
  base_url: string;
  model: string;
  api_key?: string;
  thinking?: boolean;
  context_window?: number;
  max_output_tokens?: number;
}

// Built-in model-name → context-window map
// Values are reasonable starting points and MAY become stale as vendors update models — if a value is wrong,
// set `context_window` in the provider config to override it.
const MODEL_CONTEXT_WINDOWS: readonly [string, number][] = [
  // 1M-token variants (e.g. "...-1m") come first so they win over the base family.
  ["1m", 1_000_000],
  ["gpt-4.1", 1_000_000],
  ["gpt-4o", 128_000],
  ["gpt-4-turbo", 128_000],
  ["o1", 200_000],
  ["o3", 200_000],
  ["o4", 200_000],
  ["gpt-3.5", 16_385],
  ["claude", 200_000],
];

// Look up the built-in table by substring,
// then fall back to the conservative defaults (claude → 200k, otherwise → 128k).
export function lookupModelContextWindow(model: string): number {
  const lower = model.toLowerCase();
  for (const [m, window] of MODEL_CONTEXT_WINDOWS) {
    if (lower.includes(m)) return window;
  }
  return lower.includes("claude") ? 200_000 : 128_000;
}

// Synchronous context-window resolver
// 1. config-supplied context_window > 0 → use it (highest priority)
// 2. built-in model-name → window table (substring match)
// 3. conservative (保守) default (claude → 200k / else → 128k)
export function getContextWindow(p: ProviderConfig): number {
  if (p.context_window && p.context_window > 0) return p.context_window;
  return lookupModelContextWindow(p.model);
}

// Memoizes the auto-fetched window per provider name+model 
// so we only hit the network once even if resolution is requested repeatedly.
const fetchedWindowCache = new Map<string, number>();

// Async context-window resolver
// 1. config context_window > 0 → use it (no network)
// 2. anthropic protocol -> fetcher(p) → ModelInfo.max_input_tokens (> 0)
// 3. built-in model-name → window table
// 4. conservative default
// `fetcher` is injected (defaults to fetchModelContextWindow)
// so it can be stubbed (打桩 / 桩替换) in tests.
// The fetcher itself must never throw — but we still guard here 
// so a rejected promise degrades silently to layers 3/4 instead of blocking startup.
export async function getContextWindowAsync(
  p: ProviderConfig,
  fetcher?: (p: ProviderConfig) => Promise<number>,
): Promise<number> {
  // 1. Explicit config always wins.
  if (p.context_window && p.context_window > 0) return p.context_window;

  // 2. Only the anthropic protocol exposes /v1/models/{model}.
  if (p.protocol === 'anthropic') {
    const key = `${p.name}-${p.model}`;
    let fetched = fetchedWindowCache.get(key);
    if (fetched === undefined) {
      try {
        // Lazy import of the anthropic fetcher
        // avoids a static config.ts ↔ anthropic.ts import cycle;
        // tests pass `fetcher` directly and never hit this path.
        const fn =
          fetcher ??
          (await import("../llm/anthropic.js")).fetchModelContextWindow;

        fetched = await fn(p);
      } catch (e) {
        console.error(e);
        fetched = 0;
      }
      fetchedWindowCache.set(key, fetched ?? 0);
    }
    if (fetched && fetched > 0) return fetched;
  }
  // 3. 4.
  return lookupModelContextWindow(p.model);
}
