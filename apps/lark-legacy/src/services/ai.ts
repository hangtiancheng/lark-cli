import {
  AIMessage,
  AIMessageChunk,
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { ChatOllama } from "@langchain/ollama";
import { getConfig } from "../config.js";
import {
  createDirReadTool,
  createFileDeleteTool,
  createFileModifyTool,
  createFileReadTool,
  createFileWriteTool,
} from "../engine/ai/tools/file-tools.js";
import { createShellTool } from "../engine/ai/tools/shell-tool.js";
import { getLogger } from "../logger.js";
import type { Message, StreamCallback } from "../types.js";
import { buildRagPrompt, type DocumentRetriever } from "./rag.js";

const MAX_TOOL_ROUNDS = 10;

function createOllamaLlm(): ChatOllama {
  const cfg = getConfig().ai;
  return new ChatOllama({
    baseUrl: cfg.baseUrl,
    model: cfg.modelName,
  });
}

function createChatTools(): StructuredToolInterface[] {
  const cwd = process.cwd();
  return [
    createFileReadTool(cwd),
    createFileWriteTool(cwd),
    createFileModifyTool(cwd),
    createFileDeleteTool(cwd),
    createDirReadTool(cwd),
    createShellTool(),
  ];
}

function buildSystemPrompt(tools: StructuredToolInterface[]): string {
  const cwd = process.cwd();
  const date = new Date().toISOString().split("T")[0];
  const toolNames = tools.map((t) => t.name).join(", ");
  return [
    "You are Lark, an interactive CLI assistant that helps users with software engineering tasks.",
    "You can answer questions, explain code, help with debugging, read/write files, and run shell commands.",
    "",
    `Working directory: ${cwd}`,
    `Date: ${date}`,
    `Available tools: ${toolNames}`,
    "",
    "Use the available tools when the user asks you to perform file operations, run commands, or interact with the project.",
    "Keep responses concise and relevant. Use markdown formatting when helpful.",
    "If you don't know something, say so rather than guessing.",
  ].join("\n");
}

function toBaseMessages(messages: Message[]): BaseMessage[] {
  return messages.map((m) => (m.isUser ? new HumanMessage(m.content) : new AIMessage(m.content)));
}

function extractTextContent(msg: AIMessage): string {
  if (typeof msg.content === "string") return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter((block): block is { type: "text"; text: string } => {
        const b = block as Record<string, unknown>;
        return b.type === "text" && typeof b.text === "string";
      })
      .map((block) => block.text)
      .join("");
  }
  return JSON.stringify(msg.content);
}

async function executeToolCalls(
  msg: AIMessage,
  toolMap: Map<string, StructuredToolInterface>,
): Promise<ToolMessage[]> {
  const calls = msg.tool_calls ?? [];
  const results: ToolMessage[] = [];
  for (const call of calls) {
    const t = toolMap.get(call.name);
    let output: string;
    if (t) {
      try {
        output = String(await t.invoke(call.args));
      } catch (err) {
        output = `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    } else {
      output = `Error: unknown tool "${call.name}"`;
    }
    results.push(
      new ToolMessage({
        content: output,
        tool_call_id: call.id ?? call.name,
        name: call.name,
      }),
    );
  }
  return results;
}

export class ChatAgent {
  private llm: ChatOllama;
  private tools: StructuredToolInterface[];
  private toolMap: Map<string, StructuredToolInterface>;
  private history: Message[] = [];
  private sessionId: string;
  private retriever: DocumentRetriever | null = null;

  constructor(sessionId: string) {
    this.llm = createOllamaLlm();
    this.tools = createChatTools();
    this.toolMap = new Map(this.tools.map((t) => [t.name, t]));
    this.sessionId = sessionId;
  }

  setRetriever(retriever: DocumentRetriever | null): void {
    this.retriever = retriever;
  }

  getSessionId(): string {
    return this.sessionId;
  }

  loadHistory(messages: Message[]): void {
    this.history = [...messages];
  }

  addUserMessage(content: string): void {
    this.history.push({ sessionId: this.sessionId, content, isUser: true });
  }

  addAiMessage(content: string): void {
    this.history.push({ sessionId: this.sessionId, content, isUser: false });
  }

  private async enhanceWithRag(messages: BaseMessage[]): Promise<BaseMessage[]> {
    if (!this.retriever || messages.length === 0) return messages;
    const lastMessage = messages[messages.length - 1];
    const query = typeof lastMessage.content === "string" ? lastMessage.content : "";
    try {
      const docs = await this.retriever.retrieveDocuments(query);
      if (docs.length === 0) return messages;
      const ragPrompt = buildRagPrompt(query, docs);
      return [...messages.slice(0, -1), new HumanMessage(ragPrompt)];
    } catch {
      return messages;
    }
  }

  async response(userMessage: string): Promise<string> {
    const log = getLogger();
    this.addUserMessage(userMessage);
    let baseMessages = toBaseMessages(this.history);
    baseMessages = await this.enhanceWithRag(baseMessages);

    const systemMsg = new SystemMessage(buildSystemPrompt(this.tools));
    const llmWithTools = this.llm.bindTools(this.tools);

    log.debug({ sessionId: this.sessionId, messageCount: baseMessages.length }, "ai.invoke start");
    const startMs = Date.now();

    let conversationMessages: BaseMessage[] = [systemMsg, ...baseMessages];
    let finalText = "";

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const res = await llmWithTools.invoke(conversationMessages);
      const toolCalls = res.tool_calls ?? [];

      if (toolCalls.length === 0) {
        finalText = extractTextContent(res);
        break;
      }

      log.debug(
        { sessionId: this.sessionId, round, toolCalls: toolCalls.map((c) => c.name) },
        "ai.tool_calls",
      );
      conversationMessages.push(res);
      const toolResults = await executeToolCalls(res, this.toolMap);
      conversationMessages.push(...toolResults);
    }

    log.debug(
      {
        sessionId: this.sessionId,
        durationMs: Date.now() - startMs,
        contentLength: finalText.length,
      },
      "ai.invoke done",
    );

    this.addAiMessage(finalText);
    return finalText;
  }

  async responseStream(
    userMessage: string,
    cb: StreamCallback,
    signal?: AbortSignal,
  ): Promise<string> {
    const log = getLogger();
    this.addUserMessage(userMessage);
    let baseMessages = toBaseMessages(this.history);
    baseMessages = await this.enhanceWithRag(baseMessages);

    const systemMsg = new SystemMessage(buildSystemPrompt(this.tools));
    const llmWithTools = this.llm.bindTools(this.tools);

    log.debug({ sessionId: this.sessionId, messageCount: baseMessages.length }, "ai.stream start");
    const startMs = Date.now();

    let conversationMessages: BaseMessage[] = [systemMsg, ...baseMessages];
    let fullContent = "";

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      if (signal?.aborted) {
        log.debug({ sessionId: this.sessionId }, "ai.stream aborted before round");
        break;
      }

      const collected: AIMessageChunk[] = [];
      const stream = await llmWithTools.stream(conversationMessages, { signal });
      let roundText = "";

      try {
        for await (const chunk of stream) {
          if (signal?.aborted) {
            log.debug({ sessionId: this.sessionId }, "ai.stream aborted");
            break;
          }
          collected.push(chunk);
          const text = typeof chunk.content === "string" ? chunk.content : "";
          if (text.length > 0) {
            roundText += text;
            fullContent += text;
            cb(text);
          }
        }
      } catch (err) {
        if (signal?.aborted) break;
        throw err;
      }

      const merged = collected.reduce<AIMessageChunk | null>((acc, c) => {
        if (!acc) return c;
        return acc.concat(c);
      }, null);

      if (!merged) break;

      const toolCalls = merged.tool_calls ?? [];
      if (toolCalls.length === 0) break;

      log.debug(
        { sessionId: this.sessionId, round, toolCalls: toolCalls.map((c) => c.name) },
        "ai.stream.tool_calls",
      );

      if (roundText.length > 0) {
        cb("\n");
        fullContent += "\n";
      }

      conversationMessages.push(merged);
      const toolResults = await executeToolCalls(merged, this.toolMap);
      conversationMessages.push(...toolResults);

      for (const tr of toolResults) {
        const label = `[${tr.name}]: ${typeof tr.content === "string" ? tr.content.slice(0, 200) : "done"}\n`;
        fullContent += label;
        cb(label);
      }
    }

    log.debug(
      {
        sessionId: this.sessionId,
        durationMs: Date.now() - startMs,
        contentLength: fullContent.length,
      },
      "ai.stream done",
    );

    this.addAiMessage(fullContent);
    return fullContent;
  }
}
