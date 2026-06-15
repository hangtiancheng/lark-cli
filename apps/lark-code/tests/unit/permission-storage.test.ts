import { describe, expect, test } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { loadPolicyFile, savePolicyFile } from "../../src/core/permissions/storage.js";

function tmpDir(): string {
  return mkdtempSync(path.join(tmpdir(), "lark-test-"));
}

describe("Permission Storage", () => {
  // Feature: loadPolicyFile returns empty object for missing file
  // Design: Load from non-existent path, verify empty result
  test("loadPolicyFile returns empty for missing file", () => {
    const result = loadPolicyFile("/tmp/nonexistent-policy-12345.toml");
    expect(result).toEqual({});
  });

  // Feature: savePolicyFile creates file with [always] section
  // Design: Save policy, read file, verify format
  test("savePolicyFile creates correct TOML format", () => {
    const dir = tmpDir();
    try {
      const filePath = path.join(dir, "policy.toml");
      savePolicyFile({ bash: "allow", write_file: "deny" }, filePath);

      expect(existsSync(filePath)).toBe(true);
      const content = readFileSync(filePath, "utf-8");
      expect(content).toContain("[always]");
      expect(content).toContain('bash = "allow"');
      expect(content).toContain('write_file = "deny"');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Feature: loadPolicyFile reads back saved policy
  // Design: Save then load, verify roundtrip
  test("loadPolicyFile reads saved policy", () => {
    const dir = tmpDir();
    try {
      const filePath = path.join(dir, "policy.toml");
      savePolicyFile({ bash: "allow", read_file: "allow", write_file: "deny" }, filePath);

      const loaded = loadPolicyFile(filePath);
      expect(loaded["bash"]).toBe("allow");
      expect(loaded["read_file"]).toBe("allow");
      expect(loaded["write_file"]).toBe("deny");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Feature: loadPolicyFile ignores non-[always] sections
  // Design: Write file with extra sections, verify only [always] is read
  test("loadPolicyFile ignores non-always sections", () => {
    const dir = tmpDir();
    try {
      const filePath = path.join(dir, "policy.toml");
      const content = [
        "[other]",
        'foo = "bar"',
        "",
        "[always]",
        'bash = "allow"',
        "",
        "[another]",
        'baz = "qux"',
      ].join("\n");

      writeFileSync(filePath, content, "utf-8");

      const loaded = loadPolicyFile(filePath);
      expect(Object.keys(loaded)).toEqual(["bash"]);
      expect(loaded["bash"]).toBe("allow");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Feature: loadPolicyFile ignores comments and malformed lines
  // Design: Write file with comments, verify they're skipped
  test("loadPolicyFile ignores comments", () => {
    const dir = tmpDir();
    try {
      const filePath = path.join(dir, "policy.toml");
      const content = [
        "# This is a comment",
        "[always]",
        "# Another comment",
        'bash = "allow"',
        "invalid_line_no_equals",
      ].join("\n");

      writeFileSync(filePath, content, "utf-8");

      const loaded = loadPolicyFile(filePath);
      expect(loaded["bash"]).toBe("allow");
      expect(Object.keys(loaded)).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Feature: savePolicyFile creates parent directories
  // Design: Save to nested path, verify directories created
  test("savePolicyFile creates parent directories", () => {
    const dir = tmpDir();
    try {
      const filePath = path.join(dir, "nested", "deep", "policy.toml");
      savePolicyFile({ bash: "allow" }, filePath);
      expect(existsSync(filePath)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Feature: savePolicyFile sorts tools alphabetically
  // Design: Save with unsorted keys, verify file has sorted order
  test("savePolicyFile sorts tools alphabetically", () => {
    const dir = tmpDir();
    try {
      const filePath = path.join(dir, "policy.toml");
      savePolicyFile({ write_file: "deny", bash: "allow" }, filePath);

      const content = readFileSync(filePath, "utf-8");
      const bashIdx = content.indexOf("bash");
      const writeIdx = content.indexOf("write_file");
      expect(bashIdx).toBeLessThan(writeIdx);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
