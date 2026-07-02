// Corresponds to chat_pipeline (orchestration.go, prompt.go, flow.go).
// RAG retrieval + system prompt + ReAct agent (streamText/generateText with tools + maxSteps).
import { streamText, generateText, type Tool, type ModelMessage, isStepCount } from "ai";
import { quickModel } from "../models";
import { builtinTools } from "../tools";
import { getLogMcpTools } from "../tools/query-log";
import { retrieve } from "@/lib/milvus/retriever";
import { getSimpleMemory } from "@/lib/memory";

// System prompt migrated from chat_pipeline/prompt.go.
const SYSTEM_PROMPT = `# Role: Conversational Assistant
## Core capabilities
- Context understanding and conversation
- Search the web for information
## Interaction guidelines
- Before replying, ensure you:
  • Fully understand the user's needs and questions; confirm with the user if anything is unclear
  • Consider the most appropriate solution approach
  • Log topic region: ap-guangzhou; log topic id: 869830db-a055-4479-963b-3c898d27e755
- When providing help:
  • Use clear and concise language
  • Provide practical examples when appropriate
  • Reference documentation when helpful
  • Suggest improvements or next steps when applicable
- If a request is beyond your capabilities:
  • Clearly state your limitations and, if possible, suggest alternative approaches
- For complex or compound questions, think step by step and avoid giving low-quality answers directly.
## Output requirements:
  • Readable and well-structured, with line breaks when needed
  • Output must not contain markdown syntax; output plain text only
## Context information
- Current date: {date}
- Relevant documents: |-
==== Documents start ====
  {documents}
==== Documents end ====
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
