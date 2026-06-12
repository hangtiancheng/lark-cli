import { describe, expect, test } from "vitest";
import { ExecutionContext } from "../../src/core/context.js";

describe("ExecutionContext", () => {
  // Feature: Verify ExecutionContext initializes with goal wrapped as first user message
  // Design: Directly check initial messages state without any method calls, as this is the starting point for Anthropic messages format
  test("initial message is goal", () => {
    const ctx = new ExecutionContext({
      runId: "r1",
      goal: "test goal",
      maxSteps: 5,
    });
    expect(ctx.messages).toEqual([{ role: "user", content: "test goal" }]);
  });

  // Feature: Verify isDone() returns false for newly created context
  // Design: Query immediately after initialization without any operations, ruling out default value errors that would cause AgentLoop to think task is complete on first step
  test("isDone returns false when running", () => {
    const ctx = new ExecutionContext({
      runId: "r1",
      goal: "g",
      maxSteps: 5,
    });
    expect(ctx.isDone()).toBe(false);
  });

  // Feature: Verify markSuccess sets isDone, status, and reason fields to reflect success state
  // Design: Assert all three fields simultaneously, as both AgentLoop and AgentRunner depend on their combined state to determine run outcome
  test("markSuccess", () => {
    const ctx = new ExecutionContext({
      runId: "r1",
      goal: "g",
      maxSteps: 5,
    });
    ctx.markSuccess();
    expect(ctx.isDone()).toBe(true);
    expect(ctx.status).toBe("success");
    expect(ctx.reason).toBeNull();
  });

  // Feature: Verify markFailed correctly records status and reason
  // Design: Pass specific reason string, assert it's preserved in context.reason for use in run.finished event
  test("markFailed", () => {
    const ctx = new ExecutionContext({
      runId: "r1",
      goal: "g",
      maxSteps: 5,
    });
    ctx.markFailed("exceeded_max_steps");
    expect(ctx.isDone()).toBe(true);
    expect(ctx.status).toBe("failed");
    expect(ctx.reason).toBe("exceeded_max_steps");
  });

  // Feature: Verify addAssistantMessage appends message in Anthropic format (role=assistant)
  // Design: Check role and content reference of last message, confirming message structure required by Anthropic API
  test("addAssistantMessage appended", () => {
    const ctx = new ExecutionContext({
      runId: "r1",
      goal: "g",
      maxSteps: 5,
    });
    const content = [{ type: "text" as const, text: "I'll help" }];
    ctx.addAssistantMessage(content);
    const last = ctx.messages[ctx.messages.length - 1];
    expect(last.role).toBe("assistant");
    expect(last.content).toEqual(content);
  });

  // Feature: Verify tool results are wrapped as tool_result type user messages with correct tool_use_id
  // Design: First add assistant message with tool_use block (required by Anthropic), then call addToolResult, check final message structure
  test("addToolResult creates user message", () => {
    const ctx = new ExecutionContext({
      runId: "r1",
      goal: "g",
      maxSteps: 5,
    });
    ctx.addAssistantMessage([
      {
        type: "tool_use",
        id: "tool_use_01",
        name: "read_file",
        input: { path: "x" },
      },
    ]);
    ctx.addToolResult("tool_use_01", "file content");
    const last = ctx.messages[ctx.messages.length - 1];
    expect(last.role).toBe("user");
    if (Array.isArray(last.content)) {
      const block = last.content[0];
      if (block.type === "tool_result") {
        expect(block.tool_use_id).toBe("tool_use_01");
        expect(block.content).toBe("file content");
      }
    }
  });

  // Feature: Verify multiple tool results from same step are merged into one user message instead of split
  // Design: Call addToolResult twice consecutively, assert total message count is 3 (goal + assistant + merged user); Anthropic API requires same-round tool_results to be submitted together
  test("multiple tool results share one message", () => {
    const ctx = new ExecutionContext({
      runId: "r1",
      goal: "g",
      maxSteps: 5,
    });
    ctx.addAssistantMessage([
      {
        type: "tool_use",
        id: "tool_use_01",
        name: "read_file",
        input: {},
      },
      {
        type: "tool_use",
        id: "tool_use_02",
        name: "read_file",
        input: {},
      },
    ]);
    ctx.addToolResult("tool_use_01", "result A");
    ctx.addToolResult("tool_use_02", "result B");

    // goal + assistant + tool_results (merged into one)
    expect(ctx.messages.length).toBe(3);
    const last = ctx.messages[ctx.messages.length - 1];
    expect(last.role).toBe("user");
    if (Array.isArray(last.content)) {
      expect(last.content.length).toBe(2);
      const block0 = last.content[0];
      const block1 = last.content[1];
      if (block0.type === "tool_result") {
        expect(block0.tool_use_id).toBe("tool_use_01");
      }
      if (block1.type === "tool_result") {
        expect(block1.tool_use_id).toBe("tool_use_02");
      }
    }
  });

  // Feature: Verify is_error flag is correctly passed through to message block for failed tool results
  // Design: Pass is_error=true and check field in block, confirming error flag is not lost so LLM can perceive tool failure in next step
  test("tool result error flag", () => {
    const ctx = new ExecutionContext({
      runId: "r1",
      goal: "g",
      maxSteps: 5,
    });
    ctx.addAssistantMessage([
      {
        type: "tool_use",
        id: "t1",
        name: "x",
        input: {},
      },
    ]);
    ctx.addToolResult("t1", "something failed", true);
    const last = ctx.messages[ctx.messages.length - 1];
    if (Array.isArray(last.content)) {
      const block = last.content[0];
      if (block.type === "tool_result") {
        expect(block.is_error).toBe(true);
        expect(block.content).toBe("something failed");
      }
    }
  });

  // Feature: Verify message role order across multiple steps follows user-assistant alternation rule
  // Design: Only check roles list, not content, focusing on Anthropic API requirement for alternating message format
  test("message order across steps", () => {
    const ctx = new ExecutionContext({
      runId: "r1",
      goal: "g",
      maxSteps: 5,
    });
    ctx.addAssistantMessage([{ type: "text", text: "step 1 plan" }]);
    ctx.addToolResult("t1", "tool result");
    ctx.addAssistantMessage([{ type: "text", text: "step 2 plan" }]);

    const roles = ctx.messages.map((m) => m.role);
    expect(roles).toEqual(["user", "assistant", "user", "assistant"]);
  });

  // Feature: Verify step counter initial value is 0
  // Design: Simple boundary value test, confirming counter starting point that AgentLoop depends on for step limit checking
  test("step counter default", () => {
    const ctx = new ExecutionContext({
      runId: "r1",
      goal: "g",
      maxSteps: 20,
    });
    expect(ctx.step).toBe(0);
  });
});
