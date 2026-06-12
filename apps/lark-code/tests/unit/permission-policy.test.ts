import { describe, expect, test } from "vitest";
import { evaluate } from "../../src/core/permissions/policy.js";

describe("PermissionPolicy", () => {
  // Feature: Verify read_file is allowed by default
  // Design: Evaluate read_file tool, confirm it returns allow
  test("read_file allowed by default", () => {
    const result = evaluate("read_file", { path: "test.txt" });
    expect(result).toBe("allow");
  });

  // Feature: Verify list_dir is allowed by default
  // Design: Evaluate list_dir tool, confirm it returns allow
  test("list_dir allowed by default", () => {
    const result = evaluate("list_dir", { path: "." });
    expect(result).toBe("allow");
  });

  // Feature: Verify bash requires permission
  // Design: Evaluate bash tool, confirm it returns ask
  test("bash requires permission", () => {
    const result = evaluate("bash", { command: "echo hello" });
    expect(result).toBe("ask");
  });

  // Feature: Verify write_file requires permission
  // Design: Evaluate write_file tool, confirm it returns ask
  test("write_file requires permission", () => {
    const result = evaluate("write_file", {
      path: "test.txt",
      content: "test",
    });
    expect(result).toBe("ask");
  });

  // Feature: Verify unknown tools require permission
  // Design: Evaluate unknown tool, confirm it returns ask
  test("unknown tools require permission", () => {
    const result = evaluate("unknown_tool", {});
    expect(result).toBe("ask");
  });

  // Feature: Verify note_save is allowed by default
  // Design: Evaluate note_save tool, confirm it returns allow
  test("note_save allowed by default", () => {
    const result = evaluate("note_save", { content: "test note" });
    expect(result).toBe("allow");
  });
});
