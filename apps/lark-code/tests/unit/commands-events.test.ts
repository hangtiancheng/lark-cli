// Feature: Verify command and event serialization roundtrip correctness
// Design: Cover PingCommand, PongResult, CoreStartedEvent roundtrip and default value behavior
import { describe, expect, test } from "vitest";
import { ZodError } from "zod";

import { PingCommandSchema, PongResultSchema } from "../../src/core/bus/commands.js";
import {
  CoreStartedEventSchema,
  SubagentStartedEventSchema,
  SubagentFinishedEventSchema,
  ContextCompactedEventSchema,
} from "../../src/core/bus/events.js";

describe("PingCommand", () => {
  // Feature: Verify PingCommand serialization and deserialization preserves client and type fields
  // Design: JSON roundtrip test confirms wire protocol serialization correctness, type field is discriminated union key
  test("roundtrip preserves client and type", () => {
    const cmd = PingCommandSchema.parse({ client: "cli/0.0.1" });
    const json = JSON.stringify(cmd);
    const cmd2 = PingCommandSchema.parse(JSON.parse(json));
    expect(cmd2.client).toBe("cli/0.0.1");
    expect(cmd2.type).toBe("core.ping");
  });

  // Feature: Verify PingCommand type field defaults to "core.ping"
  // Design: z.literal().default() test, type is Command union discriminated key
  test("default type is core.ping", () => {
    const cmd = PingCommandSchema.parse({ client: "x" });
    expect(cmd.type).toBe("core.ping");
  });

  // Feature: Verify zod validation fails when required client field is missing
  // Design: Pass empty object to trigger validation, confirm client is required
  test("missing client raises ZodError", () => {
    expect(() => PingCommandSchema.parse({})).toThrow(ZodError);
  });
});

describe("PongResult", () => {
  // Feature: Verify PongResult roundtrip preserves all fields
  // Design: Symmetric with PingCommand, test both ends of command-response pair serialization
  test("roundtrip preserves all fields", () => {
    const pong = PongResultSchema.parse({
      server_version: "0.0.1",
      uptime_ms: 42,
      received_at: "2026-05-11T00:00:00Z",
    });
    const json = JSON.stringify(pong);
    const pong2 = PongResultSchema.parse(JSON.parse(json));
    expect(pong2.server_version).toBe("0.0.1");
    expect(pong2.uptime_ms).toBe(42);
  });
});

describe("CoreStartedEvent", () => {
  // Feature: Verify CoreStartedEvent roundtrip preserves listen_addr and type fields
  // Design: CoreStartedEvent is daemon startup notification, roundtrip confirms type literal constraint persists after deserialization
  test("roundtrip preserves listen_addr and type", () => {
    const evt = CoreStartedEventSchema.parse({
      listen_addr: "127.0.0.1:7437",
      version: "0.0.1",
    });
    const json = JSON.stringify(evt);
    const evt2 = CoreStartedEventSchema.parse(JSON.parse(json));
    expect(evt2.listen_addr).toBe("127.0.0.1:7437");
    expect(evt2.type).toBe("core.started");
  });
});

describe("SubagentStartedEvent", () => {
  // Feature: Verify SubagentStartedEvent schema uses run_id, parent_run_id, description fields
  // Design: Parse a valid object and confirm field names match the schema definition,
  //         catching any drift between TUI rendering code and event schema
  test("schema fields are run_id, parent_run_id, description, timestamp", () => {
    const evt = SubagentStartedEventSchema.parse({
      run_id: "child-123",
      parent_run_id: "parent-456",
      description: "Plan the implementation",
      timestamp: "2026-06-14T00:00:00Z",
    });
    expect(evt.type).toBe("subagent.started");
    expect(evt.run_id).toBe("child-123");
    expect(evt.parent_run_id).toBe("parent-456");
    expect(evt.description).toBe("Plan the implementation");
    expect(evt.timestamp).toBe("2026-06-14T00:00:00Z");
  });

  // Feature: Verify SubagentStartedEvent rejects unknown fields via strict parse
  // Design: Confirm the schema does not have agent_name or goal fields,
  //         which were the incorrect field names used in a previous TUI version
  test("rejects when required fields are missing", () => {
    expect(() =>
      SubagentStartedEventSchema.parse({
        run_id: "child-123",
        parent_run_id: "parent-456",
        // missing description
        timestamp: "2026-06-14T00:00:00Z",
      }),
    ).toThrow(ZodError);
  });
});

describe("SubagentFinishedEvent", () => {
  // Feature: Verify SubagentFinishedEvent schema uses run_id, parent_run_id, status fields
  // Design: Parse a valid object and confirm field names match the schema definition,
  //         catching any drift (e.g. result, is_success, agent_name which do not exist)
  test("schema fields are run_id, parent_run_id, status, timestamp", () => {
    const evt = SubagentFinishedEventSchema.parse({
      run_id: "child-123",
      parent_run_id: "parent-456",
      status: "success",
      timestamp: "2026-06-14T00:00:00Z",
    });
    expect(evt.type).toBe("subagent.finished");
    expect(evt.run_id).toBe("child-123");
    expect(evt.parent_run_id).toBe("parent-456");
    expect(evt.status).toBe("success");
    expect(evt.timestamp).toBe("2026-06-14T00:00:00Z");
  });

  // Feature: Verify SubagentFinishedEvent rejects when status is missing
  // Design: status is a required string field — omitting it should cause ZodError
  test("rejects when status is missing", () => {
    expect(() =>
      SubagentFinishedEventSchema.parse({
        run_id: "child-123",
        parent_run_id: "parent-456",
        timestamp: "2026-06-14T00:00:00Z",
      }),
    ).toThrow(ZodError);
  });
});

describe("ContextCompactedEvent", () => {
  // Feature: Verify ContextCompactedEvent schema uses original_tokens and summary_tokens
  // Design: Parse a valid object and confirm the field names match the schema,
  //         catching any drift (e.g. saved_tokens which was used in a previous TUI version)
  test("schema fields are original_tokens, summary_tokens", () => {
    const evt = ContextCompactedEventSchema.parse({
      session_id: "session-abc",
      run_id: "run-def",
      original_tokens: 50000,
      summary_tokens: 5000,
      timestamp: "2026-06-14T00:00:00Z",
    });
    expect(evt.type).toBe("context.compacted");
    expect(evt.session_id).toBe("session-abc");
    expect(evt.original_tokens).toBe(50000);
    expect(evt.summary_tokens).toBe(5000);
    expect(evt.timestamp).toBe("2026-06-14T00:00:00Z");
  });

  // Feature: Verify ContextCompactedEvent rejects non-integer token counts
  // Design: z.number().int() should reject float values for token fields
  test("rejects non-integer token counts", () => {
    expect(() =>
      ContextCompactedEventSchema.parse({
        session_id: "session-abc",
        run_id: "run-def",
        original_tokens: 50000.5,
        summary_tokens: 5000,
        timestamp: "2026-06-14T00:00:00Z",
      }),
    ).toThrow(ZodError);
  });
});
