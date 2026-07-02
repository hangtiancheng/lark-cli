// Corresponds to chat_pipeline (orchestration.go, prompt.go, flow.go).
// RAG retrieval + system prompt + ReAct agent (streamText/generateText with tools + maxSteps).
import { streamText, generateText, type Tool, type ModelMessage, isStepCount } from "ai";
import { quickModel } from "../models";
import { builtinTools } from "../tools";
import { getLogMcpTools } from "../tools/query-log";
import { retrieve } from "@/lib/milvus/retriever";
import { getSimpleMemory } from "@/lib/memory";

// System prompt migrated from chat_pipeline/prompt.go (business content preserved).
const SYSTEM_PROMPT = `# 角色:对话小助手
## 核心能力
- 上下文理解与对话
- 搜索网络获得信息
## 互动指南
- 在回复前,请确保你:
  • 完全理解用户的需求和问题,如果有不清楚的地方,要向用户确认
  • 考虑最合适的解决方案方法
  • 日志主题地域:ap-guangzhou;日志主题id:869830db-a055-4479-963b-3c898d27e755
- 提供帮助时:
  • 语言清晰简洁
  • 适当的时候提供实际例子
  • 有帮助时参考文档
  • 适用时建议改进或下一步操作
- 如果请求超出了你的能力范围:
  • 清晰地说明你的局限性,如果可能的话,建议其他方法
- 如果问题是复合或复杂的,你需要一步步思考,避免直接给出质量不高的回答。
## 输出要求:
  • 易读,结构良好,必要时换行
  • 输出不能包含markdown的语法,输出需要纯文本
## 上下文信息
- 当前日期:{date}
- 相关文档:|-
==== 文档开始 ====
  {documents}
==== 文档结束 ====
`;

function buildSystemPrompt(documents: string): string {
  return SYSTEM_PROMPT.replace("{date}", new Date().toLocaleString("en-US")).replace(
    "{documents}",
    documents,
  );
}

async function buildChatTools(): Promise<Record<string, Tool>> {
  const mcpTools = await getLogMcpTools();
  return { ...mcpTools, ...builtinTools };
}

// Non-streaming chat (corresponds to the Chat controller).
export async function chat(id: string, question: string): Promise<string> {
  const mem = getSimpleMemory(id);
  const history = mem.getMessages();
  const docs = await retrieve(question);
  const documents = docs.map((d) => d.content).join("\n");
  const tools = await buildChatTools();

  const result = await generateText({
    model: quickModel,
    system: buildSystemPrompt(documents),
    messages: [...history, { role: "user", content: question } satisfies ModelMessage],
    tools,
    stopWhen: isStepCount(25),
  });

  const answer = result.text;
  mem.setMessages({ role: "user", content: question });
  mem.setMessages({ role: "assistant", content: answer });
  return answer;
}

// Streaming chat (corresponds to the ChatStream controller). Yields text chunks.
// Memory is persisted after the stream completes.
export async function* chatStream(id: string, question: string): AsyncGenerator<string> {
  const mem = getSimpleMemory(id);
  const history = mem.getMessages();
  const docs = await retrieve(question);
  const documents = docs.map((d) => d.content).join("\n");
  const tools = await buildChatTools();

  const result = streamText({
    model: quickModel,
    system: buildSystemPrompt(documents),
    messages: [...history, { role: "user", content: question } satisfies ModelMessage],
    tools,
    stopWhen: isStepCount(25),
  });

  let full = "";
  try {
    for await (const chunk of result.textStream) {
      full += chunk;
      yield chunk;
    }
  } finally {
    if (full) {
      mem.setMessages({ role: "user", content: question });
      mem.setMessages({ role: "assistant", content: full });
    }
  }
}
