import type { FileHistory } from "../file-history/file-history.js";
import type { FileStateCache } from "./file-state-cache.js";

export type ToolCategory = "read" | "write" | "command";

export interface ToolResult {
  output: string;
  isError: boolean;
}

export interface ToolContext {
  workDir: string;
  abortSignal?: AbortSignal;
  fileHistory: FileHistory;
  fileStateCache: FileStateCache;
}

export interface ToolSchema {
  name: string;
  parameters?: Record<string, unknown> | null;
  strict?: boolean | null;
  /** For OpenAI, this must be "function"; for Anthropic, it can be "custom" or null */
  type?: "function" | "custom" | null;
  defer_loading?: boolean;
  description?: string | null;

  /** The input schema for the tool. */
  input_schema: {
    type: "object";
    properties?: unknown;
    required?: string[] | null;
    [k: string]: unknown;
  };
  allowed_callers?: (
    | "direct"
    | "code_execution_20250825"
    | "code_execution_20260120"
  )[];
  cache_control?: { type: "ephemeral"; ttl?: "5m" | "1h" };
  eager_input_streaming?: boolean | null;
}

export interface Tool {
  name: string;
  description: string;
  category: ToolCategory;
  deferred?: boolean;
  system?: boolean;

  schema(): ToolSchema;
  execute(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult>;
}

export const SKIP_DIRS = new Set([
  ".claude", // Claude Code
  ".git", // Git
  ".larky", // Larky
  ".next", // Next.js
  ".venv", // Python venv
  "__pycache__", // Python
  "build", // C++
  "dist", // Webpack, Vite
  "node_modules", // Node.js
  "vendor", // Go
  "venv", // Python venv
]);

export function intArg(
  args: Record<string, unknown>,
  key: string,
  fallback: number,
): number {
  const v = args[key];
  if (typeof v === "number") {
    return Math.floor(v);
  }

  if (typeof v === "string") {
    const n = Number.parseInt(v, 10);
    return Number.isNaN(n) ? fallback : n;
  }

  return fallback;
}

export function strArg(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v === "string") {
    return v;
  }

  return String(v);
}

export function boolArg(args: Record<string, unknown>, key: string): boolean {
  const v = args[key];
  if (typeof v === "boolean") {
    return v;
  }

  return Boolean(v);
}
