import { describe, expect, test } from "vitest";
import { truncateToolResults } from "../../src/core/compact/budget.js";

describe("truncateToolResults", () => {
  // Feature: Verify short tool_result content is not truncated
  // Design: Pass message with content below limit, confirm it's unchanged
  test("short content not truncated", () => {
    const messages = [
      {
        role: "user" as const,
        content: [
          {
            type: "tool_result" as const,
            tool_use_id: "t1",
            content: "short content",
          },
        ],
      },
    ];
    const result = truncateToolResults(messages, 100, 50);
    const firstMsg = result[0];
    if (Array.isArray(firstMsg.content)) {
      const block = firstMsg.content[0];
      if (block.type === "tool_result") {
        expect(block.content).toBe("short content");
      }
    }
  });

  // Feature: Verify long tool_result content is truncated to keep length
  // Design: Pass message with content exceeding limit, confirm truncation marker and kept length
  test("long content truncated", () => {
    const longContent = "x".repeat(200);
    const messages = [
      {
        role: "user" as const,
        content: [
          {
            type: "tool_result" as const,
            tool_use_id: "t1",
            content: longContent,
          },
        ],
      },
    ];
    const result = truncateToolResults(messages, 100, 50);
    const firstMsg = result[0];
    if (Array.isArray(firstMsg.content)) {
      const block = firstMsg.content[0];
      if (block.type === "tool_result" && typeof block.content === "string") {
        expect(block.content.length).toBeLessThan(200);
        expect(block.content).toContain("[truncated");
      }
    }
  });

  // Feature: Verify non-tool_result blocks are not affected
  // Design: Pass message with text block, confirm it's unchanged
  test("non-tool_result blocks unchanged", () => {
    const messages = [
      {
        role: "assistant" as const,
        content: [{ type: "text" as const, text: "assistant text" }],
      },
    ];
    const result = truncateToolResults(messages, 100, 50);
    const firstMsg = result[0];
    if (Array.isArray(firstMsg.content)) {
      const block = firstMsg.content[0];
      if (block.type === "text") {
        expect(block.text).toBe("assistant text");
      }
    }
  });

  // Feature: Verify string content messages are not affected
  // Design: Pass message with string content, confirm it's unchanged
  test("string content messages unchanged", () => {
    const messages = [
      {
        role: "user" as const,
        content: "user message",
      },
    ];
    const result = truncateToolResults(messages, 100, 50);
    expect(result[0]?.content).toBe("user message");
  });
});
