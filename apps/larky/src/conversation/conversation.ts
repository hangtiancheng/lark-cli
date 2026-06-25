/**
 * Status: Done
 */

export interface ToolUseBlock {
  toolUseId: string;
  toolName: string;
  arguments: Record<string, unknown>;
}

export interface ToolResultBlock {
  toolUseId: string;
  content: string;
  isError: boolean;
}

export interface ThinkingBlock {
  thinking: string;
  signature: string;
}

export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
  thinkingBlocks?: ThinkingBlock[] | undefined;
  toolUses?: ToolUseBlock[] | undefined;
  toolResults?: ToolResultBlock[] | undefined;
}

export class ConversationManager {
  private history: Message[] = [];
  private longTermMemoryInjected = false;

  addUserMessage(content: string): void {
    this.history.push({ role: "user", content });
  }

  addAssistantMessage(content: string): void {
    this.history.push({ role: "assistant", content });
  }

  addToolUseMessage(
    text: string,
    toolUseId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): void {
    this.history.push({
      role: "assistant",
      content: text,
      toolUses: [{ toolUseId, toolName, arguments: args }],
    });
  }

  addAssistantMessageWithTools(text: string, toolUses: ToolUseBlock[]): void {
    this.history.push({ role: "assistant", content: text, toolUses });
  }

  addAssistantFull(text: string, thinking: ThinkingBlock[], toolUses: ToolUseBlock[]): void {
    this.history.push({
      role: "assistant",
      content: text,
      thinkingBlocks: thinking.length > 0 ? thinking : undefined,
      toolUses: toolUses.length > 0 ? toolUses : undefined,
    });
  }

  addToolResultMessage(toolUseId: string, content: string, isError: boolean): void {
    this.history.push({
      role: "user",
      content: "",
      toolResults: [{ toolUseId, content, isError }],
    });
  }

  addToolResultsMessage(results: ToolResultBlock[]): void {
    this.history.push({
      role: "user",
      content: "",
      toolResults: results,
    });
  }

  addSystemReminder(content: string): void {
    this.history.push({
      role: "user",
      content: `<system-reminder>\n${content}\n</system-reminder>`,
    });
  }

  injectLongTermMemory(instructions: string, memories: string): void {
    if (this.longTermMemoryInjected) {
      return;
    }
    const sections: string[] = [];
    if (instructions) {
      sections.push(
        `
        # Larky.md
        Codebase and user instructions are as follows.
        You MUST adhere to these instructions.
        IMPORTANT: these instructions OVERRIDE any previous/default instructions, you MUST follow them exactly.\n\n
        ${instructions}
        `,
      );
    }
    if (memories) {
      sections.push(`## Auto Memory\n${memories}`);
    }
    if (sections.length === 0) {
      return;
    }
    const today = new Date().toISOString().split("T")[0];
    sections.push(`### Current Date\nToday's date is ${today}.`);
    const body = sections.join("\n\n");
    const wrapped = `<system-reminder>\nAs you answer the user's questions, you can use the following context:\n${body}\n
      IMPORTANT: This context may not be relevant to your tasks. You should NOT respond to this context unless it is highly relevant to your tasks.\n</system-reminder>
      `;

    this.history.unshift({ role: "user", content: wrapped });
    this.longTermMemoryInjected = true;
  }

  len(): number {
    return this.history.length;
  }

  truncateTo(index: number): void {
    if (index < 0) {
      index = 0;
    }

    if (index > this.history.length) {
      return;
    }

    this.history = this.history.slice(0, index);
  }

  getMessages(): Message[] {
    return [...this.history];
  }

  /**
   * Rebuild the history after a compaction:
   * A summary user message followed by the verbatim (完整) recent tail
   * (kept messages, structured preserved -- tool_use/tool_result blocks intact).
   * Use by `doCompact` so recent original messages survive instead of
   * being collapsed into the summary.
   * Mirrors Claude Code's `buildPostCompactMessages` ordering (summary first, then messagesToKeep).
   * No assistant ack -- the kept tail already starts with an assistant message in most cases, and injecting an artificial ack wastes tokens and confuses the model's sense of conversation flow.
   * @param summaryContent A summary user message
   * @param messagesToKeep Kept messages, structured preserved -- tool_use/tool_result blocks intact
   */
  replaceWithCompacted(summaryContent: string, messagesToKeep: Message[]): void {
    this.history = [{ role: "user", content: summaryContent }, ...messagesToKeep];
  }
}
