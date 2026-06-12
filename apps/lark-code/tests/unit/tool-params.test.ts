import { describe, expect, test } from "vitest";
import {
  BashParamsSchema,
  ReadFileParamsSchema,
  WriteFileParamsSchema,
  ListDirParamsSchema,
  NoteSaveParamsSchema,
} from "../../src/core/tools/builtin/index.js";

describe("Tool Params Validation", () => {
  // Feature: BashParamsSchema validates command field
  // Design: Parse valid command, confirm success
  test("bash params validates command", () => {
    const result = BashParamsSchema.safeParse({ command: "echo hello" });
    expect(result.success).toBe(true);
  });

  // Feature: BashParamsSchema rejects missing command
  // Design: Parse without command, confirm failure
  test("bash params rejects missing command", () => {
    const result = BashParamsSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  // Feature: BashParamsSchema applies default timeout
  // Design: Parse without timeout, confirm default is 60
  test("bash params applies default timeout", () => {
    const result = BashParamsSchema.parse({ command: "ls" });
    expect(result.timeout).toBe(60);
  });

  // Feature: BashParamsSchema rejects out-of-range timeout
  // Design: Parse with timeout > 120, confirm failure
  test("bash params rejects timeout > 120", () => {
    const result = BashParamsSchema.safeParse({ command: "ls", timeout: 999 });
    expect(result.success).toBe(false);
  });

  // Feature: WriteFileParamsSchema validates path and content
  // Design: Parse valid path+content, confirm success
  test("write_file params validates path and content", () => {
    const result = WriteFileParamsSchema.safeParse({
      path: "/tmp/test.txt",
      content: "hello",
    });
    expect(result.success).toBe(true);
  });

  // Feature: WriteFileParamsSchema rejects missing content
  // Design: Parse without content, confirm failure
  test("write_file params rejects missing content", () => {
    const result = WriteFileParamsSchema.safeParse({ path: "/tmp/test.txt" });
    expect(result.success).toBe(false);
  });

  // Feature: ReadFileParamsSchema validates path
  // Design: Parse valid path, confirm success
  test("read_file params validates path", () => {
    const result = ReadFileParamsSchema.safeParse({ path: "/tmp/test.txt" });
    expect(result.success).toBe(true);
  });

  // Feature: ReadFileParamsSchema rejects empty params
  // Design: Parse empty object, confirm failure
  test("read_file params rejects empty params", () => {
    const result = ReadFileParamsSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  // Feature: ListDirParamsSchema applies defaults
  // Design: Parse empty object, confirm defaults
  test("list_dir params applies defaults", () => {
    const result = ListDirParamsSchema.parse({});
    expect(result.path).toBe(".");
    expect(result.max_depth).toBe(2);
  });

  // Feature: ListDirParamsSchema rejects max_depth > 4
  // Design: Parse with max_depth=10, confirm failure
  test("list_dir params rejects max_depth > 4", () => {
    const result = ListDirParamsSchema.safeParse({ max_depth: 10 });
    expect(result.success).toBe(false);
  });

  // Feature: NoteSaveParamsSchema validates content
  // Design: Parse valid content, confirm success
  test("note_save params validates content", () => {
    const result = NoteSaveParamsSchema.safeParse({
      content: "important note",
    });
    expect(result.success).toBe(true);
  });

  // Feature: NoteSaveParamsSchema rejects missing content
  // Design: Parse empty object, confirm failure
  test("note_save params rejects missing content", () => {
    const result = NoteSaveParamsSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});
