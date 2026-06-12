import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { ModelConfig } from "../models/model-config-schema.js";
import { createOllamaChatModel } from "./ollama-factory.js";

export const createChatModel = (config: ModelConfig): BaseChatModel => {
  const { provider } = config;
  switch (provider.kind) {
    case "ollama":
      return createOllamaChatModel(provider, config);
  }
};

export type ChatModelFactory = typeof createChatModel;
