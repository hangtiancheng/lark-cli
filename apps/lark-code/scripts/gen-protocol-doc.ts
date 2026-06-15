#!/usr/bin/env tsx
/**
 * Generate WIRE_PROTOCOL.md from zod schemas in lark-code bus modules.
 *
 * Usage:
 *   tsx scripts/gen-protocol-doc.ts
 *   tsx scripts/gen-protocol-doc.ts --check
 */
import { writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import {
  PingCommandSchema,
  PongResultSchema,
  AgentRunCommandSchema,
  AgentRunResultSchema,
  EventSubscribeCommandSchema,
  EventSubscribeResultSchema,
  SessionCreateCommandSchema,
  SessionCreateResultSchema,
  SessionSendMessageCommandSchema,
  SessionSendMessageResultSchema,
  SessionGetHistoryCommandSchema,
  SessionGetHistoryResultSchema,
  SessionCloseCommandSchema,
  SessionCloseResultSchema,
} from "../src/core/bus/commands.js";
import { EventPushEnvelopeSchema } from "../src/core/bus/envelope.js";
import {
  CoreStartedEventSchema,
  RunStartedEventSchema,
  RunFinishedEventSchema,
  StepStartedEventSchema,
  StepFinishedEventSchema,
  ToolUseStartedEventSchema,
  ToolUseFinishedEventSchema,
  ToolUseFailedEventSchema,
  LlmModelSelectedEventSchema,
  LlmTokenEventSchema,
  LlmUsageEventSchema,
  LogLineEventSchema,
  SessionCreatedEventSchema,
  SessionMessageReceivedEventSchema,
  SessionWaitingForInputEventSchema,
  SessionResumedEventSchema,
  SessionClosedEventSchema,
} from "../src/core/bus/events.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.join(__dirname, "..", "WIRE_PROTOCOL.md");

// Narrow an unknown value to Record<string, unknown> if it is a non-null object
function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return true;
  }
  return false;
}

// Narrow an unknown value to string[] if it is an array
function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(String);
  }
  return [];
}

// Extract a printable string from an unknown value, falling back when the value
// would use Object's default toString (avoiding @typescript-eslint/no-base-to-string)
function asString(value: unknown, fallback: string): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}

// Generate a Markdown section with field table, JSON Schema, and optional example from a zod schema
function modelSection(name: string, schema: z.ZodType, example?: Record<string, unknown>): string {
  const jsonSchema = z.toJSONSchema(schema);
  const propsRaw: unknown = jsonSchema.properties;
  const props = isRecord(propsRaw) ? propsRaw : {};
  const required = new Set(asStringArray(jsonSchema.required));

  let table = "";
  if (Object.keys(props).length > 0) {
    table = "\n| Field | Type | Required |\n|---|---|---|\n";
    for (const [fieldName, fieldInfoRaw] of Object.entries(props)) {
      const fieldInfo = isRecord(fieldInfoRaw) ? fieldInfoRaw : {};
      let fieldType = asString(fieldInfo["type"], "object");
      const anyOf = fieldInfo["anyOf"];
      if (Array.isArray(anyOf)) {
        fieldType = anyOf
          .map((t: unknown) => asString(isRecord(t) ? t["type"] : "?", "?"))
          .join(" | ");
      }
      const req = required.has(fieldName) ? "yes" : "no";
      table += `| \`${fieldName}\` | \`${fieldType}\` | ${req} |\n`;
    }
  }

  const schemaBlock = `\n\`\`\`json\n${JSON.stringify(jsonSchema, null, 2)}\n\`\`\`\n`;

  let exampleBlock = "";
  if (example) {
    exampleBlock = `\n**Example:**\n\n\`\`\`json\n${JSON.stringify(example, null, 2)}\n\`\`\`\n`;
  }

  return `### ${name}\n${table}${schemaBlock}${exampleBlock}`;
}

// Generate the complete WIRE_PROTOCOL.md document string
function generate(): string {
  const runId = "20260516-100000-abc123";
  const timestamp = "2026-05-16T10:00:00.001Z";

  const pingReqExample = {
    jsonrpc: "2.0",
    id: "example-1",
    method: "core.ping",
    params: { client: "cli/0.0.1" },
  };
  const pongRespExample = {
    jsonrpc: "2.0",
    id: "example-1",
    result: {
      server_version: "0.2.0",
      uptime_ms: 12,
      received_at: timestamp,
    },
  };
  const agentRunReqExample = {
    jsonrpc: "2.0",
    id: "example-2",
    method: "agent.run",
    params: { goal: "Summarize the main sections of README.md" },
  };
  const agentRunRespExample = {
    jsonrpc: "2.0",
    id: "example-2",
    result: { run_id: runId },
  };
  const subscribeReqExample = {
    jsonrpc: "2.0",
    id: "example-3",
    method: "event.subscribe",
    params: {
      topics: ["run.*", "step.*", "tool.*", "llm.token"],
      scope: "global",
      replay_from_run: null,
    },
  };
  const subscribeRespExample = {
    jsonrpc: "2.0",
    id: "example-3",
    result: { subscription_id: "sub-abc123", replayed_count: 0 },
  };
  const sessionId = "session-abc123def456";
  const sessionCreateReqExample = {
    jsonrpc: "2.0",
    id: "example-4",
    method: "session.create",
    params: { mode: "chat", title: "" },
  };
  const sessionCreateRespExample = {
    jsonrpc: "2.0",
    id: "example-4",
    result: { session_id: sessionId, status: "active" },
  };
  const sessionSendReqExample = {
    jsonrpc: "2.0",
    id: "example-5",
    method: "session.sendMessage",
    params: { session_id: sessionId, content: "Summarize README.md" },
  };
  const sessionSendRespExample = {
    jsonrpc: "2.0",
    id: "example-5",
    result: { run_id: runId },
  };
  const eventPushExample = {
    kind: "event",
    event: {
      type: "step.started",
      run_id: runId,
      step: 1,
      timestamp: timestamp,
    },
  };

  const sections = [
    "# Wire Protocol\n\n",
    "> Generated by `scripts/gen-protocol-doc.ts`. **Do not edit manually.**\n\n",
    "## Transport\n\n",
    "- TCP loopback `127.0.0.1:7437` (override via `LARK_HOST` / `LARK_PORT`)\n",
    "- Each message is one `\\n`-terminated JSON line (NDJSON)\n",
    "- Commands use JSON-RPC 2.0 (client → server); Events use `kind=event` envelope (server → client)\n\n",
    "## Commands\n\n",
    "All commands are sent as JSON-RPC 2.0 requests. The `type` field inside `params` is used for routing.\n\n",
    modelSection("PingCommand", PingCommandSchema, pingReqExample),
    "\n",
    modelSection("PongResult", PongResultSchema, pongRespExample),
    "\n",
    modelSection("AgentRunCommand", AgentRunCommandSchema, agentRunReqExample),
    "\n",
    modelSection("AgentRunResult", AgentRunResultSchema, agentRunRespExample),
    "\n",
    modelSection("EventSubscribeCommand", EventSubscribeCommandSchema, subscribeReqExample),
    "\n",
    modelSection("EventSubscribeResult", EventSubscribeResultSchema, subscribeRespExample),
    "\n",
    modelSection("SessionCreateCommand", SessionCreateCommandSchema, sessionCreateReqExample),
    "\n",
    modelSection("SessionCreateResult", SessionCreateResultSchema, sessionCreateRespExample),
    "\n",
    modelSection(
      "SessionSendMessageCommand",
      SessionSendMessageCommandSchema,
      sessionSendReqExample,
    ),
    "\n",
    modelSection(
      "SessionSendMessageResult",
      SessionSendMessageResultSchema,
      sessionSendRespExample,
    ),
    "\n",
    modelSection("SessionGetHistoryCommand", SessionGetHistoryCommandSchema),
    "\n",
    modelSection("SessionGetHistoryResult", SessionGetHistoryResultSchema),
    "\n",
    modelSection("SessionCloseCommand", SessionCloseCommandSchema),
    "\n",
    modelSection("SessionCloseResult", SessionCloseResultSchema),
    "\n## Server Push\n\n",
    "Events pushed from daemon to subscribed clients over the same TCP connection.\n\n",
    modelSection("EventPushEnvelope", EventPushEnvelopeSchema, eventPushExample),
    "\n## IPC Events\n\n",
    "Events sent over the IPC socket (daemon → client).\n\n",
    modelSection("CoreStartedEvent", CoreStartedEventSchema),
    "\n## Run Events\n\n",
    "Events written to `runs/<run_id>/events.jsonl` and forwarded over IPC to subscribed clients.\n\n",
    modelSection("RunStartedEvent", RunStartedEventSchema, {
      type: "run.started",
      run_id: runId,
      goal: "Summarize README.md",
      timestamp: timestamp,
    }),
    "\n",
    modelSection("RunFinishedEvent", RunFinishedEventSchema, {
      type: "run.finished",
      run_id: runId,
      status: "success",
      reason: null,
      steps: 2,
      timestamp: timestamp,
    }),
    "\n",
    modelSection("StepStartedEvent", StepStartedEventSchema, {
      type: "step.started",
      run_id: runId,
      step: 1,
      timestamp: timestamp,
    }),
    "\n",
    modelSection("StepFinishedEvent", StepFinishedEventSchema, {
      type: "step.finished",
      run_id: runId,
      step: 1,
      timestamp: timestamp,
    }),
    "\n",
    modelSection("ToolUseStartedEvent", ToolUseStartedEventSchema, {
      type: "tool.call_started",
      run_id: runId,
      tool_use_id: "tool_use_01",
      tool_name: "read_file",
      params: { path: "README.md" },
      timestamp: timestamp,
    }),
    "\n",
    modelSection("ToolUseFinishedEvent", ToolUseFinishedEventSchema, {
      type: "tool.call_finished",
      run_id: runId,
      tool_use_id: "tool_use_01",
      tool_name: "read_file",
      elapsed_ms: 3,
      timestamp: timestamp,
    }),
    "\n",
    modelSection("ToolUseFailedEvent", ToolUseFailedEventSchema, {
      type: "tool.call_failed",
      run_id: runId,
      tool_use_id: "tool_use_02",
      tool_name: "read_file",
      error_class: "runtime_error",
      error_message: "file not found",
      elapsed_ms: 1,
      attempt: 1,
      timestamp: timestamp,
    }),
    "\n",
    modelSection("LlmModelSelectedEvent", LlmModelSelectedEventSchema, {
      type: "llm.model_selected",
      run_id: runId,
      model: "claude-sonnet-4-6",
      strategy: "static",
      timestamp: timestamp,
    }),
    "\n",
    modelSection("LlmTokenEvent", LlmTokenEventSchema, {
      type: "llm.token",
      run_id: runId,
      token: "The ",
      timestamp: timestamp,
    }),
    "\n",
    modelSection("LlmUsageEvent", LlmUsageEventSchema, {
      type: "llm.usage",
      run_id: runId,
      input_tokens: 512,
      output_tokens: 48,
      cache_read_input_tokens: 490,
      cache_creation_input_tokens: 0,
      timestamp: timestamp,
    }),
    "\n",
    modelSection("LogLineEvent", LogLineEventSchema, {
      type: "log.line",
      run_id: runId,
      level: "INFO",
      source: "lark.core.loop",
      message: "step 1 started",
      timestamp: timestamp,
    }),
    "\n## Session Events\n\n",
    modelSection("SessionCreatedEvent", SessionCreatedEventSchema, {
      type: "session.created",
      session_id: sessionId,
      mode: "chat",
      timestamp: timestamp,
    }),
    "\n",
    modelSection("SessionMessageReceivedEvent", SessionMessageReceivedEventSchema, {
      type: "session.message_received",
      session_id: sessionId,
      content: "Summarize README.md",
      timestamp: timestamp,
    }),
    "\n",
    modelSection("SessionWaitingForInputEvent", SessionWaitingForInputEventSchema, {
      type: "session.waiting_for_input",
      session_id: sessionId,
      last_run_id: runId,
      timestamp: timestamp,
    }),
    "\n",
    modelSection("SessionResumedEvent", SessionResumedEventSchema, {
      type: "session.resumed",
      session_id: sessionId,
      timestamp: timestamp,
    }),
    "\n",
    modelSection("SessionClosedEvent", SessionClosedEventSchema, {
      type: "session.closed",
      session_id: sessionId,
      timestamp: timestamp,
    }),
    "\n## Error Codes\n\n",
    "| Code | Name | Meaning |\n",
    "|------|------|---------|\n",
    "| -32700 | Parse Error | Invalid JSON received |\n",
    "| -32600 | Invalid Request | Missing required JSON-RPC fields |\n",
    "| -32601 | Method Not Found | Unknown method |\n",
    "| -32602 | Invalid Params | Parameter validation failed |\n",
    "| -32603 | Internal Error | Handler raised an unhandled exception |\n",
    "| -32000 | Application Error | e.g. another run already in progress |\n",
  ];
  return sections.join("");
}

// Parse command-line arguments, write or verify WIRE_PROTOCOL.md
function main(): void {
  const args = process.argv.slice(2);
  const isCheck = args.includes("--check");

  const content = generate();

  if (isCheck) {
    try {
      const existing = readFileSync(OUTPUT_PATH, "utf-8");
      if (existing !== content) {
        console.error(
          `ERROR: ${OUTPUT_PATH} out of sync with code — run: tsx scripts/gen-protocol-doc.ts`,
        );
        process.exit(1);
      }
      console.log(`OK: ${OUTPUT_PATH} is up to date.`);
    } catch {
      console.error(`ERROR: ${OUTPUT_PATH} not found — run: tsx scripts/gen-protocol-doc.ts`);
      process.exit(1);
    }
  } else {
    writeFileSync(OUTPUT_PATH, content, "utf-8");
    console.log(`Generated ${OUTPUT_PATH}`);
  }
}

main();
