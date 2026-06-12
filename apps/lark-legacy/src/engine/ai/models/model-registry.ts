import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { ChatModelFactory } from "../providers/chat-model-factory.js";
import { createChatModel } from "../providers/chat-model-factory.js";
import type { AiModelRegistryConfig, ModelRole } from "./model-config-schema.js";

export type AiModelRegistry = Readonly<{
  createModel: (role: ModelRole) => BaseChatModel;
}>;

export const createAiModelRegistry = (
  config: AiModelRegistryConfig,
  factory: ChatModelFactory = createChatModel,
): AiModelRegistry => ({
  createModel: (role) => factory(config[role]),
});
