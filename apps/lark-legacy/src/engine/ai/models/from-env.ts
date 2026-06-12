import type { CliEnv } from "../../codegen-config.js";
import { toModelConfig } from "./build-provider.js";
import type { AiModelRegistryConfig } from "./model-config-schema.js";

export const buildAiModelRegistryConfigFromEnv = (env: CliEnv): AiModelRegistryConfig => ({
  quality: toModelConfig(env, {
    maxTokens: env.CR_MAX_TOKENS,
    modelName: env.CR_MODEL,
    providerKind: env.CR_PROVIDER,
    streaming: false,
    temperature: env.CR_TEMPERATURE,
  }),
  route: toModelConfig(env, {
    maxTokens: env.ROUTE_MAX_TOKENS,
    modelName: env.ROUTE_MODEL,
    providerKind: env.ROUTE_PROVIDER,
    streaming: false,
    temperature: env.ROUTE_TEMPERATURE,
  }),
  streaming: toModelConfig(env, {
    maxTokens: env.CODEGEN_MAX_TOKENS,
    modelName: env.CODEGEN_MODEL,
    providerKind: env.CODEGEN_PROVIDER,
    streaming: true,
    temperature: env.CODEGEN_TEMPERATURE,
  }),
});
