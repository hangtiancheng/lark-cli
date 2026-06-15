// LLM-driven context compression: summarize conversation history to reduce token usage
import type Anthropic from "@anthropic-ai/sdk";

import { EventBus } from "../events/bus.js";
import type { LLMProvider } from "../llm/base.js";
import type { ExecutionContext } from "../context.js";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const COMPACT_PROMPT = `You are compressing an agent conversation into a handoff summary.
Another LLM instance will continue this task from your summary alone — make it complete.

Structure your response with exactly these six sections:

## 1. Original Goal
One sentence describing what the user asked the agent to accomplish.

## 2. Completed Steps
Bullet list of what has been done. Be specific (file paths, commands run, decisions made).

## 3. Key Constraints & Discoveries
Facts learned during the run that affect future decisions (e.g., API limitations, file formats, user preferences stated mid-conversation).

## 4. Current File State
For each file that was created or modified: path, a one-line description of its current state.

## 5. Remaining TODOs
Ordered list of what still needs to be done to complete the original goal.

## 6. Critical Data
Any values the next LLM needs verbatim: IDs, tokens, exact error messages, config values discovered during the run.

Be concise. Omit reasoning steps and intermediate attempts. Keep conclusions.`;

export interface CompactionResult {
  summaryText: string;
  originalTokenEstimate: number;
  summaryTokens: number;
}

export class Compactor {
  private _bus: EventBus;
  private _sessionDir: string;
  private _sessionId: string;

  constructor(bus: EventBus, sessionDir: string, sessionId: string) {
    this._bus = bus;
    this._sessionDir = sessionDir;
    this._sessionId = sessionId;
  }

  // Compact ExecutionContext messages in-place, replacing with summary + acknowledgment
  async compact(
    context: ExecutionContext,
    provider: LLMProvider,
    focus = "",
  ): Promise<CompactionResult | null> {
    const result = await this.compactMessages(context.messages, provider, focus);
    if (!result) return null;

    context.messages = [
      { role: "user", content: result.summaryText },
      {
        role: "assistant",
        content: "Understood, I'll continue from this summary.",
      },
    ];
    this._writeSummary(result.summaryText);
    await this._bus.publish({
      type: "context.compacted",
      session_id: this._sessionId,
      run_id: context.runId,
      original_tokens: result.originalTokenEstimate,
      summary_tokens: result.summaryTokens,
      timestamp: new Date().toISOString(),
    });
    return result;
  }

  // Pure functional compression: takes messages, returns CompactionResult or null on failure
  async compactMessages(
    messages: Anthropic.MessageParam[],
    provider: LLMProvider,
    focus = "",
  ): Promise<CompactionResult | null> {
    const originalEstimate = messages.reduce((sum, m) => sum + this._estimateTokens(m.content), 0);

    const historyText = this._messagesToText(messages);
    let prompt = COMPACT_PROMPT;
    if (focus.trim()) {
      prompt += `\n\nIMPORTANT: Pay special attention to: ${focus.trim()}`;
    }

    const compressRequest: Anthropic.MessageParam[] = [
      {
        role: "user",
        content: `${prompt}\n\n---\n\n${historyText}`,
      },
    ];

    try {
      // Use silent bus to avoid polluting parent event stream
      const silentBus = new EventBus();
      const response = await provider.chat(compressRequest, [], silentBus, "compact", {
        step: 0,
        system: "You are a helpful assistant that summarizes conversations.",
      });

      const summaryText = response.text.trim();
      if (!summaryText) {
        return null;
      }

      const summaryTokens = response.usage?.outputTokens ?? Math.floor(summaryText.length / 4);

      return {
        summaryText,
        originalTokenEstimate: originalEstimate,
        summaryTokens,
      };
    } catch (error) {
      console.error("compactor: LLM call failed, skipping compaction", error);
      return null;
    }
  }

  // Estimate token count from message content (rough approximation: chars / 4)
  private _estimateTokens(content: string | Anthropic.ContentBlockParam[]): number {
    if (typeof content === "string") {
      return Math.floor(content.length / 4);
    }
    if (Array.isArray(content)) {
      return Math.floor(JSON.stringify(content).length / 4);
    }
    return 0;
  }

  // Serialize messages to human-readable text for LLM consumption
  private _messagesToText(messages: Anthropic.MessageParam[]): string {
    const parts: string[] = [];
    for (const msg of messages) {
      const role = msg.role.toUpperCase();
      const { content } = msg;
      if (typeof content === "string") {
        parts.push(`[${role}]\n${content}`);
      } else if (Array.isArray(content)) {
        const blocks: string[] = [];
        for (const block of content) {
          if (block.type === "text") {
            blocks.push(block.text);
          } else if (block.type === "tool_use") {
            blocks.push(
              `<tool_call name=${block.name} id=${block.id}>\n${JSON.stringify(block.input)}\n`,
            );
          } else if (block.type === "tool_result") {
            const resultContent =
              typeof block.content === "string" ? block.content : JSON.stringify(block.content);
            blocks.push(`<tool_result id=${block.tool_use_id}>\n${resultContent}\n</tool_result>`);
          }
        }
        parts.push(`[${role}]\n${blocks.join("\n")}`);
      }
    }
    return parts.join("\n\n");
  }

  // Write summary text to session directory
  private _writeSummary(text: string): void {
    try {
      mkdirSync(this._sessionDir, { recursive: true });
      const timestamp = new Date()
        .toISOString()
        .slice(0, 19)
        .replace(/[-:]/g, "")
        .replace("T", "_");
      const summaryPath = path.join(this._sessionDir, `summary_${timestamp}.md`);
      writeFileSync(summaryPath, text, "utf-8");
    } catch (error) {
      console.error("compactor: failed to write summary file", error);
    }
  }
}
