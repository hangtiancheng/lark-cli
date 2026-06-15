// Subagent tools: spawn isolated child agents and query their results
import { z } from "zod";

import type { AgentProfile } from "../agents/loader.js";
import { AgentProfileLoader } from "../agents/loader.js";
import { EventBus } from "../events/bus.js";
import type { LLMProvider } from "../llm/base.js";
import { AgentLoop } from "../loop.js";
import type { PermissionManager } from "../permissions/manager.js";
import { newRunId } from "../runs.js";
import type { BaseTool, ToolResult } from "../tools/base.js";
import { BashTool } from "../tools/builtin/bash.js";
import { ListDirTool } from "../tools/builtin/list-dir.js";
import { ReadFileTool } from "../tools/builtin/read-file.js";
import { TaskCreateTool } from "../tools/builtin/task-create.js";
import { TaskGetTool } from "../tools/builtin/task-get.js";
import { TaskListTool } from "../tools/builtin/task-list.js";
import { TaskUpdateTool } from "../tools/builtin/task-update.js";
import { WriteFileTool } from "../tools/builtin/write-file.js";
import { ToolRegistry } from "../tools/registry.js";
import { TaskManager } from "../task/manager.js";
import { ExecutionContext } from "../context.js";
import { EventWriter } from "../events/writer.js";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { BackgroundTaskRegistry } from "./registry.js";

const profileLoader = new AgentProfileLoader();

const SpawnAgentParamsSchema = z.object({
  description: z.string(),
  prompt: z.string(),
  run_in_background: z.boolean().default(false),
  subagent_type: z.string().default(""),
});

export class SpawnAgentTool implements BaseTool {
  readonly name = "spawn_agent";
  readonly description =
    "Spawn an isolated sub-agent to handle a self-contained sub-task. " +
    "The sub-agent starts with a clean context containing only the provided prompt — " +
    "it does not inherit the current conversation history. " +
    "Use run_in_background=true to run in parallel; retrieve result later with agent_result.";
  readonly inputSchema = {
    type: "object",
    properties: {
      description: {
        type: "string",
        description: "3-5 word task description shown in progress display",
      },
      prompt: {
        type: "string",
        description:
          "Complete task description including all context the sub-agent needs. " +
          "The sub-agent cannot see the parent conversation, so be explicit.",
      },
      run_in_background: {
        type: "boolean",
        description: "When true, returns immediately with a run_id; use agent_result to poll.",
      },
      subagent_type: {
        type: "string",
        description: "Agent role profile (planner/executor/reviewer). Leave empty for default.",
      },
    },
    required: ["description", "prompt"],
  };
  readonly paramsModel = SpawnAgentParamsSchema;

  private _provider: LLMProvider;
  private _parentBus: EventBus;
  private _parentRunId: string;
  private _permissionManager: PermissionManager | undefined;
  private _maxSteps: number;
  private _taskRegistry: BackgroundTaskRegistry;
  private _runsDir: string;
  private _sessionId: string;
  private _depth: number;

  constructor(
    provider: LLMProvider,
    parentBus: EventBus,
    parentRunId: string,
    permissionManager: PermissionManager | undefined,
    maxSteps: number,
    taskRegistry: BackgroundTaskRegistry,
    runsDir: string,
    sessionId: string,
    depth = 0,
  ) {
    this._provider = provider;
    this._parentBus = parentBus;
    this._parentRunId = parentRunId;
    this._permissionManager = permissionManager;
    this._maxSteps = maxSteps;
    this._taskRegistry = taskRegistry;
    this._runsDir = runsDir;
    this._sessionId = sessionId;
    this._depth = depth;
  }

  async invoke(params: Record<string, unknown>): Promise<ToolResult> {
    const p = SpawnAgentParamsSchema.parse(params);

    if (this._depth >= 2) {
      return {
        content: "Subagent nesting limit (2) reached; cannot spawn further subagents.",
        isError: true,
        errorType: "runtime_error",
      };
    }

    const profile = p.subagent_type ? profileLoader.load(p.subagent_type) : null;

    const childRunId = newRunId();
    const childContext = new ExecutionContext({
      runId: childRunId,
      goal: p.prompt,
      maxSteps: this._maxSteps,
      systemPromptOverride: profile?.systemPrompt ?? null,
    });

    const childBus = new EventBus();

    // Bridge all child events to parent bus
    childBus.subscribe(async (event) => {
      await this._parentBus.publish(event);
    });

    const childRegistry = this._buildChildRegistry(childBus, childRunId, profile);
    const childLoop = new AgentLoop(this._provider, childRegistry, childBus, {
      ...(this._permissionManager ? { permissionManager: this._permissionManager } : {}),
      sessionId: this._sessionId,
    });

    await this._parentBus.publish({
      type: "subagent.started",
      run_id: childRunId,
      parent_run_id: this._parentRunId,
      description: p.description,
      timestamp: new Date().toISOString(),
    });

    const childRunPath = path.join(this._runsDir, childRunId);
    mkdirSync(childRunPath, { recursive: true });

    if (p.run_in_background) {
      const promise = this._runBackground(
        childLoop,
        childContext,
        childBus,
        childRunPath,
        childRunId,
      );
      this._taskRegistry.register(childRunId, promise, childContext);
      return {
        content: `Subagent started in background. run_id=${childRunId}. Use agent_result(run_id='${childRunId}') to retrieve result.`,
        isError: false,
        errorType: null,
      };
    }

    // Foreground execution
    const eventWriter = new EventWriter(path.join(childRunPath, "events.jsonl"));
    eventWriter.open();
    eventWriter.subscribe(childBus);
    try {
      await childLoop.run(childContext);
    } finally {
      eventWriter.close();
    }

    await this._parentBus.publish({
      type: "subagent.finished",
      run_id: childRunId,
      parent_run_id: this._parentRunId,
      status: childContext.status,
      timestamp: new Date().toISOString(),
    });

    if (childContext.status === "success") {
      return {
        content: childContext.result || "Subagent completed with no text output.",
        isError: false,
        errorType: null,
      };
    }
    return {
      content:
        childContext.result ||
        `Subagent failed (status=${childContext.status}, reason=${childContext.reason ?? "unknown"})`,
      isError: true,
      errorType: "runtime_error",
    };
  }

  private async _runBackground(
    loop: AgentLoop,
    context: ExecutionContext,
    bus: EventBus,
    runPath: string,
    runId: string,
  ): Promise<void> {
    const eventWriter = new EventWriter(path.join(runPath, "events.jsonl"));
    eventWriter.open();
    eventWriter.subscribe(bus);
    try {
      await loop.run(context);
    } finally {
      eventWriter.close();
    }
    await this._parentBus.publish({
      type: "subagent.finished",
      run_id: runId,
      parent_run_id: this._parentRunId,
      status: context.status,
      timestamp: new Date().toISOString(),
    });
  }

  private _buildChildRegistry(
    childBus: EventBus,
    childRunId: string,
    profile: AgentProfile | null,
  ): ToolRegistry {
    const allowed = profile?.allowedTools.length ? new Set(profile.allowedTools) : null;
    const isAllowed = (name: string): boolean => !allowed || allowed.has(name);

    const registry = new ToolRegistry();
    const allTools = [new ReadFileTool(), new BashTool(), new WriteFileTool(), new ListDirTool()];
    for (const t of allTools) {
      if (isAllowed(t.name)) {
        registry.register(t);
      }
    }

    const childTaskManager = new TaskManager(path.join(this._runsDir, childRunId, ".tasks"));
    const taskTools = [
      new TaskCreateTool(childTaskManager),
      new TaskUpdateTool(childTaskManager),
      new TaskListTool(childTaskManager),
      new TaskGetTool(childTaskManager),
    ];
    for (const t of taskTools) {
      if (isAllowed(t.name)) {
        registry.register(t);
      }
    }

    if (this._depth < 1) {
      const nested = new SpawnAgentTool(
        this._provider,
        childBus,
        childRunId,
        this._permissionManager,
        this._maxSteps,
        this._taskRegistry,
        this._runsDir,
        this._sessionId,
        this._depth + 1,
      );
      if (isAllowed("spawn_agent")) {
        registry.register(nested);
      }
      if (isAllowed("agent_result")) {
        registry.register(new AgentResultTool(this._taskRegistry));
      }
    }

    return registry;
  }
}

const AgentResultParamsSchema = z.object({
  run_id: z.string(),
});

export class AgentResultTool implements BaseTool {
  readonly name = "agent_result";
  readonly description =
    "Retrieve the result of a background sub-agent previously started with spawn_agent. " +
    "Returns 'still running' if the sub-agent has not yet completed.";
  readonly inputSchema = {
    type: "object",
    properties: {
      run_id: {
        type: "string",
        description: "The run_id returned by spawn_agent(run_in_background=true)",
      },
    },
    required: ["run_id"],
  };
  readonly paramsModel = AgentResultParamsSchema;

  private _taskRegistry: BackgroundTaskRegistry;

  constructor(taskRegistry: BackgroundTaskRegistry) {
    this._taskRegistry = taskRegistry;
  }

  async invoke(params: Record<string, unknown>): Promise<ToolResult> {
    const p = AgentResultParamsSchema.parse(params);
    const entry = this._taskRegistry.get(p.run_id);
    if (!entry) {
      return {
        content: `Unknown run_id: ${p.run_id}. Only background subagents can be queried.`,
        isError: true,
        errorType: "runtime_error",
      };
    }

    const { promise, context } = entry;

    // Check if promise is still pending
    let hasError = false;
    let errorMsg = "";

    try {
      // Race with immediate resolution to check status
      await Promise.race([
        promise,
        Promise.resolve().then(() => {
          throw new Error("still_pending");
        }),
      ]);
    } catch (error) {
      if (error instanceof Error && error.message === "still_pending") {
        // Still running
        return {
          content: "still running",
          isError: false,
          errorType: null,
        };
      }
      hasError = true;
      errorMsg = error instanceof Error ? error.message : String(error);
    }

    if (hasError) {
      return {
        content: `Subagent raised an exception: ${errorMsg}`,
        isError: true,
        errorType: "runtime_error",
      };
    }

    return {
      content: context.result || "Subagent completed with no text result.",
      isError: false,
      errorType: null,
    };
  }
}
