import { describe, expect, test } from "vitest";
import { createSession, sessionToDict, sessionFromDict } from "../../src/core/session/model.js";

describe("Session Model", () => {
  // Feature: createSession creates session with correct defaults
  // Design: Create session, verify all fields
  test("createSession creates session with defaults", () => {
    const session = createSession("s1", "one_shot", "Test Session");

    expect(session.id).toBe("s1");
    expect(session.mode).toBe("one_shot");
    expect(session.status).toBe("active");
    expect(session.title).toBe("Test Session");
    expect(typeof session.createdAt).toBe("string");
    expect(typeof session.updatedAt).toBe("string");
    expect(session.runIds).toEqual([]);
  });

  // Feature: createSession supports chat mode
  // Design: Create chat session, verify mode
  test("createSession supports chat mode", () => {
    const session = createSession("s2", "chat", "Chat Session");
    expect(session.mode).toBe("chat");
  });

  // Feature: sessionToDict serializes to snake_case for persistence
  // Design: Create session, serialize, verify field names
  test("sessionToDict uses snake_case keys", () => {
    const session = createSession("s1", "one_shot", "Test");
    session.runIds = ["run-1", "run-2"];
    const dict = sessionToDict(session);

    expect(dict["id"]).toBe("s1");
    expect(dict["mode"]).toBe("one_shot");
    expect(dict["status"]).toBe("active");
    expect(dict["title"]).toBe("Test");
    expect(dict["created_at"]).toBe(session.createdAt);
    expect(dict["updated_at"]).toBe(session.updatedAt);
    expect(dict["run_ids"]).toEqual(["run-1", "run-2"]);
  });

  // Feature: sessionFromDict deserializes from persistence format
  // Design: Create dict, deserialize, verify all fields
  test("sessionFromDict restores from snake_case dict", () => {
    const dict = {
      id: "s1",
      mode: "chat",
      status: "waiting_for_input",
      title: "Chat",
      created_at: "2026-06-12T00:00:00.000Z",
      updated_at: "2026-06-12T00:01:00.000Z",
      run_ids: ["r1", "r2"],
    };

    const session = sessionFromDict(dict);
    expect(session.id).toBe("s1");
    expect(session.mode).toBe("chat");
    expect(session.status).toBe("waiting_for_input");
    expect(session.title).toBe("Chat");
    expect(session.createdAt).toBe("2026-06-12T00:00:00.000Z");
    expect(session.updatedAt).toBe("2026-06-12T00:01:00.000Z");
    expect(session.runIds).toEqual(["r1", "r2"]);
  });

  // Feature: sessionFromDict handles invalid mode gracefully
  // Design: Pass invalid mode, verify fallback to chat
  test("sessionFromDict falls back to chat for invalid mode", () => {
    const dict = {
      id: "s1",
      mode: "invalid_mode",
      status: "active",
      title: "",
      created_at: "",
      updated_at: "",
      run_ids: [],
    };

    const session = sessionFromDict(dict);
    expect(session.mode).toBe("chat");
  });

  // Feature: sessionFromDict handles invalid status gracefully
  // Design: Pass invalid status, verify fallback to active
  test("sessionFromDict falls back to active for invalid status", () => {
    const dict = {
      id: "s1",
      mode: "one_shot",
      status: "unknown_status",
      title: "",
      created_at: "",
      updated_at: "",
      run_ids: [],
    };

    const session = sessionFromDict(dict);
    expect(session.status).toBe("active");
  });

  // Feature: roundtrip serialization preserves data
  // Design: Create -> toDict -> fromDict, verify equality
  test("roundtrip serialization preserves data", () => {
    const original = createSession("s99", "chat", "Roundtrip");
    original.runIds = ["r1", "r2", "r3"];
    original.status = "waiting_for_input";

    const dict = sessionToDict(original);
    const restored = sessionFromDict(dict);

    expect(restored.id).toBe(original.id);
    expect(restored.mode).toBe(original.mode);
    expect(restored.status).toBe(original.status);
    expect(restored.title).toBe(original.title);
    expect(restored.createdAt).toBe(original.createdAt);
    expect(restored.updatedAt).toBe(original.updatedAt);
    expect(restored.runIds).toEqual(original.runIds);
  });
});
