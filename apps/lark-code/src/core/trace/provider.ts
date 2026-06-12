// TracingProvider: wraps a real LLMProvider to record trace entries before/after each chat() call
import { performance } from "node:perf_hooks";

import type Anthropic from "@anthropic-ai/sdk";

import type { EventBus } from "../events/bus.js";
import type { TraceWriter } from "./writer.js";
import type { LLMProvider } from "../llm/base.js";
import type { LlmResponse } from "../llm/types.js";

function now(): string {
  return new Date().toISOString();
}

export class TracingProvider implements LLMProvider {
  private _inner: LLMProvider;
  private _trace: TraceWriter;
  private _includePayload: boolean;

  // Wrap a real LLMProvider to record full API I/O in TraceWriter before/after each chat() call
  constructor(inner: LLMProvider, trace: TraceWriter, includePayload = true) {
    this._inner = inner;
    this._trace = trace;
    this._includePayload = includePayload;
  }

  // Record CORE→LLM request, call real provider, record LLM→CORE response (with latency)
  async chat(
    messages: Anthropic.MessageParam[],
    toolSchemas: Anthropic.ToolUnion[],
    bus: EventBus,
    runId: string,
    options?: { step?: number; system?: string | null },
  ): Promise<LlmResponse> {
    const step = options?.step ?? 0;
    const system = options?.system ?? null;

    const callData: Record<string, unknown> = this._includePayload
      ? { messages, tool_schemas: toolSchemas, system }
      : { message_count: messages.length, tool_count: toolSchemas.length };

    this._trace.emit({
      ts: now(),
      direction: "CORE→LLM",
      layer: "llm",
      kind: "api_call",
      run_id: runId,
      step,
      client_id: null,
      data: callData,
    });

    const t0 = performance.now();
    const result = await this._inner.chat(messages, toolSchemas, bus, runId, {
      step,
      system,
    });
    const latencyMs = Math.round(performance.now() - t0);

    const respData: Record<string, unknown> = this._includePayload
      ? {
          stop_reason: result.stopReason,
          text: result.text,
          tool_uses: result.toolUses,
          usage: result.usage ?? {},
          latency_ms: latencyMs,
        }
      : {
          stop_reason: result.stopReason,
          usage: result.usage ?? {},
          latency_ms: latencyMs,
        };

    this._trace.emit({
      ts: now(),
      direction: "LLM→CORE",
      layer: "llm",
      kind: "api_response",
      run_id: runId,
      step,
      client_id: null,
      data: respData,
    });

    return result;
  }
}
