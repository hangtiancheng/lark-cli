import { describe, expect, test } from "vitest";
import { ExecutionContext } from "../../src/core/context.js";

describe("ExecutionContext System Prompt", () => {
  // Feature: Verify system prompt includes base prompt
  // Design: Create context without override, confirm base prompt is included
  test("includes base prompt", () => {
    const ctx = new ExecutionContext({
      runId: "r1",
      goal: "test",
      maxSteps: 5,
    });
    const prompt = ctx.systemPrompt("Base prompt");
    expect(prompt).toContain("Base prompt");
  });

  // Feature: Verify system prompt uses override when provided
  // Design: Create context with override, confirm override is used instead of base
  test("uses override when provided", () => {
    const ctx = new ExecutionContext({
      runId: "r1",
      goal: "test",
      maxSteps: 5,
      systemPromptOverride: "Override prompt",
    });
    const prompt = ctx.systemPrompt("Base prompt");
    expect(prompt).toContain("Override prompt");
    expect(prompt).not.toContain("Base prompt");
  });

  // Feature: Verify system prompt includes global context
  // Design: Create context with global context, confirm it's included
  test("includes global context", () => {
    const ctx = new ExecutionContext({
      runId: "r1",
      goal: "test",
      maxSteps: 5,
      globalContext: "Global context info",
    });
    const prompt = ctx.systemPrompt("Base");
    expect(prompt).toContain("Global Context");
    expect(prompt).toContain("Global context info");
  });

  // Feature: Verify system prompt includes project context
  // Design: Create context with project context, confirm it's included
  test("includes project context", () => {
    const ctx = new ExecutionContext({
      runId: "r1",
      goal: "test",
      maxSteps: 5,
      projectContext: "Project context info",
    });
    const prompt = ctx.systemPrompt("Base");
    expect(prompt).toContain("Project Context");
    expect(prompt).toContain("Project context info");
  });

  // Feature: Verify system prompt includes session notes
  // Design: Create context with session notes, confirm they're included
  test("includes session notes", () => {
    const ctx = new ExecutionContext({
      runId: "r1",
      goal: "test",
      maxSteps: 5,
      sessionNotes: "Important session note",
    });
    const prompt = ctx.systemPrompt("Base");
    expect(prompt).toContain("Session Notes");
    expect(prompt).toContain("Important session note");
  });

  // Feature: Verify system prompt assembles all components in order
  // Design: Create context with all components, confirm they appear in correct order
  test("assembles all components in order", () => {
    const ctx = new ExecutionContext({
      runId: "r1",
      goal: "test",
      maxSteps: 5,
      globalContext: "Global",
      projectContext: "Project",
      sessionNotes: "Session",
    });
    const prompt = ctx.systemPrompt("Base");
    const baseIndex = prompt.indexOf("Base");
    const globalIndex = prompt.indexOf("Global Context");
    const projectIndex = prompt.indexOf("Project Context");
    const sessionIndex = prompt.indexOf("Session Notes");

    expect(baseIndex).toBeLessThan(globalIndex);
    expect(globalIndex).toBeLessThan(projectIndex);
    expect(projectIndex).toBeLessThan(sessionIndex);
  });
});
