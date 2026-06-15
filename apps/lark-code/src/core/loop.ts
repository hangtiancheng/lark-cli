// AgentLoop: plan-act-observe loop driver
import type { ContentBlockParam } from "@anthropic-ai/sdk/resources";

import type { EventBus } from "./events/bus.js";
import type { LLMProvider } from "./llm/base.js";
import { invokeTool } from "./tools/invocation.js";
import type { ToolRegistry } from "./tools/registry.js";
import type { ExecutionContext } from "./context.js";
import type { Compactor } from "./compact/compactor.js";
import type { PermissionManager } from "./permissions/manager.js";

function now(): string {
  return new Date().toISOString();
}

const SYSTEM_PROMPT =
  "You are a helpful AI assistant. " +
  "Use the available tools to complete the user's goal. " +
  "When the goal is fully achieved, respond with a final answer and do not call any more tools.";

export class AgentLoop {
  private _provider: LLMProvider;
  private _registry: ToolRegistry;
  private _bus: EventBus;
  private _permissionManager: PermissionManager | undefined;
  private _compactor: Compactor | undefined;
  private _compactThreshold: number;
  private _sessionId: string;
  private _signal: AbortSignal | undefined;

  constructor(
    provider: LLMProvider,
    registry: ToolRegistry,
    bus: EventBus,
    options?: {
      permissionManager?: PermissionManager;
      compactor?: Compactor;
      compactThreshold?: number;
      sessionId?: string;
      signal?: AbortSignal;
    },
  ) {
    this._provider = provider;
    this._registry = registry;
    this._bus = bus;
    this._permissionManager = options?.permissionManager;
    this._compactor = options?.compactor;
    this._compactThreshold = options?.compactThreshold ?? 0.8;
    this._sessionId = options?.sessionId ?? "";
    this._signal = options?.signal;
  }

  // Drive the plan-act-observe loop until the context signals completion
  async run(context: ExecutionContext): Promise<void> {
    while (!context.isDone()) {
      // Cooperative cancellation check
      if (this._signal?.aborted) {
        context.markFailed("cancelled");
        throw new Error("cancelled");
      }

      context.step++;
      await this._bus.publish({
        type: "step.started",
        run_id: context.runId,
        step: context.step,
        timestamp: now(),
      });

      // [plan] call LLM
      let response;
      try {
        response = await this._provider.chat(
          context.messages,
          this._registry.toolSchemas(),
          this._bus,
          context.runId,
          { step: context.step, system: context.systemPrompt(SYSTEM_PROMPT) },
        );
      } catch (exc) {
        if (this._signal?.aborted) {
          context.markFailed("cancelled");
          throw exc;
        }
        console.error(
          "LLM call failed run_id=%s step=%d",
          context.runId,
          String(context.step),
          exc,
        );
        context.markFailed("llm_error");
        break;
      }

      // [observe] append assistant content blocks
      const blocks: ContentBlockParam[] = [...response.thinkingBlocks];
      if (response.text) {
        blocks.push({ type: "text", text: response.text });
      }
      for (const tc of response.toolUses) {
        blocks.push({
          type: "tool_use",
          id: tc.id,
          name: tc.name,
          input: tc.input,
        });
      }
      context.addAssistantMessage(blocks);

      // [act] execute each requested tool
      if (response.stopReason === "tool_use") {
        for (const tc of response.toolUses) {
          const result = await invokeTool(this._registry, tc, this._bus, context.runId, {
            ...(this._permissionManager ? { permissionManager: this._permissionManager } : {}),
            sessionId: this._sessionId,
          });
          context.addToolResult(tc.id, result.content, result.isError);
        }
      } else if (response.stopReason === "max_tokens" && response.toolUses.length > 0) {
        for (const tc of response.toolUses) {
          context.addToolResult(
            tc.id,
            "Error: output token limit reached before this tool call could be completed. Please break the task into smaller steps and try again.",
            true,
          );
        }
      }

      // Termination check
      if (response.stopReason === "end_turn") {
        context.result = response.text || "";
        context.markSuccess();
      } else if (context.step >= context.maxSteps) {
        context.markFailed("exceeded_max_steps");
      }

      // Compaction check
      if (
        !context.isDone() &&
        response.stopReason === "tool_use" &&
        this._compactor &&
        this._compactThreshold > 0 &&
        response.usage &&
        response.usage.contextPercent >= this._compactThreshold
      ) {
        await this._compactor.compact(context, this._provider);
      }

      await this._bus.publish({
        type: "step.finished",
        run_id: context.runId,
        step: context.step,
        timestamp: now(),
      });
    }
  }
}
