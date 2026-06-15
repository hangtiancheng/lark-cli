import { describe, expect, test } from "vitest";
import {
  evaluate,
  matchesOutsideCwd,
  paramPreview,
  type ToolPolicy,
  PermissionDecision,
  DEFAULT_POLICIES,
} from "../../src/core/permissions/policy.js";

// --- matchesOutsideCwd heuristics ---

describe("matchesOutsideCwd", () => {
  test("absolute path forces match", () => {
    expect(matchesOutsideCwd("/etc/hosts")).toBe(true);
    expect(matchesOutsideCwd("/usr/bin/python")).toBe(true);
  });

  test("tilde path forces match", () => {
    expect(matchesOutsideCwd("~/Documents")).toBe(true);
    expect(matchesOutsideCwd("~/script.sh")).toBe(true);
  });

  test("parent traversal forces match", () => {
    expect(matchesOutsideCwd("../sibling")).toBe(true);
    expect(matchesOutsideCwd("cd ../other")).toBe(true);
  });

  test("$HOME forces match", () => {
    expect(matchesOutsideCwd("$HOME/file")).toBe(true);
    expect(matchesOutsideCwd("${HOME}/file")).toBe(true);
  });

  test("$PWD forces match", () => {
    expect(matchesOutsideCwd("$PWD/file")).toBe(true);
    expect(matchesOutsideCwd("${PWD}/file")).toBe(true);
  });

  test("cd command forces match", () => {
    expect(matchesOutsideCwd("cd /tmp")).toBe(true);
    expect(matchesOutsideCwd("cd /tmp && echo hi")).toBe(true);
    expect(matchesOutsideCwd("ls;cd /tmp")).toBe(true);
    expect(matchesOutsideCwd("ls&&cd /tmp")).toBe(true);
  });

  test("relative path does not trigger match", () => {
    expect(matchesOutsideCwd("echo hello")).toBe(false);
    expect(matchesOutsideCwd("ls -la")).toBe(false);
    expect(matchesOutsideCwd("node script.js")).toBe(false);
  });

  test("filename without slash does not trigger match", () => {
    expect(matchesOutsideCwd("Makefile")).toBe(false);
    expect(matchesOutsideCwd("README.md")).toBe(false);
  });
});

// --- evaluate() tier priority ---

describe("evaluate", () => {
  test("deny_patterns takes priority over everything (Tier 1)", () => {
    const policy: ToolPolicy = {
      default: PermissionDecision.ALLOW,
      allowPatterns: [".*"],
      denyPatterns: ["rm\\s+-rf"],
    };
    expect(evaluate("bash", { command: "rm -rf /" }, policy)).toBe("deny");
  });

  test("deny_patterns non-match falls through", () => {
    const policy: ToolPolicy = {
      default: PermissionDecision.ASK,
      allowPatterns: ["^echo"],
      denyPatterns: ["rm\\s+-rf"],
    };
    expect(evaluate("bash", { command: "echo hello" }, policy)).toBe("allow");
  });

  test("OUTSIDE_CWD forces ASK even with allow_patterns (Tier 2 > Tier 3)", () => {
    const policy: ToolPolicy = {
      default: PermissionDecision.ASK,
      allowPatterns: [".*"],
      denyPatterns: [],
    };
    expect(evaluate("bash", { command: "cd /tmp && echo test" }, policy)).toBe("ask");
  });

  test("OUTSIDE_CWD forces ASK even with default allow", () => {
    const policy: ToolPolicy = {
      default: PermissionDecision.ALLOW,
      allowPatterns: [],
      denyPatterns: [],
    };
    expect(evaluate("bash", { command: "/etc/passwd" }, policy)).toBe("ask");
  });

  test("allow_patterns grants access when no OUTSIDE_CWD (Tier 3)", () => {
    const policy: ToolPolicy = {
      default: PermissionDecision.ASK,
      allowPatterns: ["^echo\\s"],
      denyPatterns: [],
    };
    expect(evaluate("bash", { command: "echo hello" }, policy)).toBe("allow");
  });

  test("bash default is ask (Tier 4)", () => {
    expect(evaluate("bash", { command: "echo test" })).toBe("ask");
  });

  test("read_file default is allow", () => {
    expect(evaluate("read_file", { path: "test.txt" })).toBe("allow");
  });

  test("write_file default is ask", () => {
    expect(evaluate("write_file", { path: "test.txt" })).toBe("ask");
  });

  test("list_dir default is allow", () => {
    expect(evaluate("list_dir", { path: "." })).toBe("allow");
  });

  test("note_save default is allow", () => {
    expect(evaluate("note_save", { content: "test" })).toBe("allow");
  });

  test("unknown tool default is ask", () => {
    expect(evaluate("custom_tool", {})).toBe("ask");
  });

  test("deny_patterns wins over OUTSIDE_CWD (Tier 1 > Tier 2)", () => {
    const policy: ToolPolicy = {
      default: PermissionDecision.ALLOW,
      allowPatterns: [],
      denyPatterns: ["cd\\s+/tmp"],
    };
    expect(evaluate("bash", { command: "cd /tmp" }, policy)).toBe("deny");
  });

  test("patterns only apply to bash tool", () => {
    const policy: ToolPolicy = {
      default: PermissionDecision.ASK,
      allowPatterns: ["^test"],
      denyPatterns: ["^test"],
    };
    expect(evaluate("read_file", { command: "test" }, policy)).toBe("ask");
  });

  test("bash with empty command falls through to default", () => {
    expect(evaluate("bash", { command: "" })).toBe("ask");
  });

  test("bash with non-string command falls through to default", () => {
    expect(evaluate("bash", { command: 42 })).toBe("ask");
  });

  test("DEFAULT_POLICIES contains expected tools", () => {
    expect(DEFAULT_POLICIES["bash"]).toBeDefined();
    expect(DEFAULT_POLICIES["read_file"]).toBeDefined();
    expect(DEFAULT_POLICIES["write_file"]).toBeDefined();
    expect(DEFAULT_POLICIES["list_dir"]).toBeDefined();
    expect(DEFAULT_POLICIES["note_save"]).toBeDefined();
  });
});

// --- paramPreview ---

describe("paramPreview", () => {
  test("bash shows command=value", () => {
    expect(paramPreview("bash", { command: "echo hello" })).toBe("command=echo hello");
  });

  test("read_file shows path=value", () => {
    expect(paramPreview("read_file", { path: "test.txt" })).toBe("path=test.txt");
  });

  test("write_file shows path=value", () => {
    expect(paramPreview("write_file", { path: "test.txt" })).toBe("path=test.txt");
  });

  test("list_dir shows path=value", () => {
    expect(paramPreview("list_dir", { path: "." })).toBe("path=.");
  });

  test("note_save shows content=value", () => {
    expect(paramPreview("note_save", { content: "my note" })).toBe("content=my note");
  });

  test("long values are truncated to 60 chars", () => {
    const longCommand = "echo " + "x".repeat(100);
    const result = paramPreview("bash", { command: longCommand });
    expect(result.length).toBeLessThanOrEqual(70);
    expect(result).toContain("…"); // Unicode ellipsis
  });

  test("unknown tool shows JSON snippet", () => {
    const result = paramPreview("custom_tool", { key: "value" });
    expect(result).toContain("key");
    expect(result).toContain("value");
  });
});
