// All command type definitions, using zod discriminated union routed by the type field
import { z } from "zod";

// ---- Session model types (inlined to avoid circular dependency) ----

export const SessionModeSchema = z.enum(["one_shot", "chat"]);
export type SessionMode = z.infer<typeof SessionModeSchema>;

export const SessionStatusSchema = z.enum(["active", "waiting_for_input", "closed"]);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

// ---- Commands ----

export const PingCommandSchema = z.object({
  type: z.literal("core.ping").default("core.ping"),
  client: z.string(),
});
export type PingCommand = z.infer<typeof PingCommandSchema>;

export const PongResultSchema = z.object({
  server_version: z.string(),
  uptime_ms: z.number().int(),
  received_at: z.string(),
});
export type PongResult = z.infer<typeof PongResultSchema>;

export const AgentRunCommandSchema = z.object({
  type: z.literal("agent.run").default("agent.run"),
  goal: z.string(),
});
export type AgentRunCommand = z.infer<typeof AgentRunCommandSchema>;

export const AgentRunResultSchema = z.object({
  run_id: z.string(),
});
export type AgentRunResult = z.infer<typeof AgentRunResultSchema>;

export const EventSubscribeCommandSchema = z.object({
  type: z.literal("event.subscribe").default("event.subscribe"),
  topics: z.array(z.string()),
  scope: z.string().default("global"),
  replay_from_run: z.string().nullable().default(null),
});
export type EventSubscribeCommand = z.infer<typeof EventSubscribeCommandSchema>;

export const EventSubscribeResultSchema = z.object({
  subscription_id: z.string(),
  replayed_count: z.number().int().default(0),
});
export type EventSubscribeResult = z.infer<typeof EventSubscribeResultSchema>;

export const SessionCreateCommandSchema = z.object({
  type: z.literal("session.create").default("session.create"),
  mode: SessionModeSchema.default("chat"),
  title: z.string().default(""),
});
export type SessionCreateCommand = z.infer<typeof SessionCreateCommandSchema>;

export const SessionCreateResultSchema = z.object({
  session_id: z.string(),
  status: SessionStatusSchema,
});
export type SessionCreateResult = z.infer<typeof SessionCreateResultSchema>;

export const SessionSendMessageCommandSchema = z.object({
  type: z.literal("session.send_message").default("session.send_message"),
  session_id: z.string(),
  content: z.string(),
});
export type SessionSendMessageCommand = z.infer<typeof SessionSendMessageCommandSchema>;

export const SessionSendMessageResultSchema = z.object({
  run_id: z.string(),
});
export type SessionSendMessageResult = z.infer<typeof SessionSendMessageResultSchema>;

export const SessionGetHistoryCommandSchema = z.object({
  type: z.literal("session.get_history").default("session.get_history"),
  session_id: z.string(),
});
export type SessionGetHistoryCommand = z.infer<typeof SessionGetHistoryCommandSchema>;

export const SessionGetHistoryResultSchema = z.object({
  messages: z.array(z.record(z.string(), z.unknown())),
});
export type SessionGetHistoryResult = z.infer<typeof SessionGetHistoryResultSchema>;

export const SessionCloseCommandSchema = z.object({
  type: z.literal("session.close").default("session.close"),
  session_id: z.string(),
});
export type SessionCloseCommand = z.infer<typeof SessionCloseCommandSchema>;

export const SessionCloseResultSchema = z.object({
  status: SessionStatusSchema,
});
export type SessionCloseResult = z.infer<typeof SessionCloseResultSchema>;

export const PermissionRespondCommandSchema = z.object({
  type: z.literal("permission.respond").default("permission.respond"),
  tool_use_id: z.string(),
  decision: z.string(),
});
export type PermissionRespondCommand = z.infer<typeof PermissionRespondCommandSchema>;

export const PermissionRespondResultSchema = z.object({
  ok: z.boolean().default(true),
});
export type PermissionRespondResult = z.infer<typeof PermissionRespondResultSchema>;

export const SessionCompactCommandSchema = z.object({
  type: z.literal("session.compact").default("session.compact"),
  session_id: z.string(),
  focus: z.string().default(""),
});
export type SessionCompactCommand = z.infer<typeof SessionCompactCommandSchema>;

export const SessionCompactResultSchema = z.object({
  summary_tokens: z.number().int(),
  saved_tokens: z.number().int(),
});
export type SessionCompactResult = z.infer<typeof SessionCompactResultSchema>;

// Discriminated union of all command types based on the type field
export const CommandSchema = z.discriminatedUnion("type", [
  PingCommandSchema,
  AgentRunCommandSchema,
  EventSubscribeCommandSchema,
  SessionCreateCommandSchema,
  SessionSendMessageCommandSchema,
  SessionGetHistoryCommandSchema,
  SessionCloseCommandSchema,
  PermissionRespondCommandSchema,
  SessionCompactCommandSchema,
]);

export type Command = z.infer<typeof CommandSchema>;
