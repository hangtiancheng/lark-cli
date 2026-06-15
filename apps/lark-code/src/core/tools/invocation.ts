// invoke_tool: validate params, check permissions, invoke with timeout, publish progress events, retry with exponential backoff on failure
import { performance } from "node:perf_hooks";

import type { EventBus } from "../events/bus.js";
import type { ToolUseBlock } from "../llm/types.js";
import type { PermissionManager } from "../permissions/manager.js";
import { RateLimitedError } from "./errors.js";
import type { ToolRegistry } from "./registry.js";
import { toolError, type ToolResult } from "./base.js";
import { isRecord } from "../bus/envelope.js";

const DEFAULT_TIMEOUT = 120_000; // 120s
const MAX_RETRIES = 2;
const RETRY_BASE_MS = 2000;
const RETRYABLE = new Set(["runtime_error", "rate_limited"]);

function now(): string {
  return new Date().toISOString();
}

// Wait for the specified number of milliseconds
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Promise with timeout wrapper
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("timeout"));
    }, ms);
    promise
      .then((v) => {
        clearTimeout(timer);
        resolve(v);
      })
      .catch((e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      });
  });
}

// Publish a ToolUseFailedEvent and return the corresponding ToolResult
async function fail(
  bus: EventBus,
  runId: string,
  toolUse: ToolUseBlock,
  errorClass: string,
  errorMessage: string,
  elapsedMs: number,
  attempt = 1,
): Promise<ToolResult> {
  await bus.publish({
    type: "tool.call_failed",
    run_id: runId,
    tool_use_id: toolUse.id,
    tool_name: toolUse.name,
    error_class: errorClass,
    error_message: errorMessage,
    elapsed_ms: elapsedMs,
    attempt,
    timestamp: now(),
  });
  return toolError(errorMessage, errorClass);
}

// Validate params, check permissions, invoke with timeout, publish progress events, retry with exponential backoff, return ToolResult (never throws)
export async function invokeTool(
  registry: ToolRegistry,
  toolUse: ToolUseBlock,
  bus: EventBus,
  runId: string,
  options?: {
    timeout?: number;
    permissionManager?: PermissionManager;
    sessionId?: string;
  },
): Promise<ToolResult> {
  const timeout = options?.timeout ?? DEFAULT_TIMEOUT;
  const permissionManager = options?.permissionManager;
  const sessionId = options?.sessionId ?? "";
  const t0 = performance.now();

  await bus.publish({
    type: "tool.call_started",
    run_id: runId,
    tool_use_id: toolUse.id,
    tool_name: toolUse.name,
    params: isRecord(toolUse.input) ? toolUse.input : {},
    timestamp: now(),
  });

  const elapsed = (): number => Math.round(performance.now() - t0);

  const tool = registry.get(toolUse.name);
  if (!tool) {
    return fail(bus, runId, toolUse, "runtime_error", `unknown tool: ${toolUse.name}`, elapsed());
  }

  // Parameter validation
  if (tool.paramsModel) {
    const result = tool.paramsModel.safeParse(toolUse.input);
    if (!result.success) {
      return fail(bus, runId, toolUse, "schema_error", String(result.error), elapsed());
    }
  }

  // Permission check
  if (permissionManager) {
    const params = isRecord(toolUse.input) ? toolUse.input : {};

    const emitPermission = async (raw: Record<string, unknown>): Promise<void> => {
      await bus.publish({
        type: "permission.requested",
        run_id: runId,
        tool_use_id: typeof raw["tool_use_id"] === "string" ? raw["tool_use_id"] : toolUse.id,
        tool_name: toolUse.name,
        params,
        params_preview: typeof raw["param_preview"] === "string" ? raw["param_preview"] : "",
        session_id: sessionId,
        timestamp: now(),
      });
    };

    const [allowed, decision] = await permissionManager.checkAndWait(
      toolUse.id,
      toolUse.name,
      params,
      sessionId,
      emitPermission,
    );

    if (allowed) {
      if (decision !== "auto_allow") {
        await bus.publish({
          type: "permission.granted",
          run_id: runId,
          tool_use_id: toolUse.id,
          decision,
          timestamp: now(),
        });
      }
    } else {
      if (decision !== "auto_deny") {
        await bus.publish({
          type: "permission.denied",
          run_id: runId,
          tool_use_id: toolUse.id,
          decision,
          timestamp: now(),
        });
      }
      return fail(
        bus,
        runId,
        toolUse,
        "permission_denied",
        "Permission denied by user. You may not execute this command. Try an alternative approach or ask the user what to do.",
        elapsed(),
      );
    }
  }

  // Retry loop
  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    let errorClass: string | null;
    let errorMessage: string | null;

    try {
      const result = await withTimeout(
        tool.invoke(isRecord(toolUse.input) ? toolUse.input : {}),
        timeout,
      );
      const ms = elapsed();

      if (result.isError) {
        errorClass = result.errorType ?? "runtime_error";
        errorMessage = result.content;
      } else {
        await bus.publish({
          type: "tool.call_finished",
          run_id: runId,
          tool_use_id: toolUse.id,
          tool_name: toolUse.name,
          elapsed_ms: ms,
          output: result.content,
          timestamp: now(),
        });
        return result;
      }
    } catch (exc) {
      if (exc instanceof RateLimitedError) {
        errorClass = "rate_limited";
        errorMessage = String(exc);
      } else if (exc instanceof Error && exc.message === "timeout") {
        return fail(
          bus,
          runId,
          toolUse,
          "timeout",
          `tool timed out after ${String(timeout / 1000)}s`,
          elapsed(),
          attempt,
        );
      } else {
        errorClass = "runtime_error";
        errorMessage = String(exc);
      }
    }

    const ms = elapsed();

    if (errorClass && RETRYABLE.has(errorClass) && attempt <= MAX_RETRIES) {
      await bus.publish({
        type: "tool.call_failed",
        run_id: runId,
        tool_use_id: toolUse.id,
        tool_name: toolUse.name,
        error_class: errorClass,
        error_message: errorMessage,
        elapsed_ms: ms,
        attempt,
        timestamp: now(),
      });
      await sleep(RETRY_BASE_MS * Math.pow(2, attempt - 1));
      continue;
    }

    return fail(bus, runId, toolUse, errorClass, errorMessage, ms, attempt);
  }

  // unreachable
  return toolError("internal error", "runtime_error");
}
