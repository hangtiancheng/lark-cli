import type { CliEnv } from "../../codegen-config.js";
import type { ModelConfig } from "./model-config-schema.js";
import type { Provider, ProviderKind } from "../providers/provider-schema.js";

export const buildProvider = (kind: ProviderKind, env: CliEnv): Provider => {
  switch (kind) {
    case "ollama":
      return { kind: "ollama", baseUrl: env.BASE_URL };
  }
};

type RoleEnv = Readonly<{
  maxTokens: number;
  modelName: string;
  providerKind: ProviderKind;
  streaming: boolean;
  temperature: number;
}>;

export const toModelConfig = (env: CliEnv, role: RoleEnv): ModelConfig => ({
  maxTokens: role.maxTokens,
  modelName: role.modelName,
  provider: buildProvider(role.providerKind, env),
  streaming: role.streaming,
  temperature: role.temperature,
});
