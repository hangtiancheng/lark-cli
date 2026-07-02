import { describe, it, expect } from "vitest";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Message } from "../src/conversation/conversation.js";
import { applyBudget } from "../src/tool-result/budget.js";
import { buildManager } from "../src/tool-result/reconstruct.js";
import { ContentReplacementState } from "../src/tool-result/state.js";

function bigToolResultConversation(size: number): Message[] {
  return [
    { role: "user", content: "do something" },
    {
      role: "assistant",
      content: "",
      toolUses: [{ toolUseId: "t1", toolName: "Bash", arguments: { command: "ls" } }],
    },
    {
      role: "user",
      content: "",
      toolResults: [{ toolUseId: "t1", content: "x".repeat(size), isError: false }],
    },
  ];
}

describe("tool result budget wiring", () => {
  it("spills a large tool result and records the replacement", () => {
    const workDir = mkdtempSync(join(tmpdir(), "larky-tr-"));
    const state = new ContentReplacementState();
    const messages = bigToolResultConversation(60000);

    const budgeted = applyBudget(messages, workDir, state);
    const result = budgeted[2].toolResults?.[0].content;

    // Original 60000-char output (> SINGLE_RESULT_LIMIT) is replaced with a short spill preview.
    expect(result?.length).toBeLessThan(60000);
    expect(result).toContain("save to");
    // The decision is recorded so later turns reuse it.
    expect(state.getReplacement("t1")).toBe(result);
  });

  it("is idempotent across turns: reuses the recorded replacement, no re-spill", () => {
    const workDir = mkdtempSync(join(tmpdir(), "larky-tr-"));
    const state = new ContentReplacementState();
    const messages = bigToolResultConversation(60000);

    const first = applyBudget(messages, workDir, state)[2].toolResults?.[0].content;
    const spillCountAfterFirst = readdirSync(join(workDir, ".larky", "tool_results")).length;

    // Re-applying the budget with the same state must return the same content
    // and must NOT write a second spill file.
    const second = applyBudget(messages, workDir, state)[2].toolResults?.[0].content;
    const spillCountAfterSecond = readdirSync(join(workDir, ".larky", "tool_results")).length;

    expect(second).toBe(first);
    expect(spillCountAfterSecond).toBe(spillCountAfterFirst);
  });

  it("buildManager rebuilds a conversation preserving budgeted content", () => {
    const workDir = mkdtempSync(join(tmpdir(), "larky-tr-"));
    const state = new ContentReplacementState();
    const budgeted = applyBudget(bigToolResultConversation(60000), workDir, state);

    const apiConversation = buildManager(budgeted);
    const rebuilt = apiConversation.getMessages();

    expect(rebuilt).toHaveLength(3);
    expect(rebuilt[1].toolUses?.[0].toolName).toBe("Bash");
    expect(rebuilt[2].toolResults?.[0].content).toBe(budgeted[2].toolResults?.[0].content);
    expect(rebuilt[2].toolResults?.[0].content).toContain("save to");
  });

  it("leaves small tool results untouched", () => {
    const workDir = mkdtempSync(join(tmpdir(), "larky-tr-"));
    const state = new ContentReplacementState();
    const messages = bigToolResultConversation(100);

    const budgeted = applyBudget(messages, workDir, state);
    expect(budgeted[2].toolResults?.[0].content).toBe("x".repeat(100));
    expect(state.getReplacement("t1")).toBeUndefined();
  });
});
