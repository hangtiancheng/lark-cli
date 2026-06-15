// All event type definitions, using zod discriminated union routed by the type field
import { z } from "zod";

export const CoreStartedEventSchema = z.object({
  type: z.literal("core.started").default("core.started"),
  listen_addr: z.string(),
  version: z.string(),
});
export type CoreStartedEvent = z.infer<typeof CoreStartedEventSchema>;

export const RunStartedEventSchema = z.object({
  type: z.literal("run.started").default("run.started"),
  run_id: z.string(),
  goal: z.string(),
  timestamp: z.string(),
});
export type RunStartedEvent = z.infer<typeof RunStartedEventSchema>;

export const RunFinishedEventSchema = z.object({
  type: z.literal("run.finished").default("run.finished"),
  run_id: z.string(),
  status: z.string(),
  reason: z.string().nullable().default(null),
  steps: z.number().int(),
  timestamp: z.string(),
});
export type RunFinishedEvent = z.infer<typeof RunFinishedEventSchema>;

export const StepStartedEventSchema = z.object({
  type: z.literal("step.started").default("step.started"),
  run_id: z.string(),
  step: z.number().int(),
  timestamp: z.string(),
});
export type StepStartedEvent = z.infer<typeof StepStartedEventSchema>;

export const StepFinishedEventSchema = z.object({
  type: z.literal("step.finished").default("step.finished"),
  run_id: z.string(),
  step: z.number().int(),
  timestamp: z.string(),
});
export type StepFinishedEvent = z.infer<typeof StepFinishedEventSchema>;

export const ToolUseStartedEventSchema = z.object({
  type: z.literal("tool.call_started").default("tool.call_started"),
  run_id: z.string(),
  tool_use_id: z.string(),
  tool_name: z.string(),
  params: z.record(z.string(), z.unknown()),
  timestamp: z.string(),
});
export type ToolUseStartedEvent = z.infer<typeof ToolUseStartedEventSchema>;

export const ToolUseFinishedEventSchema = z.object({
  type: z.literal("tool.call_finished").default("tool.call_finished"),
  run_id: z.string(),
  tool_use_id: z.string(),
  tool_name: z.string(),
  elapsed_ms: z.number().int(),
  output: z.string().default(""),
  timestamp: z.string(),
});
export type ToolUseFinishedEvent = z.infer<typeof ToolUseFinishedEventSchema>;

export const ToolUseFailedEventSchema = z.object({
  type: z.literal("tool.call_failed").default("tool.call_failed"),
  run_id: z.string(),
  tool_use_id: z.string(),
  tool_name: z.string(),
  error_class: z.string(),
  error_message: z.string(),
  elapsed_ms: z.number().int(),
  attempt: z.number().int().default(1),
  timestamp: z.string(),
});
export type ToolUseFailedEvent = z.infer<typeof ToolUseFailedEventSchema>;

export const LlmTokenEventSchema = z.object({
  type: z.literal("llm.token").default("llm.token"),
  run_id: z.string(),
  token: z.string(),
  timestamp: z.string(),
});
export type LlmTokenEvent = z.infer<typeof LlmTokenEventSchema>;

export const LlmUsageEventSchema = z.object({
  type: z.literal("llm.usage").default("llm.usage"),
  run_id: z.string(),
  input_tokens: z.number().int(),
  output_tokens: z.number().int(),
  cache_read_input_tokens: z.number().int(),
  cache_creation_input_tokens: z.number().int(),
  context_percent: z.number().default(0),
  timestamp: z.string(),
});
export type LlmUsageEvent = z.infer<typeof LlmUsageEventSchema>;

export const LlmModelSelectedEventSchema = z.object({
  type: z.literal("llm.model_selected").default("llm.model_selected"),
  run_id: z.string(),
  model: z.string(),
  strategy: z.string(),
  timestamp: z.string(),
});
export type LlmModelSelectedEvent = z.infer<typeof LlmModelSelectedEventSchema>;

export const LogLineEventSchema = z.object({
  type: z.literal("log.line").default("log.line"),
  run_id: z.string(),
  level: z.string(),
  source: z.string(),
  message: z.string(),
  timestamp: z.string(),
});
export type LogLineEvent = z.infer<typeof LogLineEventSchema>;

export const SessionCreatedEventSchema = z.object({
  type: z.literal("session.created").default("session.created"),
  session_id: z.string(),
  mode: z.string(),
  timestamp: z.string(),
});
export type SessionCreatedEvent = z.infer<typeof SessionCreatedEventSchema>;

export const SessionMessageReceivedEventSchema = z.object({
  type: z.literal("session.message_received").default("session.message_received"),
  session_id: z.string(),
  content: z.string(),
  timestamp: z.string(),
});
export type SessionMessageReceivedEvent = z.infer<typeof SessionMessageReceivedEventSchema>;

export const SessionWaitingForInputEventSchema = z.object({
  type: z.literal("session.waiting_for_input").default("session.waiting_for_input"),
  session_id: z.string(),
  last_run_id: z.string(),
  timestamp: z.string(),
});
export type SessionWaitingForInputEvent = z.infer<typeof SessionWaitingForInputEventSchema>;

export const SessionResumedEventSchema = z.object({
  type: z.literal("session.resumed").default("session.resumed"),
  session_id: z.string(),
  timestamp: z.string(),
});
export type SessionResumedEvent = z.infer<typeof SessionResumedEventSchema>;

export const SessionClosedEventSchema = z.object({
  type: z.literal("session.closed").default("session.closed"),
  session_id: z.string(),
  timestamp: z.string(),
});
export type SessionClosedEvent = z.infer<typeof SessionClosedEventSchema>;

export const ContextCompactedEventSchema = z.object({
  type: z.literal("context.compacted").default("context.compacted"),
  session_id: z.string(),
  run_id: z.string(),
  original_tokens: z.number().int(),
  summary_tokens: z.number().int(),
  timestamp: z.string(),
});
export type ContextCompactedEvent = z.infer<typeof ContextCompactedEventSchema>;

export const PermissionRequestedEventSchema = z.object({
  type: z.literal("permission.requested").default("permission.requested"),
  run_id: z.string(),
  tool_use_id: z.string(),
  tool_name: z.string(),
  params: z.record(z.string(), z.unknown()),
  params_preview: z.string(),
  session_id: z.string(),
  timestamp: z.string(),
});
export type PermissionRequestedEvent = z.infer<typeof PermissionRequestedEventSchema>;

export const PermissionGrantedEventSchema = z.object({
  type: z.literal("permission.granted").default("permission.granted"),
  run_id: z.string(),
  tool_use_id: z.string(),
  decision: z.string(),
  timestamp: z.string(),
});
export type PermissionGrantedEvent = z.infer<typeof PermissionGrantedEventSchema>;

export const PermissionDeniedEventSchema = z.object({
  type: z.literal("permission.denied").default("permission.denied"),
  run_id: z.string(),
  tool_use_id: z.string(),
  decision: z.string(),
  timestamp: z.string(),
});
export type PermissionDeniedEvent = z.infer<typeof PermissionDeniedEventSchema>;

export const SubagentStartedEventSchema = z.object({
  type: z.literal("subagent.started").default("subagent.started"),
  run_id: z.string(),
  parent_run_id: z.string(),
  description: z.string(),
  timestamp: z.string(),
});
export type SubagentStartedEvent = z.infer<typeof SubagentStartedEventSchema>;

export const SubagentFinishedEventSchema = z.object({
  type: z.literal("subagent.finished").default("subagent.finished"),
  run_id: z.string(),
  parent_run_id: z.string(),
  status: z.string(),
  timestamp: z.string(),
});
export type SubagentFinishedEvent = z.infer<typeof SubagentFinishedEventSchema>;

export const SkillInvokedEventSchema = z.object({
  type: z.literal("skill.invoked").default("skill.invoked"),
  skill_name: z.string(),
  arguments: z.string(),
  run_id: z.string(),
  timestamp: z.string(),
});
export type SkillInvokedEvent = z.infer<typeof SkillInvokedEventSchema>;

// Discriminated union of all event types based on the type field
export const EventSchema = z.discriminatedUnion("type", [
  CoreStartedEventSchema,
  RunStartedEventSchema,
  RunFinishedEventSchema,
  StepStartedEventSchema,
  StepFinishedEventSchema,
  ToolUseStartedEventSchema,
  ToolUseFinishedEventSchema,
  ToolUseFailedEventSchema,
  LlmTokenEventSchema,
  LlmUsageEventSchema,
  LlmModelSelectedEventSchema,
  LogLineEventSchema,
  SessionCreatedEventSchema,
  SessionMessageReceivedEventSchema,
  SessionWaitingForInputEventSchema,
  SessionResumedEventSchema,
  SessionClosedEventSchema,
  ContextCompactedEventSchema,
  PermissionRequestedEventSchema,
  PermissionGrantedEventSchema,
  PermissionDeniedEventSchema,
  SubagentStartedEventSchema,
  SubagentFinishedEventSchema,
  SkillInvokedEventSchema,
]);

export type Event = z.infer<typeof EventSchema>;
