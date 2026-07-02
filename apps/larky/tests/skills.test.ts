/* eslint-disable @typescript-eslint/require-await */
import { describe, it, expect } from "vitest";
import { runInline } from "../src/skills/executor.js";
import type { Skill, SkillHost } from "../src/skills/skill.js";
import { ToolRegistry } from "../src/tools/registry.js";

function makeHost() {
  const activated: [string, string][] = [];
  let filter: ((name: string) => boolean) | null = null;
  const registry = new ToolRegistry();
  // Register stub tools that skills reference in allowedTools
  registry.register({
    name: "ReadFile",
    description: "read",
    category: "read",
    system: false,
    schema: () => ({
      name: "ReadFile",
      description: "read",
      input_schema: {
        type: "object",
        properties: {},
      },
    }),
    execute: async () => ({ output: "", isError: false }),
  });
  registry.register({
    name: "Grep",
    description: "grep",
    category: "read",
    system: false,
    schema: () => ({
      name: "Grep",
      description: "grep",
      input_schema: {
        type: "object",
        properties: {},
      },
    }),
    execute: async () => ({ output: "", isError: false }),
  });
  const host: SkillHost = {
    activateSkill: (n, b) => activated.push([n, b]),
    setToolFilter: (f) => {
      filter = f;
    },
    toolRegistry: () => registry,
  };
  return { host, activated, getFilter: () => filter };
}

function skill(body: string, allowedTools?: string[]): Skill {
  return {
    meta: { name: "demo", description: "d", allowedTools, mode: "fork" },
    body,
    sourceDir: "",
    isDirectory: false,
  };
}

describe("skills runInline", () => {
  it("substitutes $ARGUMENTS and pins the SOP + tool filter", () => {
    const { host, activated, getFilter } = makeHost();
    const body = runInline(skill("Do $ARGUMENTS now.", ["ReadFile", "Grep"]), "the thing", host);

    expect(body).toBe("Do the thing now.");
    expect(activated[0][0]).toBe("demo");
    expect(activated[0][1]).toBe("Do the thing now.");

    const filter = getFilter();
    expect(filter?.("ReadFile")).toBe(true);
    expect(filter?.("Bash")).toBe(false);
  });

  it("appends a User Request fallback when there is no placeholder", () => {
    const { host } = makeHost();
    const body = runInline(skill("SOP body"), "extra context", host);
    expect(body).toContain("SOP body");
    expect(body).toContain("User Request: extra context");
  });

  it("does not set a tool filter when the skill allows all tools", () => {
    const { host, getFilter } = makeHost();
    runInline(skill("body"), "", host);
    expect(getFilter()).toBeNull();
  });
});
