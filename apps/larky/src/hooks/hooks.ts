import { execSync } from "node:child_process";
import type { HookConfig } from "../config/config.js";
import { asErrorString } from "../utils/index.js";
import { strArg } from "../utils/index.js";

export type EventName =
  | "session_start"
  | "session_end"
  | "turn_start"
  | "turn_end"
  | "pre_send"
  | "post_receive"
  | "pre_tool_use"
  | "post_tool_use"
  | "shutdown";

export interface HookContext {
  event: EventName;
  toolName?: string;
  args?: Record<string, unknown>;
  filePath?: string;
  message?: string | undefined;
}

export interface HookResult {
  output: string;
  success: boolean;
  reject: boolean;
}

export class HookEngine {
  private hooks: HookConfig[];
  private firedOnce = new Set<string>();
  private notifications: string[] = [];
  // Executor for agent-type hooks, injected externally. Returns a clear error if no agent runner is registered.
  agentRunner?: (prompt: string, ctx: HookContext) => Promise<string>;

  constructor(hooks: HookConfig[]) {
    this.hooks = hooks;
  }

  // Queue a message produced by a hook so the agent loop can surface it as a
  // system reminder on the next turn.
  recordNotification(message: string): void {
    if (message.trim()) {
      this.notifications.push(message);
    }
  }

  drainNotifications(): string[] {
    const out = this.notifications;
    this.notifications = [];
    return out;
  }

  async fire(event: EventName, context: HookContext): Promise<HookResult[]> {
    const results: HookResult[] = [];

    for (const hook of this.hooks) {
      if (hook.event !== event) {
        continue;
      }

      if (hook.once) {
        const key = hook.id ?? `${hook.event}-${hook.action.type}`;
        if (this.firedOnce.has(key)) {
          continue;
        }
        this.firedOnce.add(key);
      }

      if (hook.condition && !evaluateCondition(hook.condition, context)) {
        continue;
      }

      // Async hook: execute in the background without blocking the main flow
      if (hook.async) {
        this.executeAction(hook, context)
          .then((r) => {
            this.recordNotification(r.output);
          })
          .catch((err: unknown) => {
            this.recordNotification(`Async hook error: ${asErrorString(err)}`);
          });
        results.push({ output: "(async)", success: true, reject: false });
        continue;
      }

      try {
        const result = await this.executeAction(hook, context);
        results.push(result);

        if (result.reject && event === "pre_tool_use") {
          break;
        }
      } catch (err) {
        const onError = hook.on_error ?? "ignore";
        if (onError === "fail") {
          results.push({
            output: `Hook error: ${asErrorString(err)}`,
            success: false,
            reject: false,
          });
        } else if (onError === "reject") {
          results.push({
            output: `Hook error (rejecting): ${asErrorString(err)}`,
            success: false,
            reject: true,
          });
        }
      }
    }

    return results;
  }

  async firePreToolHooks(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<{ rejected: boolean; reason: string }> {
    const context: HookContext = {
      event: "pre_tool_use",
      toolName,
      args,
      filePath: strArg(args, "file_path", strArg(args, "path", "")),
    };

    const results = await this.fire("pre_tool_use", context);
    for (const r of results) {
      if (r.reject) {
        return { rejected: true, reason: r.output };
      }
    }
    return { rejected: false, reason: "" };
  }

  private async executeAction(hook: HookConfig, context: HookContext): Promise<HookResult> {
    switch (hook.action.type) {
      case "command": {
        const command = hook.action.command ?? "";
        try {
          const output = execSync(command, {
            encoding: "utf-8",
            timeout: 30000,
            env: {
              ...process.env,
              LARKY_EVENT: context.event,
              LARKY_TOOL: context.toolName ?? "",
              // Inject file path environment variable
              LARKY_FILE_PATH: context.filePath ?? "",
            },
          });
          return {
            output: output.trim(),
            success: true,
            reject: hook.reject ?? false,
          };
        } catch (err) {
          console.error(err);
          throw err;
        }
      }

      case "prompt": {
        return {
          output: hook.action.prompt ?? "",
          success: true,
          reject: false,
        };
      }

      case "http": {
        const url = hook.action.url ?? "";
        const method = hook.action.method ?? "POST";
        try {
          const resp = await fetch(url, {
            method,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(context),
          });
          const text = await resp.text();
          return {
            output: text,
            success: resp.ok,
            reject: hook.reject ?? false,
          };
        } catch (err) {
          console.error(err);
          throw err;
        }
      }

      case "agent": {
        // Agent-type hook: execute a sub-agent via the injected agentRunner
        if (!this.agentRunner) {
          return {
            output: "agent-type hook configured but no AgentRunner registered",
            success: false,
            reject: hook.reject ?? false,
          };
        }
        const prompt = hook.action.prompt ?? hook.action.command ?? "";
        try {
          const output = await this.agentRunner(prompt, context);
          return { output, success: true, reject: hook.reject ?? false };
        } catch (err) {
          return {
            output: asErrorString(err),
            success: false,
            reject: hook.reject ?? false,
          };
        }
      }

      default:
        return { output: "", success: true, reject: false };
    }
  }
}

function evaluateCondition(condition: string, ctx: HookContext): boolean {
  const parts = condition.split(/\s*(&&|\|\|)\s*/);

  let result = evaluateSingleCondition(parts[0], ctx);
  for (let i = 1; i < parts.length; i += 2) {
    const op = parts[i];
    const next = evaluateSingleCondition(parts[i + 1], ctx);
    if (op === "&&") {
      result = result && next;
    } else if (op === "||") {
      result = result || next;
    }
  }

  return result;
}

function evaluateSingleCondition(expr: string, ctx: HookContext): boolean {
  const trimmed = expr.trim();
  if (trimmed.startsWith("!")) {
    return !evaluateSingleCondition(trimmed.slice(1), ctx);
  }

  const eqMatch = /^(\w+)\s*==\s*"([^"]*)"$/.exec(trimmed);
  if (eqMatch) {
    const value = getContextValue(eqMatch[1], ctx);
    return value === eqMatch[2];
  }

  const neqMatch = /^(\w+)\s*!=\s*"([^"]*)"$/.exec(trimmed);
  if (neqMatch) {
    const value = getContextValue(neqMatch[1], ctx);
    return value !== neqMatch[2];
  }

  const regexMatch = /^(\w+)\s*=~\s*"([^"]*)"$/.exec(trimmed);
  if (regexMatch) {
    const value = getContextValue(regexMatch[1], ctx);
    try {
      return new RegExp(regexMatch[2]).test(value);
    } catch {
      return false;
    }
  }

  const globMatch = /^(\w+)\s*=\*\s*"([^"]*)"$/.exec(trimmed);
  if (globMatch) {
    const value = getContextValue(globMatch[1], ctx);
    const pattern = globMatch[2].replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*").replace(/\?/g, ".");
    try {
      return new RegExp(`^${pattern}$`).test(value);
    } catch {
      return false;
    }
  }

  return false;
}

function getContextValue(key: string, ctx: HookContext): string {
  switch (key) {
    case "tool":
      return ctx.toolName ?? "";
    case "event":
      return ctx.event;
    case "file_path":
      return ctx.filePath ?? "";
    case "message":
      return ctx.message ?? "";
    default:
      return strArg(ctx.args ?? {}, key, "");
  }
}

export function validate(hooks: HookConfig[]): Error | null {
  const validEvents = new Set<string>([
    "session_start",
    "session_end",
    "turn_start",
    "turn_end",
    "pre_send",
    "post_receive",
    "pre_tool_use",
    "post_tool_use",
    "shutdown",
  ]);
  const validActions = new Set(["command", "prompt", "http", "agent"]);

  const errors: string[] = [];

  for (let i = 0; i < hooks.length; i++) {
    const h = hooks[i];
    const label = h.id ? `hook[${String(i)}] (id="${h.id}")` : `hook[${String(i)}]`;

    // Required field: event
    if (!h.event) {
      errors.push(`${label}: event is required`);
    } else if (!validEvents.has(h.event)) {
      errors.push(`${label}: invalid event '${h.event}'`);
    }

    // Required field: action.type
    if (!h.action.type) {
      errors.push(`${label}: action.type is required`);
    } else if (!validActions.has(h.action.type)) {
      errors.push(`${label}: invalid action type '${h.action.type}'`);
    } else {
      // Check required fields specific to each action type
      switch (h.action.type) {
        case "command":
          if (!h.action.command?.trim()) {
            errors.push(`${label}: action.command must be non-empty for type "command"`);
          }
          break;
        case "prompt":
          if (!h.action.prompt?.trim()) {
            errors.push(`${label}: action.prompt must be non-empty for type "prompt"`);
          }
          break;
        case "http":
          if (!h.action.url?.trim()) {
            errors.push(`${label}: action.url must be non-empty for type "http"`);
          }
          break;
        case "agent":
          if (!h.action.prompt?.trim() && !h.action.command?.trim()) {
            errors.push(
              `${label}: action.prompt (or action.command) must be non-empty for type "agent"`,
            );
          }
          break;
      }
    }

    // reject and async are mutually exclusive: async hook results cannot synchronously intercept
    if (h.reject && h.async) {
      errors.push(`${label}: reject and async are mutually exclusive`);
    }
  }

  if (errors.length > 0) {
    return new Error(errors.join("; "));
  }
  return null;
}
