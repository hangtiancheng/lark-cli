import { z } from "zod";

export const PROVIDER_KINDS = ["ollama"] as const;

export type ProviderKind = (typeof PROVIDER_KINDS)[number];

export const providerKindSchema = z.enum(PROVIDER_KINDS);

export const ollamaProviderSchema = z.object({
  kind: z.literal("ollama"),
  baseUrl: z.string().min(1).default("http://localhost:11434"),
});

export type OllamaProvider = z.infer<typeof ollamaProviderSchema>;

export const providerSchema = z.discriminatedUnion("kind", [ollamaProviderSchema]);

export type Provider = z.infer<typeof providerSchema>;
