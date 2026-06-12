// End-to-end integration test for the agent pipeline.
// Requires a real ANTHROPIC_API_KEY — skipped automatically when absent.
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, test } from "vitest";

import { AgentRunner } from "../../src/core/runner.js";
import { isRecord } from "../../src/core/bus/envelope.js";
import type { LarkConfig } from "../../src/core/config.js";

function makeConfig(overrides?: Partial<LarkConfig>): LarkConfig {
  return {
    host: "127.0.0.1",
    port: 7437,
    logging: { level: "INFO", file: "/dev/null", format: "text" },
    agent: { maxSteps: 5 },
    llm: { defaultModel: "claude-sonnet-4-6", router: "static" },
    trace: { enabled: false, file: "", includeLlmPayload: false },
    permission: { timeoutS: 60 },
    compaction: {
      autoThreshold: 0,
      toolResultLimit: 8000,
      toolResultKeep: 4000,
    },
    mcp: { servers: [] },
    ...overrides,
  };
}

function parseEvents(content: string): Record<string, unknown>[] {
  const events: Record<string, unknown>[] = [];
  for (const line of content.trim().split("\n")) {
    if (!line) continue;
    const parsed: unknown = JSON.parse(line);
    if (isRecord(parsed)) {
      events.push(parsed);
    }
  }
  return events;
}

// Skip all tests when ANTHROPIC_API_KEY is not set
const hasKey = Boolean(process.env["ANTHROPIC_API_KEY"]);
const describeIfKey = hasKey ? describe : describe.skip;

describeIfKey("run e2e integration", () => {
  // Feature: Full end-to-end agent pipeline: real LLM -> read_file tool -> success with events.jsonl
  // Design: Write a sample file, run agent with goal referencing it, verify events.jsonl has all key stages
  test("agent reads file and completes successfully", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "lark-e2e-"));
    const origDir = process.cwd();
    try {
      process.chdir(dir);

      // Create sample file for agent to read
      writeFileSync(
        path.join(dir, "sample.txt"),
        "# Test Document\n\nThe magic number mentioned in this file is 7391.\n",
        "utf-8",
      );

      const runsDir = path.join(dir, "runs");
      const config = makeConfig();
      const runner = new AgentRunner(config, { runsDir });

      await runner.run(
        "Use the read_file tool to read the file 'sample.txt' and report the magic number it mentions.",
      );

      // events.jsonl must exist
      const runDirs = readdirSync(runsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => path.join(runsDir, d.name));

      expect(runDirs.length).toBeGreaterThan(0);

      const firstRunDir = runDirs[0];
      if (!firstRunDir) return;

      const eventsFile = path.join(firstRunDir, "events.jsonl");
      const content = readFileSync(eventsFile, "utf-8");
      const events = parseEvents(content);
      const types = events.map((e) => e["type"]);

      // Event sequence assertions
      expect(types[0]).toBe("run.started");
      expect(types[types.length - 1]).toBe("run.finished");
      expect(types).toContain("step.started");
      expect(types).toContain("tool.call_started");
      expect(types).toContain("tool.call_finished");
      expect(types).toContain("llm.usage");

      // Run completed successfully
      const finished = events[events.length - 1];
      expect(finished["status"]).toBe("success");

      // read_file was actually invoked
      const toolStarts = events.filter(
        (e) => e["type"] === "tool.call_started",
      );
      expect(toolStarts.some((e) => e["tool_name"] === "read_file")).toBe(true);

      // run_id is consistent across the event stream
      const runId = events[0]?.["run_id"];
      expect(events.every((e) => e["run_id"] === runId)).toBe(true);

      // LLM cache stats are present
      const usageEvents = events.filter((e) => e["type"] === "llm.usage");
      expect(usageEvents.length).toBeGreaterThanOrEqual(1);
      for (const ue of usageEvents) {
        expect(ue).toHaveProperty("input_tokens");
        expect(ue).toHaveProperty("output_tokens");
        expect(ue).toHaveProperty("cache_read_input_tokens");
      }
    } finally {
      process.chdir(origDir);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
