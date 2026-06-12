import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatOllama } from "@langchain/ollama";
import type { ModelConfig } from "../models/model-config-schema.js";
import type { OllamaProvider } from "./provider-schema.js";

export const createOllamaChatModel = (
  provider: OllamaProvider,
  config: ModelConfig,
): BaseChatModel =>
  new ChatOllama({
    baseUrl: provider.baseUrl,
    model: config.modelName,
    numPredict: config.maxTokens,
    streaming: config.streaming,
    temperature: config.temperature,
  });
