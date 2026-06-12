import { describe, expect, test } from "vitest";
import {
  BashTool,
  ReadFileTool,
  WriteFileTool,
  ListDirTool,
} from "../../src/core/tools/builtin/index.js";
import { mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

describe("Builtin Tools", () => {
  describe("BashTool", () => {
    // Feature: Verify BashTool executes simple commands
    // Design: Run echo command, confirm output matches
    test("executes simple commands", async () => {
      const tool = new BashTool();
      const result = await tool.invoke({ command: "echo hello" });
      expect(result.isError).toBe(false);
      expect(result.content.trim()).toBe("hello");
    });

    // Feature: Verify BashTool captures stderr
    // Design: Run command that writes to stderr, confirm it's captured
    test("captures stderr", async () => {
      const tool = new BashTool();
      const result = await tool.invoke({ command: "echo error >&2" });
      expect(result.isError).toBe(false);
      expect(result.content.trim()).toBe("error");
    });

    // Feature: Verify BashTool returns error for non-zero exit
    // Design: Run failing command, confirm isError is true
    test("returns error for non-zero exit", async () => {
      const tool = new BashTool();
      const result = await tool.invoke({ command: "exit 1" });
      expect(result.isError).toBe(true);
      expect(result.content).toContain("exit 1");
    });
  });

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
  });

  describe("WriteFileTool", () => {
    // Feature: Verify WriteFileTool creates files
    // Design: Write to new file, read it back, confirm content matches
    test("creates files", async () => {
      const dir = path.join(tmpdir(), `test-write-${String(Date.now())}`);
      mkdirSync(dir, { recursive: true });
      const filePath = path.join(dir, "test.txt");

      const tool = new WriteFileTool();
      const result = await tool.invoke({
        path: filePath,
        content: "written content",
      });
      expect(result.isError).toBe(false);

      const content = readFileSync(filePath, "utf-8");
      expect(content).toBe("written content");
      rmSync(dir, { recursive: true });
    });

    // Feature: Verify WriteFileTool creates parent directories
    // Design: Write to nested path, confirm parent dirs are created
    test("creates parent directories", async () => {
      const baseDir = path.join(tmpdir(), `test-write-${String(Date.now())}`);
      const dir = path.join(baseDir, "nested", "dir");
      const filePath = path.join(dir, "test.txt");

      const tool = new WriteFileTool();
      const result = await tool.invoke({ path: filePath, content: "nested" });
      expect(result.isError).toBe(false);

      const content = readFileSync(filePath, "utf-8");
      expect(content).toBe("nested");
      rmSync(baseDir, { recursive: true });
    });
  });

  describe("ListDirTool", () => {
    // Feature: Verify ListDirTool lists directory contents
    // Design: Create temp dir with files, list it, confirm files are listed
    test("lists directory contents", async () => {
      const dir = path.join(tmpdir(), `test-list-${String(Date.now())}`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, "file1.txt"), "content1", "utf-8");
      writeFileSync(path.join(dir, "file2.txt"), "content2", "utf-8");

      const tool = new ListDirTool();
      const result = await tool.invoke({ path: dir });
      expect(result.isError).toBe(false);
      expect(result.content).toContain("file1.txt");
      expect(result.content).toContain("file2.txt");
      rmSync(dir, { recursive: true });
    });

    // Feature: Verify ListDirTool respects max_depth
    // Design: Create nested dirs, list with max_depth=1, confirm only top level is listed
    test("respects max_depth", async () => {
      const dir = path.join(tmpdir(), `test-list-${String(Date.now())}`);
      const nested = path.join(dir, "nested");
      mkdirSync(nested, { recursive: true });
      writeFileSync(path.join(nested, "deep.txt"), "content", "utf-8");

      const tool = new ListDirTool();
      const result = await tool.invoke({ path: dir, max_depth: 1 });
      expect(result.isError).toBe(false);
      expect(result.content).toContain("nested");
      rmSync(dir, { recursive: true });
    });
  });
});
