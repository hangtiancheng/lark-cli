import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { LLMClient } from "../llm/client.js";
import { ConversationManager } from "../conversation/conversation.js";
import { MemoryManager } from "./manager.js";

/**
 * MemoryExtractor implements a background memory extraction sub-agent.
 *
 * Extraction and merging strategy:
 * - inProgress flag prevents concurrent extractions: only one extraction is allowed to run at a time
 * - pendingContext queue: if a new request arrives while an extraction is in progress, it is queued as a tail run
 * - The tail run is automatically executed after the current extraction completes (coalescing)
 */
export class MemoryExtractor {
  private client: LLMClient;
  private workDir: string;

  private inProgress = false;
  private pendingContext: string | null = null;

  constructor(client: LLMClient, workDir: string) {
    this.client = client;
    this.workDir = workDir;
  }

  /**
   * Entry point for memory extraction. Supports a coalescing strategy:
   * - If an extraction is already in progress, queues the request as pendingContext
   * - Automatically executes the queued request after the current extraction completes
   */
  async extract(conversationSummary: string): Promise<string[]> {
    // Coalescing strategy: if an extraction is already in progress, queue the request for subsequent execution
    if (this.inProgress) {
      this.pendingContext = conversationSummary;
      return [];
    }

    return this.runExtraction(conversationSummary);
  }

  /** Actually executes the extraction logic, with inProgress mutex and trailing run support */
  private async runExtraction(conversationSummary: string): Promise<string[]> {
    this.inProgress = true;
    let result: string[] = [];

    try {
      result = await this.doExtract(conversationSummary);
    } finally {
      this.inProgress = false;

      // If there is a queued trailing extraction request, dequeue and execute it
      const pending = this.pendingContext;
      this.pendingContext = null;
      if (pending !== null) {
        // Trailing run: re-execute using the latest context
        const trailingResult = await this.runExtraction(pending);
        result = [...result, ...trailingResult];
      }
    }

    return result;
  }

  /** Core extraction logic: invokes the LLM to analyze the conversation and extract memories worth saving */
  private async doExtract(conversationSummary: string): Promise<string[]> {
    const conversation = new ConversationManager();
    conversation.addUserMessage(
      "Based on the following conversation, extract any memories worth saving.\n" +
        "For each memory, output it in this format:\n" +
        "MEMORY_NAME: <kebab-case-name>\n" +
        "MEMORY_TYPE: <user|feedback|project|reference>\n" +
        "MEMORY_DESC: <one-line description>\n" +
        "MEMORY_BODY: <content>\n" +
        "---\n\n" +
        "If no memories are worth saving, output NONE.\n\n" +
        "Conversation:\n" +
        conversationSummary,
    );

    let response = "";
    const stream = this.client.stream(conversation, []);
    for await (const event of stream) {
      if (event.type === "text_delta") {
        response += event.text;
      }
    }

    if (response.trim() === "NONE" || !response.includes("MEMORY_NAME:")) {
      return [];
    }

    const userDir = join(homedir(), ".larky", "memory");
    const projectDir = join(this.workDir, ".larky", "memory");
    const saved: string[] = [];

    const blocks = response.split("---").filter((b) => b.includes("MEMORY_NAME:"));
    for (const block of blocks) {
      const name = extractField(block, "MEMORY_NAME");
      const type = extractField(block, "MEMORY_TYPE") || "reference";
      const desc = extractField(block, "MEMORY_DESC");
      const body = extractField(block, "MEMORY_BODY");

      if (!name || !body) {
        continue;
      }

      // Dual-path routing: project/reference go to the project directory; user/feedback go to the global user directory
      const dir = type === "project" || type === "reference" ? projectDir : userDir;
      mkdirSync(dir, { recursive: true });

      // Place the type field at the top level (cross-language compatible format, consistent with the Go version)
      const content = `---\nname: ${name}\ndescription: ${desc}\ntype: ${type}\n---\n\n${body}\n`;

      writeFileSync(join(dir, `${name}.md`), content, "utf-8");
      saved.push(name);
    }

    // Rebuild the MEMORY.md index after writing new memories
    if (saved.length > 0) {
      const manager = new MemoryManager(this.workDir);
      manager.rebuildIndex();
    }

    return saved;
  }
}

function extractField(block: string, field: string): string {
  const regex = new RegExp(`${field}:\\s*(.+?)(?:\\n|$)`);
  const match = block.match(regex);
  return match?.[1]?.trim() ?? "";
}
