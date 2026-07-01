// Corresponds to the source project's internal/ai/models/open_ai.go
// DeepSeek (Volcengine Ark, OpenAI compatible) via @ai-sdk/openai
// 'think' is used for planner/replanner, 'quick' is used for executor/chat
import { createOpenAI } from "@ai-sdk/openai";
import { config } from "@/lib/config";

const thinkProvider = createOpenAI({
  baseURL: config.deepseek.think.baseURL,
  apiKey: config.deepseek.think.apiKey,
});

const quickProvider = createOpenAI({
  baseURL: config.deepseek.quick.baseURL,
  apiKey: config.deepseek.quick.apiKey,
});

// ToolCallingChatModel (LanguageModelV4), used for streamText/generateText
export const thinkModel = thinkProvider.chat(config.deepseek.think.model);
export const quickModel = quickProvider.chat(config.deepseek.quick.model);
