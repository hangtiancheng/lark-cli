import { z } from "zod";
import { providerSchema } from "../providers/provider-schema.js";

export const MODEL_ROLES = ["route", "streaming", "quality"] as const;

export type ModelRole = (typeof MODEL_ROLES)[number];

export const modelConfigSchema = z.object({
  maxTokens: z.coerce.number().int().min(1).max(200_000).default(4096),
  modelName: z.string().min(1),
  provider: providerSchema,
  streaming: z.boolean().default(false),
  temperature: z.coerce.number().min(0).max(2).default(0.2),
});

export type ModelConfig = z.infer<typeof modelConfigSchema>;

export const aiModelRegistrySchema = z.object({
  quality: modelConfigSchema,
  route: modelConfigSchema,
  streaming: modelConfigSchema,
});

export type AiModelRegistryConfig = z.infer<typeof aiModelRegistrySchema>;
