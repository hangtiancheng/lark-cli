// AgentProfileLoader: parse TOML agent profile files with 3-tier search
import { describe, expect, test } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { AgentProfileLoader } from "../../src/core/agents/loader.js";

describe("AgentProfileLoader", () => {
  // Feature: Load builtin planner profile
  // Design: Instantiate loader, call load("planner"), verify it returns non-null with expected fields
  test("loads builtin planner profile", () => {
    const loader = new AgentProfileLoader();
    const profile = loader.load("planner");
    expect(profile).not.toBeNull();
    if (profile) {
      expect(profile.name).toBe("planner");
      expect(profile.systemPrompt).not.toBe("");
      expect(profile.allowedTools.length).toBeGreaterThan(0);
    }
  });

  // Feature: Load all three builtin roles
  // Design: Parameterized test for planner, executor, reviewer
  test.each(["planner", "executor", "reviewer"])("loads builtin %s profile", (role) => {
    const loader = new AgentProfileLoader();
    const profile = loader.load(role);
    expect(profile).not.toBeNull();
    if (profile) {
      expect(profile.name).toBe(role);
      expect(profile.allowedTools.length).toBeGreaterThan(0);
    }
  });

  // Feature: Return null for unknown role
  // Design: Load a non-existent role name, assert it returns null instead of throwing
  test("returns null for unknown role", () => {
    const loader = new AgentProfileLoader();
    const result = loader.load("nonexistent_role_xyz");
    expect(result).toBeNull();
  });

  // Feature: Parse TOML profile correctly
  // Design: Create a temporary TOML file in project local dir, load it, verify all fields
  test("parses TOML profile correctly", () => {
    const tempDir = path.join(tmpdir(), `lark-test-${randomUUID()}`);
    mkdirSync(tempDir, { recursive: true });
    const localAgentsDir = path.join(tempDir, ".lark", "agents");
    mkdirSync(localAgentsDir, { recursive: true });

    try {
      const tomlPath = path.join(localAgentsDir, "tester.toml");
      const content = `[agent]
description = "Test role"
system_prompt = "You are a test assistant."
allowed_tools = ["read_file", "bash"]
model = "claude-sonnet-4-6"
`;
      writeFileSync(tomlPath, content, "utf-8");

      // Save and change cwd
      const originalCwd = process.cwd();
      process.chdir(tempDir);

      try {
        const loader = new AgentProfileLoader();
        const profile = loader.load("tester");

        expect(profile).not.toBeNull();
        if (profile) {
          expect(profile.name).toBe("tester");
          expect(profile.description).toBe("Test role");
          expect(profile.systemPrompt).toBe("You are a test assistant.");
          expect(profile.allowedTools).toContain("read_file");
          expect(profile.allowedTools).toContain("bash");
          expect(profile.model).toBe("claude-sonnet-4-6");
        }
      } finally {
        process.chdir(originalCwd);
      }
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // Feature: Project local profile overrides builtin
  // Design: Create a .lark/agents/ directory in temp, write a planner.toml that overrides builtin,
  //         change cwd to temp dir, verify the local version is loaded
  test("project local profile overrides builtin", () => {
    const tempDir = path.join(tmpdir(), `lark-test-${randomUUID()}`);
    mkdirSync(tempDir, { recursive: true });
    const localAgentsDir = path.join(tempDir, ".lark", "agents");
    mkdirSync(localAgentsDir, { recursive: true });

    try {
      const localPlannerPath = path.join(localAgentsDir, "planner.toml");
      const localContent = `[agent]
description = "local planner"
system_prompt = "local prompt"
allowed_tools = ["list_dir"]
model = ""
`;
      writeFileSync(localPlannerPath, localContent, "utf-8");

      // Save and change cwd
      const originalCwd = process.cwd();
      process.chdir(tempDir);

      try {
        const loader = new AgentProfileLoader();
        const profile = loader.load("planner");
        expect(profile).not.toBeNull();
        if (profile) {
          expect(profile.description).toBe("local planner");
          expect(profile.allowedTools).toContain("list_dir");
        }
      } finally {
        process.chdir(originalCwd);
      }
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
