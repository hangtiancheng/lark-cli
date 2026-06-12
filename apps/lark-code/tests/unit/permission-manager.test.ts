import { describe, expect, test } from "vitest";
import { PermissionManager } from "../../src/core/permissions/manager.js";

describe("PermissionManager", () => {
  // Feature: Verify PermissionManager evaluates policy correctly
  // Design: Create manager, evaluate allowed tool, confirm it returns "allow"
  test("evaluates allowed tools", () => {
    const manager = new PermissionManager();
    const result = manager.evaluate("read_file", { path: "test.txt" });
    expect(result).toBe("allow");
  });

  // Feature: Verify PermissionManager returns "ask" for tools requiring permission
  // Design: Create manager, evaluate tool that requires permission, confirm it returns "ask"
  test("evaluates tools requiring permission", () => {
    const manager = new PermissionManager();
    const result = manager.evaluate("bash", { command: "echo hello" });
    expect(result).toBe("ask");
  });

  // Feature: Verify PermissionManager returns "ask" for unknown tools
  // Design: Evaluate unknown tool, confirm it returns "ask"
  test("asks for unknown tools", () => {
    const manager = new PermissionManager();
    const result = manager.evaluate("unknown_tool", {});
    expect(result).toBe("ask");
  });

  // Feature: Verify PermissionManager evaluates note_save as allowed
  // Design: Evaluate note_save tool, confirm it returns "allow"
  test("note_save allowed by default", () => {
    const manager = new PermissionManager();
    const result = manager.evaluate("note_save", { content: "test note" });
    expect(result).toBe("allow");
  });
});
