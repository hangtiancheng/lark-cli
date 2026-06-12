import { describe, test, expect } from "vitest";
import { resolve, sep } from "node:path";
import { resolveInsideBase, buildCodeOutputDir } from "../src/engine/project/project-path.js";

describe("resolveInsideBase", () => {
  const base = "/tmp/test-project";

  test("resolves a simple relative path", () => {
    const result = resolveInsideBase(base, "src/index.ts");
    expect(result).toBe(resolve(base, "src/index.ts"));
  });

  test("resolves '.' to base directory", () => {
    const result = resolveInsideBase(base, ".");
    expect(result).toBe(resolve(base));
  });

  test("throws on empty path", () => {
    expect(() => resolveInsideBase(base, "")).toThrow("Path cannot be empty");
  });

  test("throws on whitespace-only path", () => {
    expect(() => resolveInsideBase(base, "   ")).toThrow("Path cannot be empty");
  });

  test("throws on absolute path starting with /", () => {
    expect(() => resolveInsideBase(base, "/etc/passwd")).toThrow("Absolute paths are not allowed");
  });

  test("throws on absolute path starting with backslash", () => {
    expect(() => resolveInsideBase(base, "\\Windows\\System32")).toThrow(
      "Absolute paths are not allowed",
    );
  });

  test("throws on path traversal with ../", () => {
    expect(() => resolveInsideBase(base, "../../../etc/passwd")).toThrow(
      "Path traversal is not allowed",
    );
  });

  test("throws on path traversal that escapes base", () => {
    expect(() => resolveInsideBase(base, "foo/../../..")).toThrow("Path traversal is not allowed");
  });

  test("allows nested relative paths within base", () => {
    const result = resolveInsideBase(base, "src/components/App.tsx");
    expect(result).toBe(resolve(base, "src/components/App.tsx"));
  });

  test("allows path with .. that stays within base", () => {
    const result = resolveInsideBase(base, "src/../src/index.ts");
    expect(result).toBe(resolve(base, "src/index.ts"));
  });
});

describe("buildCodeOutputDir", () => {
  test("builds correct output directory", () => {
    const result = buildCodeOutputDir("/home/user/projects", "react", "my-app");
    expect(result).toBe(resolve("/home/user/projects", "tmp", "react_my-app"));
  });

  test("combines codegenType and projectName with underscore", () => {
    const result = buildCodeOutputDir("/root", "vue", "dashboard");
    expect(result).toContain("vue_dashboard");
  });
});
