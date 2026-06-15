import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import yaml from "js-yaml";

const parseYaml = yaml.load.bind(yaml);

const ENV_KEY_MAP = {
	anthropic: "ANTHROPIC_API_KEY",
	openai: "OPENAI_API_KEY",
	"openai-compat": "OPENAI_API_KEY",
} as const;

const VALID_PROTOCOLS = new Set(["anthropic", "openai", "openai-compat"]);

export class ConfigError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ConfigError";
	}
}

export interface ProviderConfig {
	name: string;
	/**
	 * enum: ["anthropic", "openai", "openai-compat"]
	 */
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
	const model_ = model.toLowerCase();
	for (const [m, window] of MODEL_CONTEXT_WINDOWS) {
		if (model_.includes(m)) return window;
	}
	return model_.includes("claude") ? 200_000 : 128_000;
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
	if (p.protocol === "anthropic") {
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

// Test-only: clears the per-provider auto-fetch cache.
export function _resetContextWindowCache() {
	fetchedWindowCache.clear();
}

export function getMaxOutputTokens(p: ProviderConfig): number {
	if (p.max_output_tokens && p.max_output_tokens > 0) {
		return p.max_output_tokens;
	}
	if (p.thinking) {
		return 640_000;
	}
	return 8192;
}

export function resolveAPIKey(p: ProviderConfig): string {
	if (p.api_key) {
		return p.api_key;
	}

	const envVar =
		p.protocol in ENV_KEY_MAP
			? ENV_KEY_MAP[p.protocol as keyof typeof ENV_KEY_MAP]
			: "";
	if (!envVar) {
		return "";
	}
	return process.env[envVar] ?? "";
}

export interface MCPServerConfig {
	name: string;
	command?: string;
	args?: string[];
	url?: string;
	transport?: string;
	headers?: Record<string, string>;
	env?: Record<string, string>;
}

export interface HookConfig {
	id?: string;
	event: string;
	condition?: string;
	action: {
		type: string;
		command?: string;
		url?: string;
		method?: string;
		prompt?: string;
	};
	reject?: boolean;
	once?: boolean;
	async?: boolean;
	on_error?: string;
}

export interface AppConfig {
	providers: ProviderConfig[];
	permission_mode?: string | undefined;
	mcp_servers: MCPServerConfig[];
	hooks: HookConfig[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function loadSingleFile(path: string): AppConfig {
	const data = readFileSync(path, "utf-8");
	const raw = parseYaml(data);
	if (!isRecord(raw)) {
		console.error(`Invalid yaml: ${path}`);
		return { providers: [], mcp_servers: [], hooks: [] };
	}

	return {
		providers: (raw.providers as ProviderConfig[]) ?? [],
		permission_mode: raw.permission_mode as string | undefined,
		mcp_servers: (raw.mcp_servers as MCPServerConfig[]) ?? [],
		hooks: (raw.hooks as HookConfig[]) ?? [],
	};
}

export function mergeConfig(base: AppConfig, override: AppConfig): AppConfig {
	if (override.providers.length > 0) {
		base.providers = override.providers;
	}

	if (override.permission_mode) {
		base.permission_mode = override.permission_mode;
	}

	if (override.mcp_servers.length > 0) {
		/** base mcp server to index */
		const mcpToIdx = new Map<string, number>();
		for (let i = 0; i < base.mcp_servers.length; i++) {
			const mcp = base.mcp_servers[i];
			mcpToIdx.set(mcp.name, i);
		}

		for (const s of override.mcp_servers) {
			const idx = mcpToIdx.get(s.name);
			if (idx !== undefined) {
				base.mcp_servers[idx] = s;
			} else {
				base.mcp_servers.push(s);
				mcpToIdx.set(s.name, base.mcp_servers.length - 1);
			}
		}
	}

	base.hooks = [...base.hooks, ...override.hooks];
	return base;
}

function validateProviders(config: AppConfig): void {
	if (config.providers.length === 0) {
		throw new ConfigError("At least one provider MUST be configured.");
	}

	const requiredFields = ["name", "protocol", "base_url", "model"] as const;
	for (let i = 0; i < config.providers.length; i++) {
		const provider = config.providers[i];
		const values = {
			name: provider.name,
			protocol: provider.protocol,
			base_url: provider.base_url,
			model: provider.model,
		} as const;
		const missing = requiredFields.filter((field) => !(field in values));
	}
}
