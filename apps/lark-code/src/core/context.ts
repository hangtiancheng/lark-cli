// ExecutionContext: State container for each agent run
import type Anthropic from "@anthropic-ai/sdk";
import type { ToolResultBlockParam, ContentBlockParam } from "@anthropic-ai/sdk/resources";

export class ExecutionContext {
  readonly runId: string;
  readonly goal: string;
  readonly maxSteps: number;
  readonly systemPromptOverride: string | null;

  // Use SDK's MessageParam type directly
  messages: Anthropic.MessageParam[];
  step: number;
  status: string; // "running" | "success" | "failed"
  reason: string | null;
  result: string;

  private _sessionNotes: string;
  private _globalContext: string;
  private _projectContext: string;

  constructor(params: {
    runId: string;
    goal: string;
    maxSteps: number;
    prefillMessages?: Anthropic.MessageParam[];
    sessionNotes?: string;
    globalContext?: string;
    projectContext?: string;
    systemPromptOverride?: string | null;
  }) {
    this.runId = params.runId;
    this.goal = params.goal;
    this.maxSteps = params.maxSteps;
    this.systemPromptOverride = params.systemPromptOverride ?? null;
    this._sessionNotes = params.sessionNotes ?? "";
    this._globalContext = params.globalContext ?? "";
    this._projectContext = params.projectContext ?? "";

    this.step = 0;
    this.status = "running";
    this.reason = null;
    this.result = "";

    // Initialize message history, using session replay content if available
    const prefill = params.prefillMessages ?? [];
    if (prefill.length > 0) {
      this.messages = prefill.map((m) => ({ ...m }));
    } else {
      this.messages = [{ role: "user", content: this.goal }];
    }
  }

  // Return the system prompt for the current run; skip base if override is set, inject memory layers directly
  systemPrompt(base: string): string {
    const parts: string[] = [this.systemPromptOverride ?? base];

    if (this._globalContext.trim()) {
      parts.push(`\n\n## Global Context\n${this._globalContext.trim()}`);
    }
    if (this._projectContext.trim()) {
      parts.push(`\n\n## Project Context\n${this._projectContext.trim()}`);
    }
    if (this._sessionNotes.trim()) {
      parts.push(
        `\n\n## Session Notes\n${this._sessionNotes.trim()}\n\nRemember important durable facts by calling note_save.`,
      );
    }
    return parts.join("");
  }

  // Append LLM response content blocks as an assistant message
  addAssistantMessage(content: ContentBlockParam[]): void {
    this.messages.push({ role: "assistant", content });
  }

  // Append tool call results as a user message; multiple results from the same step share one message
  addToolResult(toolUseId: string, content: string, isError = false): void {
    const block: ToolResultBlockParam = {
      type: "tool_result",
      tool_use_id: toolUseId,
      content,
      ...(isError ? { is_error: true } : {}),
    };

    const last = this.messages[this.messages.length - 1];
    if (
      last.role === "user" &&
      Array.isArray(last.content) &&
      last.content.length > 0 &&
      last.content.every((b) => b.type === "tool_result")
    ) {
      last.content.push(block);
    } else {
      this.messages.push({ role: "user", content: [block] });
    }
  }

  // Return true if the loop should stop
  isDone(): boolean {
    return this.status !== "running";
  }

  // Mark the run as successful
  markSuccess(): void {
    this.status = "success";
  }

  // Mark the run as failed with a reason
  markFailed(reason: string): void {
    this.status = "failed";
    this.reason = reason;
  }
}
