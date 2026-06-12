import { getSettings } from "../settings.js";
import type { ProviderKind } from "./ai/providers/provider-schema.js";

export interface CliEnv {
  CR_MAX_TOKENS: number;
  CR_MODEL: string;
  CR_PROVIDER: ProviderKind;
  CR_TEMPERATURE: number;
  ROUTE_MAX_TOKENS: number;
  ROUTE_MODEL: string;
  ROUTE_PROVIDER: ProviderKind;
  ROUTE_TEMPERATURE: number;
  CODEGEN_MAX_TOKENS: number;
  CODEGEN_MODEL: string;
  CODEGEN_PROVIDER: ProviderKind;
  CODEGEN_TEMPERATURE: number;
  BASE_URL: string;
}

export const loadEnv = (): CliEnv => {
  const s = getSettings();
  const provider = s.PROVIDER as ProviderKind;
  return {
    CR_MAX_TOKENS: s.codegen.cr.maxTokens,
    CR_MODEL: s.codegen.cr.model,
    CR_PROVIDER: provider,
    CR_TEMPERATURE: s.codegen.cr.temperature,
    ROUTE_MAX_TOKENS: s.codegen.route.maxTokens,
    ROUTE_MODEL: s.codegen.route.model,
    ROUTE_PROVIDER: provider,
    ROUTE_TEMPERATURE: s.codegen.route.temperature,
    CODEGEN_MAX_TOKENS: s.codegen.maxTokens,
    CODEGEN_MODEL: s.env.MODEL,
    CODEGEN_PROVIDER: provider,
    CODEGEN_TEMPERATURE: s.codegen.temperature,
    BASE_URL: s.env.BASE_URL,
  };
};
