// AgentRunner: assembles all runtime dependencies and executes a full agent run
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import type Anthropic from "@anthropic-ai/sdk";

import type { LarkConfig } from "./config.js";
import { ExecutionContext } from "./context.js";
import { EventBus, type EventHandler } from "./events/bus.js";
import { EventWriter } from "./events/writer.js";
import { AgentLoop } from "./loop.js";
import type { LLMProvider } from "./llm/base.js";
import { AnthropicProvider } from "./llm/provider.js";
import { loadContextFile } from "./memory/loader.js";
import type { PermissionManager } from "./permissions/manager.js";
import { newRunId } from "./runs.js";
import type { Session } from "./session/model.js";
import type { SessionStore } from "./session/store.js";
import { BackgroundTaskRegistry } from "./subagent/registry.js";
import { AgentResultTool, SpawnAgentTool } from "./subagent/tool.js";
import { TaskManager } from "./task/manager.js";
import {
  BashTool,
  ReadFileTool,
  WriteFileTool,
  ListDirTool,
  NoteSaveTool,
  TaskCreateTool,
  TaskGetTool,
  TaskListTool,
  TaskUpdateTool,
} from "./tools/builtin/index.js";
import { ToolRegistry } from "./tools/registry.js";
import { TracingProvider } from "./trace/provider.js";
import type { TraceWriter } from "./trace/writer.js";
import { Compactor } from "./compact/compactor.js";
import type { BaseTool } from "./tools/base.js";

// Minimal interface for MCP server manager (avoids coupling to concrete class private fields)
interface McpManagerLike {
  getTools(): BaseTool[];
}

function now(): string {
  return new Date().toISOString();
}

export interface RunOutcome {
  status: string;
  result: string;
  reason: string | null;
}

export class AgentRunner {
  private _config: LarkConfig;
  private _bus: EventBus | undefined;
  private _provider: LLMProvider | undefined;
  private _extraHandlers: EventHandler[];
  private _runsDir: string;
  private _trace: TraceWriter | undefined;
  private _permissionManager: PermissionManager | undefined;
  private _mcpManager: McpManagerLike | undefined;
  private _taskRegistry = new BackgroundTaskRegistry();
  private _signal: AbortSignal | undefined;

  constructor(
    config: LarkConfig,
    options?: {
      bus?: EventBus;
      provider?: LLMProvider;
      extraHandlers?: EventHandler[];
      runsDir?: string;
      trace?: TraceWriter;
      permissionManager?: PermissionManager;
      mcpManager?: McpManagerLike;
      signal?: AbortSignal;
    },
  ) {
    this._config = config;
    this._bus = options?.bus;
    this._provider = options?.provider;
    this._extraHandlers = options?.extraHandlers ?? [];
    this._runsDir = options?.runsDir ?? path.join("runs");
    this._trace = options?.trace;
    this._permissionManager = options?.permissionManager;
    this._mcpManager = options?.mcpManager;
    this._signal = options?.signal;
  }

  // Build tool registry
  private _buildRegistry(
    taskManager: TaskManager,
    options?: {
      session?: Session;
      store?: SessionStore;
      runId?: string;
      provider?: LLMProvider;
      bus?: EventBus;
      sessionId?: string;
      toolWhitelist?: string[] | null;
    },
  ): ToolRegistry {
    const allowed = options?.toolWhitelist
      ? new Set(options.toolWhitelist)
      : null;
    const ok = (name: string): boolean => !allowed || allowed.has(name);

    const registry = new ToolRegistry();

    // Register built-in tools (Python order: read_file, bash, write_file, list_dir)
    if (ok("read_file")) registry.register(new ReadFileTool());
    if (ok("bash")) registry.register(new BashTool());
    if (ok("write_file")) registry.register(new WriteFileTool());
    if (ok("list_dir")) registry.register(new ListDirTool());

    // Note save requires session context
    if (options?.store && options.session && options.runId && ok("note_save")) {
      registry.register(
        new NoteSaveTool(options.store, options.session.id, options.runId),
      );
    }

    // Task tools (Python order: create, update, list, get)
    if (ok("task_create")) registry.register(new TaskCreateTool(taskManager));
    if (ok("task_update")) registry.register(new TaskUpdateTool(taskManager));
    if (ok("task_list")) registry.register(new TaskListTool(taskManager));
    if (ok("task_get")) registry.register(new TaskGetTool(taskManager));

    // Subagent tools (require provider + bus + runId + sessionId)
    if (
      options?.provider &&
      options.bus &&
      options.runId &&
      options.sessionId
    ) {
      if (ok("spawn_agent")) {
        registry.register(
          new SpawnAgentTool(
            options.provider,
            options.bus,
            options.runId,
            this._permissionManager,
            this._config.agent.maxSteps,
            this._taskRegistry,
            this._runsDir,
            options.sessionId,
            0,
          ),
        );
      }
      if (ok("agent_result")) {
        registry.register(new AgentResultTool(this._taskRegistry));
      }
    }

    // MCP tools (from server manager, respects whitelist)
    if (this._mcpManager) {
      for (const mcpTool of this._mcpManager.getTools()) {
        if (ok(mcpTool.name)) {
          registry.register(mcpTool);
        }
      }
    }

    return registry;
  }

  // Execute a complete agent run
  async run(goal: string, options?: { runId?: string }): Promise<void> {
    await this.runAndCapture(goal, options);
  }

  // Execute agent run and return RunOutcome
  async runAndCapture(
    goal: string,
    options?: {
      runId?: string;
      session?: Session;
      store?: SessionStore;
      systemPromptOverride?: string | null;
      toolWhitelist?: string[] | null;
    },
  ): Promise<RunOutcome> {
    const runId = options?.runId ?? newRunId();
    let runPath: string;
    let history: Anthropic.MessageParam[];
    let notes: string;

    if (options?.session && options.store) {
      runPath = path.join(options.store.runsDir(options.session.id), runId);
      history = options.store.readMessages(options.session.id);
      notes = options.store.readNotes(options.session.id);
    } else {
      runPath = path.join(this._runsDir, runId);
      history = [{ role: "user", content: goal }];
      notes = "";
    }
    mkdirSync(runPath, { recursive: true });

    const globalCtx = loadContextFile(
      path.join(homedir(), ".lark", "context.md"),
    );
    const projectCtx = loadContextFile(path.join(".lark", "context.md"));

    const taskManager = new TaskManager(path.join(runPath, ".tasks"));

    const bus = this._bus ?? new EventBus();
    for (const h of this._extraHandlers) {
      bus.subscribe(h);
    }

    const context = new ExecutionContext({
      runId,
      goal,
      maxSteps: this._config.agent.maxSteps,
      prefillMessages: history,
      sessionNotes: notes,
      globalContext: globalCtx,
      projectContext: projectCtx,
      ...(options?.systemPromptOverride !== undefined
        ? { systemPromptOverride: options.systemPromptOverride }
        : {}),
    });
    const prefillLen = history.length;

    const eventWriter = new EventWriter(path.join(runPath, "events.jsonl"));
    eventWriter.open();
    try {
      eventWriter.subscribe(bus);
      await bus.publish({
        type: "run.started",
        run_id: runId,
        goal,
        timestamp: now(),
      });

      try {
        let provider: LLMProvider =
          this._provider ??
          new AnthropicProvider(this._config.llm.defaultModel);
        if (this._trace) {
          provider = new TracingProvider(
            provider,
            this._trace,
            this._config.trace.includeLlmPayload,
          );
        }

        const sessionIdStr = options?.session?.id ?? "";
        const registry = this._buildRegistry(taskManager, {
          ...(options?.session ? { session: options.session } : {}),
          ...(options?.store ? { store: options.store } : {}),
          runId,
          provider,
          bus,
          sessionId: sessionIdStr,
          ...(options?.toolWhitelist !== undefined
            ? { toolWhitelist: options.toolWhitelist }
            : {}),
        });

        const sessionDir =
          options?.session && options.store
            ? options.store.sessionDir(options.session.id)
            : runPath;
        const compactor = new Compactor(bus, sessionDir, sessionIdStr);

        const loop = new AgentLoop(provider, registry, bus, {
          ...(this._permissionManager
            ? { permissionManager: this._permissionManager }
            : {}),
          compactor,
          compactThreshold: this._config.compaction.autoThreshold,
          sessionId: sessionIdStr,
          ...(this._signal ? { signal: this._signal } : {}),
        });
        await loop.run(context);
      } catch {
        if (!context.isDone()) context.markFailed("cancelled");
      }

      await bus.publish({
        type: "run.finished",
        run_id: runId,
        status: context.status,
        reason: context.reason ?? null,
        steps: context.step,
        timestamp: now(),
      });
    } finally {
      eventWriter.close();
    }

    if (options?.session && options.store) {
      options.store.appendMessages(
        options.session.id,
        context.messages.slice(prefillLen),
        runId,
      );
    }

    return {
      status: context.status,
      result: context.result,
      reason: context.reason,
    };
  }
}
