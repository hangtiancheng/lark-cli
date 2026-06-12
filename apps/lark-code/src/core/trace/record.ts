// Trace record data model
import { z } from "zod";

export const TraceDirectionSchema = z.enum([
  "CLIENT→CORE",
  "CORE→CLIENT",
  "CORE",
  "CORE→LLM",
  "LLM→CORE",
]);
export type TraceDirection = z.infer<typeof TraceDirectionSchema>;

export const TraceLayerSchema = z.enum(["ipc", "event", "llm"]);
export type TraceLayer = z.infer<typeof TraceLayerSchema>;

export const TraceRecordSchema = z.object({
  ts: z.string(),
  direction: TraceDirectionSchema,
  layer: TraceLayerSchema,
  kind: z.string(),
  run_id: z.string().nullable().default(null),
  step: z.number().int().nullable().default(null),
  client_id: z.string().nullable().default(null),
  data: z.record(z.string(), z.unknown()),
});
export type TraceRecord = z.infer<typeof TraceRecordSchema>;
