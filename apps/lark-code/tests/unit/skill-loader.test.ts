import { describe, expect, test } from "vitest";
import { SkillLoader } from "../../src/core/skills/loader.js";
import type { Skill } from "../../src/core/skills/loader.js";

describe("SkillLoader", () => {
  // Feature: resolve loads builtin skill files
  // Design: Resolve 'init' which exists in builtin, verify it loads
  test("resolve loads builtin skill", () => {
    const loader = new SkillLoader();
    const skill = loader.resolve("init");
    expect(skill).not.toBeNull();
    if (skill) {
      expect(skill.name).toBe("init");
      expect(skill.description).toContain("context.md");
      expect(skill.allowedTools).toContain("read_file");
      expect(skill.systemPromptTemplate).toContain("$ARGUMENTS");
    }
  });

  // Feature: resolve loads all 4 builtin skills
  // Design: Resolve each builtin skill, verify all load
  test("resolve loads all builtin skills", () => {
    const loader = new SkillLoader();
    const names = ["init", "orchestrate", "review", "summarize"];
    for (const name of names) {
      const skill = loader.resolve(name);
      expect(skill, `skill ${name} should exist`).not.toBeNull();
    }
  });

  // Feature: resolve returns null for non-existent skill
  // Design: Try resolving unknown skill, verify null
  test("resolve returns null for unknown skill", () => {
    const loader = new SkillLoader();
    expect(loader.resolve("nonexistent-skill-xyz")).toBeNull();
  });

  // Feature: renderPrompt replaces $ARGUMENTS with actual args
  // Design: Create a skill with template, render with args, verify substitution
  test("renderPrompt substitutes $ARGUMENTS", () => {
    const loader = new SkillLoader();
    const skill: Skill = {
      name: "test-skill",
      description: "A test skill",
      allowedTools: [],
      systemPromptTemplate: "You are a helper. The user asks: $ARGUMENTS. Respond accordingly.",
    };

    const result = loader.renderPrompt(skill, "how do I sort an array?");
    expect(result).toBe(
      "You are a helper. The user asks: how do I sort an array?. Respond accordingly.",
    );
  });

  // Feature: renderPrompt handles multiple $ARGUMENTS occurrences
  // Design: Template with $ARGUMENTS appearing twice
  test("renderPrompt replaces all $ARGUMENTS occurrences", () => {
    const loader = new SkillLoader();
    const skill: Skill = {
      name: "multi",
      description: "",
      allowedTools: [],
      systemPromptTemplate: "Task: $ARGUMENTS\nContext: $ARGUMENTS",
    };

    const result = loader.renderPrompt(skill, "deploy app");
    expect(result).toBe("Task: deploy app\nContext: deploy app");
  });

  // Feature: renderPrompt handles empty args
  // Design: Template with $ARGUMENTS, render with empty string
  test("renderPrompt handles empty arguments", () => {
    const loader = new SkillLoader();
    const skill: Skill = {
      name: "empty",
      description: "",
      allowedTools: [],
      systemPromptTemplate: "Do: $ARGUMENTS",
    };

    const result = loader.renderPrompt(skill, "");
    expect(result).toBe("Do: ");
  });

  // Feature: listAll returns builtin skill names
  // Design: List all skills, verify builtin names are present
  test("listAll includes builtin skills", () => {
    const loader = new SkillLoader();
    const names = loader.listAll();
    expect(names).toContain("init");
    expect(names).toContain("orchestrate");
    expect(names).toContain("review");
    expect(names).toContain("summarize");
  });

  // Feature: listAllSkills returns Skill objects with descriptions
  // Design: List all skill objects, verify they have descriptions
  test("listAllSkills returns skills with descriptions", () => {
    const loader = new SkillLoader();
    const skills = loader.listAllSkills();
    expect(skills.length).toBeGreaterThanOrEqual(4);
    for (const skill of skills) {
      expect(skill.name).toBeTruthy();
      expect(skill.description).toBeTruthy();
    }
  });

  // Feature: orchestrate skill has correct allowed tools
  // Design: Load orchestrate skill, verify allowed_tools list
  test("orchestrate skill has spawn_agent in allowed tools", () => {
    const loader = new SkillLoader();
    const skill = loader.resolve("orchestrate");
    expect(skill).not.toBeNull();
    if (skill) {
      expect(skill.allowedTools).toContain("spawn_agent");
      expect(skill.allowedTools).toContain("task_create");
    }
  });

  // Feature: review skill has correct allowed tools
  // Design: Load review skill, verify allowed_tools list
  test("review skill has read_file and bash in allowed tools", () => {
    const loader = new SkillLoader();
    const skill = loader.resolve("review");
    expect(skill).not.toBeNull();
    if (skill) {
      expect(skill.allowedTools).toContain("read_file");
      expect(skill.allowedTools).toContain("bash");
    }
  });
});
