import { describe, expect, test } from "vitest";
import { ReadFileTool } from "../../src/core/tools/builtin/read-file.js";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

describe("ReadFileTool", () => {
  // Feature: Verify ReadFileTool reads file contents
  // Design: Create temp file, read it, confirm content matches
  test("reads file contents", async () => {
    const dir = path.join(tmpdir(), `test-read-${String(Date.now())}`);
    mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, "test.txt");
    writeFileSync(filePath, "test content", "utf-8");

    const tool = new ReadFileTool();
    const result = await tool.invoke({ path: filePath });
    expect(result.isError).toBe(false);
    expect(result.content).toBe("test content");
    rmSync(dir, { recursive: true });
  });

  // Feature: Verify ReadFileTool returns error for non-existent file
  // Design: Read non-existent file, confirm isError is true
  test("returns error for non-existent file", async () => {
    const tool = new ReadFileTool();
    const result = await tool.invoke({ path: "/nonexistent/file.txt" });
    expect(result.isError).toBe(true);
  });

  // Feature: Verify ReadFileTool rejects path traversal
  // Design: Attempt to read file with ../ in path, confirm error
  test("rejects path traversal", async () => {
    const tool = new ReadFileTool();
    const result = await tool.invoke({ path: "../etc/passwd" });
    expect(result.isError).toBe(true);
    expect(result.content).toContain("path traversal");
  });

  // Feature: Verify ReadFileTool truncates large files
  // Design: Create file larger than 512KB, read it, confirm truncation
  test("truncates large files", async () => {
    const dir = path.join(tmpdir(), `test-read-${String(Date.now())}`);
    mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, "large.txt");
    const largeContent = "x".repeat(600 * 1024); // 600KB
    writeFileSync(filePath, largeContent, "utf-8");

    const tool = new ReadFileTool();
    const result = await tool.invoke({ path: filePath });
    expect(result.isError).toBe(false);
    expect(result.content.length).toBeLessThan(600 * 1024);
    expect(result.content).toContain("[truncated]");
    rmSync(dir, { recursive: true });
  });
});
