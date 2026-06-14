import { describe, expect, test } from "vitest";
import { AgentRunner } from "../../src/core/runner.js";
import { EventBus } from "../../src/core/events/bus.js";
import type { LLMProvider } from "../../src/core/llm/base.js";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Shared mock config used across all runner tests
function mockConfig() {
  return {
    host: "127.0.0.1",
    port: 7437,
    logging: { level: "info", file: "", format: "text" },
    agent: { maxSteps: 5 },
    llm: { defaultModel: "claude-3", router: "static" },
    trace: { enabled: false, file: "", includeLlmPayload: false },
    permission: { timeoutS: 60 },
    compaction: {
      autoThreshold: 0.8,
      toolResultLimit: 10000,
      toolResultKeep: 5000,
    },
    mcp: { servers: [] },
  };
}

// Shared mock provider that immediately ends the turn
function mockEndTurnProvider(): LLMProvider {
  return {
    chat: () =>
      Promise.resolve({
        stopReason: "end_turn",
        toolUses: [],
        text: "Done",
        usage: null,
        thinkingBlocks: [],
      }),
  };
}

describe("AgentRunner", () => {
  // Feature: Verify AgentRunner executes a run
  // Design: Create runner with mock provider, run goal, confirm it completes
  test("executes a run", async () => {
    const dir = path.join(tmpdir(), `test-runner-${String(Date.now())}`);
    mkdirSync(dir, { recursive: true });
    const bus = new EventBus();
    const runner = new AgentRunner(mockConfig(), {
      provider: mockEndTurnProvider(),
      bus,
      runsDir: dir,
    });

    await runner.run("test goal");
    rmSync(dir, { recursive: true, force: true });
  });

  // Feature: Verify AgentRunner publishes run events
  // Design: Run goal, confirm run.started and run.finished events are published
  test("publishes run events", async () => {
    const dir = path.join(tmpdir(), `test-runner-${String(Date.now())}`);
    mkdirSync(dir, { recursive: true });
    const bus = new EventBus();
    const events: string[] = [];
    bus.subscribe((event) => {
      events.push(event.type);
      return Promise.resolve();
    });
    const runner = new AgentRunner(mockConfig(), {
      provider: mockEndTurnProvider(),
      bus,
      runsDir: dir,
    });

    await runner.run("test goal");
    expect(events).toContain("run.started");
    expect(events).toContain("run.finished");
    rmSync(dir, { recursive: true, force: true });
  });

  // Feature: Verify AgentRunner returns run outcome
  // Design: Run goal with runAndCapture, confirm outcome is returned
  test("returns run outcome", async () => {
    const dir = path.join(tmpdir(), `test-runner-${String(Date.now())}`);
    mkdirSync(dir, { recursive: true });
    const bus = new EventBus();
    const runner = new AgentRunner(mockConfig(), {
      provider: mockEndTurnProvider(),
      bus,
      runsDir: dir,
    });

    const outcome = await runner.runAndCapture("test goal");
    expect(outcome.status).toBe("success");
    rmSync(dir, { recursive: true, force: true });
  });

  // Feature: Verify MCP tools are registered when mcpManager is provided
  // Design: Create runner with mock mcpManager containing a tool whose LLM provider
  //         invokes that tool, then check tool.call_started event carries the MCP tool name
  test("registers MCP tools from mcpManager", async () => {
    const dir = path.join(tmpdir(), `test-runner-mcp-${String(Date.now())}`);
    mkdirSync(dir, { recursive: true });
    const bus = new EventBus();

    const toolNames: string[] = [];
    bus.subscribe((event) => {
      if (event.type === "tool.call_started") {
        const raw = event.tool_name;
        toolNames.push(raw);
      }
      return Promise.resolve();
    });

    // Mock MCP tool that returns success
    const mockMcpTool = {
      name: "test_server__search",
      description: "Search the web",
      inputSchema: { type: "object", properties: {} },
      invoke: () =>
        Promise.resolve({
          content: "search result",
          isError: false,
          errorType: null,
        }),
    };

    // Mock McpManagerLike with structural typing (no type assertion)
    const mockMcpManager = {
      getTools: () => [mockMcpTool],
    };

    // Provider that requests the MCP tool then ends
    let callCount = 0;
    const provider: LLMProvider = {
      chat: () => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            stopReason: "tool_use",
            toolUses: [
              {
                id: "toolu_1",
                type: "tool_use",
                name: "test_server__search",
                input: { query: "hello" },
                caller: { type: "direct" },
              },
            ],
            text: "",
            usage: null,
            thinkingBlocks: [],
          });
        }
        return Promise.resolve({
          stopReason: "end_turn",
          toolUses: [],
          text: "Done",
          usage: null,
          thinkingBlocks: [],
        });
      },
    };

    const runner = new AgentRunner(mockConfig(), {
      provider,
      bus,
      runsDir: dir,
      mcpManager: mockMcpManager,
    });

    await runner.run("search for hello");
    expect(toolNames).toContain("test_server__search");
    rmSync(dir, { recursive: true, force: true });
  });

  // Feature: Verify MCP tools respect tool whitelist
  // Design: Create runner with mcpManager and toolWhitelist that excludes the MCP tool,
  //         confirm the tool is NOT invoked (provider requests it but it's not in registry)
  test("MCP tools respect tool whitelist", async () => {
    const dir = path.join(tmpdir(), `test-runner-mcp-wl-${String(Date.now())}`);
    mkdirSync(dir, { recursive: true });
    const bus = new EventBus();

    const toolNames: string[] = [];
    bus.subscribe((event) => {
      if (event.type === "tool.call_started") {
        const raw = event.tool_name;
        toolNames.push(raw);
      }
      return Promise.resolve();
    });

    const mockMcpTool = {
      name: "test_server__search",
      description: "Search the web",
      inputSchema: { type: "object", properties: {} },
      invoke: () =>
        Promise.resolve({
          content: "search result",
          isError: false,
          errorType: null,
        }),
    };

    const mockMcpManager = {
      getTools: () => [mockMcpTool],
    };

    const provider = mockEndTurnProvider();

    const runner = new AgentRunner(mockConfig(), {
      provider,
      bus,
      runsDir: dir,
      mcpManager: mockMcpManager,
    });

    // Run with whitelist that does NOT include the MCP tool
    await runner.runAndCapture("test", {
      toolWhitelist: ["read_file", "bash"],
    });

    // MCP tool should not have been invoked
    expect(toolNames).not.toContain("test_server__search");
    rmSync(dir, { recursive: true, force: true });
  });
});
