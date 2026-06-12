// Feature: Verify command and event serialization roundtrip correctness
// Design: Cover PingCommand, PongResult, CoreStartedEvent roundtrip and default value behavior
import { describe, expect, test } from "vitest";
import { ZodError } from "zod";

import {
  PingCommandSchema,
  PongResultSchema,
} from "../../src/core/bus/commands.js";
import { CoreStartedEventSchema } from "../../src/core/bus/events.js";

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
