// lark-core daemon entry: load config, start TCP server, register handlers, wait for shutdown signal
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import type net from "node:net";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { version } from "../index.js";
import { eventsFile } from "./runs.js";
import {
  AgentRunCommandSchema,
  AgentRunResultSchema,
  EventSubscribeCommandSchema,
  EventSubscribeResultSchema,
  PermissionRespondCommandSchema,
  PermissionRespondResultSchema,
  PongResultSchema,
  SessionCloseCommandSchema,
  SessionCloseResultSchema,
  SessionCompactCommandSchema,
  SessionCreateCommandSchema,
  SessionCreateResultSchema,
  SessionGetHistoryCommandSchema,
  SessionGetHistoryResultSchema,
  SessionSendMessageCommandSchema,
  SessionSendMessageResultSchema,
} from "./bus/commands.js";
import { getConfig } from "./config.js";
import { EventBus } from "./events/bus.js";
import { setupLogging } from "./logging.js";
import { McpServerManager } from "./mcp/server.js";
import { PermissionManager } from "./permissions/manager.js";
import { newRunId } from "./runs.js";
import { SessionManager } from "./session/manager.js";
import { SessionStore } from "./session/store.js";
import {
  getConnectionWriter,
  SocketServer,
} from "./transport/socket-server.js";
import { IpcEventBroadcaster } from "./transport/ipc-broadcaster.js";
import { TraceWriter } from "./trace/writer.js";
import { AgentRunner } from "./runner.js";
import { AnthropicProvider } from "./llm/provider.js";

function now(): string {
  return new Date().toISOString();
}

// Type guard: narrow unknown to Record<string, unknown>
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export class CoreApp {
  private _startTime = performance.now();
  private _bus = new EventBus();
  private _broadcaster: IpcEventBroadcaster | null = null;
  private _trace: TraceWriter | null = null;
  private _sessions: SessionManager | null = null;
  private _permissionManager: PermissionManager | null = null;
  private _mcpManager: McpServerManager | null = null;
  private _runningRuns = new Set<Promise<unknown>>();

  // Handle core.ping request
  private async _pingHandler(
    _params: Record<string, unknown>,
  ): Promise<unknown> {
    await Promise.resolve();
    const uptimeMs = Math.round(performance.now() - this._startTime);
    return PongResultSchema.parse({
      server_version: version,
      uptime_ms: uptimeMs,
      received_at: now(),
    });
  }

  // Write EventBus events to trace log
  private async _traceEventHandler(event: unknown): Promise<void> {
    await Promise.resolve();
    if (!this._trace) return;
    const eventObj = isRecord(event) ? event : {};
    const rawRunId = eventObj["run_id"];
    const runId = typeof rawRunId === "string" ? rawRunId : null;
    this._trace.emit({
      ts: now(),
      direction: "CORE",
      layer: "event",
      kind: "event",
      run_id: runId,
      step: null,
      client_id: null,
      data: eventObj,
    });
  }

  // agent.run handler
  private async _agentRunHandler(
    params: Record<string, unknown>,
  ): Promise<unknown> {
    if (!this._sessions) throw new Error("sessions not initialized");
    const cmd = AgentRunCommandSchema.parse(params);
    const session = await this._sessions.create(
      "one_shot",
      cmd.goal.slice(0, 40),
    );
    const rid = newRunId();
    const runPromise = this._sessions.sendMessage(session.id, cmd.goal, rid);
    this._runningRuns.add(runPromise);
    void runPromise.finally(() => this._runningRuns.delete(runPromise));
    return AgentRunResultSchema.parse({ run_id: rid });
  }

  // session.create handler
  private async _sessionCreateHandler(
    params: Record<string, unknown>,
  ): Promise<unknown> {
    if (!this._sessions) throw new Error("sessions not initialized");
    const cmd = SessionCreateCommandSchema.parse(params);
    const session = await this._sessions.create(cmd.mode, cmd.title);
    return SessionCreateResultSchema.parse({
      session_id: session.id,
      status: session.status,
    });
  }

  // session.send_message handler
  private async _sessionSendHandler(
    params: Record<string, unknown>,
  ): Promise<unknown> {
    if (!this._sessions) throw new Error("sessions not initialized");
    const cmd = SessionSendMessageCommandSchema.parse(params);
    const rid = await this._sessions.sendMessage(cmd.session_id, cmd.content);
    return SessionSendMessageResultSchema.parse({ run_id: rid });
  }

  // session.get_history handler
  private _sessionHistoryHandler(params: Record<string, unknown>): unknown {
    if (!this._sessions) throw new Error("sessions not initialized");
    const cmd = SessionGetHistoryCommandSchema.parse(params);
    const messages = this._sessions.getHistory(cmd.session_id);
    return SessionGetHistoryResultSchema.parse({ messages });
  }

  // session.close handler
  private async _sessionCloseHandler(
    params: Record<string, unknown>,
  ): Promise<unknown> {
    if (!this._sessions) throw new Error("sessions not initialized");
    const cmd = SessionCloseCommandSchema.parse(params);
    await this._sessions.close(cmd.session_id);
    return SessionCloseResultSchema.parse({ status: "closed" });
  }

  // permission.respond handler
  private async _permissionRespondHandler(
    params: Record<string, unknown>,
  ): Promise<unknown> {
    await Promise.resolve();
    const cmd = PermissionRespondCommandSchema.parse(params);
    if (this._permissionManager) {
      this._permissionManager.respond(cmd.tool_use_id, cmd.decision);
    }
    return PermissionRespondResultSchema.parse({ ok: true });
  }

  // session.compact handler
  private async _sessionCompactHandler(
    params: Record<string, unknown>,
  ): Promise<unknown> {
    if (!this._sessions) throw new Error("sessions not initialized");
    const cmd = SessionCompactCommandSchema.parse(params);
    const result = await this._sessions.compact(cmd.session_id, cmd.focus);
    return {
      summary_tokens: result.summaryTokens,
      saved_tokens: result.savedTokens,
    };
  }

  // event.subscribe handler
  // Replay matching events from events.jsonl then subscribe to live stream
  private async _subscribeHandler(
    params: Record<string, unknown>,
  ): Promise<unknown> {
    await Promise.resolve();
    const cmd = EventSubscribeCommandSchema.parse(params);
    const writer = getConnectionWriter();
    if (!this._broadcaster) throw new Error("broadcaster not initialized");

    let replayedCount = 0;
    if (cmd.replay_from_run !== null) {
      replayedCount = await this._replayEvents(
        cmd.replay_from_run,
        writer,
        cmd.topics,
      );
    }

    const subId = this._broadcaster.subscribe(writer, cmd.topics, cmd.scope);
    return EventSubscribeResultSchema.parse({
      subscription_id: subId,
      replayed_count: replayedCount,
    });
  }

  // Replay matching events from events.jsonl history file
  private async _replayEvents(
    runId: string,
    socket: net.Socket,
    topics: string[],
  ): Promise<number> {
    let eventsPath = eventsFilePath(runId);

    // Fallback: search under ~/.lark/sessions/*/runs/{runId}/events.jsonl
    if (!existsSync(eventsPath)) {
      const sessionsDir = path.join(homedir(), ".lark", "sessions");
      if (existsSync(sessionsDir)) {
        try {
          const sessionIds = readdirSync(sessionsDir);
          for (const sessionId of sessionIds) {
            const candidate = path.join(
              sessionsDir,
              sessionId,
              "runs",
              runId,
              "events.jsonl",
            );
            if (existsSync(candidate)) {
              eventsPath = candidate;
              break;
            }
          }
        } catch {
          // Ignore errors reading sessions directory
        }
      }
    }

    if (!existsSync(eventsPath)) return 0;

    try {
      const content = readFileSync(eventsPath, "utf-8");
      const lines = content.split("\n");
      let count = 0;
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed: unknown = JSON.parse(line);
          if (!isRecord(parsed)) continue;
          const event = parsed;
          const eventType =
            typeof event["type"] === "string" ? event["type"] : "";
          if (!matchTopic(eventType, topics)) continue;
          const envelope =
            JSON.stringify({
              kind: "event",
              event,
            }) + "\n";
          socket.write(envelope);
          count++;
        } catch {
          // Skip malformed JSON lines
        }
      }
      if (count > 0) {
        await new Promise<void>((resolve) => socket.once("drain", resolve));
      }
      return count;
    } catch {
      return 0;
    }
  }

  // Start the daemon
  async run(): Promise<void> {
    this._startTime = performance.now();
    const config = getConfig();
    const logger = setupLogging(config);

    // Trace
    if (config.trace.enabled) {
      const tracePath = config.trace.file.replace(/^~/, homedir());
      this._trace = new TraceWriter(tracePath);
      this._trace.start();
      this._bus.subscribe((e) => this._traceEventHandler(e));
    }

    // Permission
    const policyPath = path.join(homedir(), ".lark", "policy.toml");
    this._permissionManager = new PermissionManager({
      policyFile: policyPath,
      timeoutS: config.permission.timeoutS,
    });

    // Broadcaster
    this._broadcaster = new IpcEventBroadcaster();
    this._bus.subscribe(async (e) => {
      if (this._broadcaster) {
        await this._broadcaster.handle(e);
      }
    });

    // Session
    const sessionsRoot = path.join(homedir(), ".lark", "sessions");
    const store = new SessionStore(sessionsRoot);

    // LLM provider for compaction
    const provider = new AnthropicProvider(config.llm.defaultModel);

    // MCP
    this._mcpManager = new McpServerManager();
    if (config.mcp.servers.length > 0) {
      void this._mcpManager.startAll(config.mcp.servers);
    }

    this._sessions = new SessionManager(
      store,
      () =>
        new AgentRunner(config, {
          bus: this._bus,
          ...(this._trace ? { trace: this._trace } : {}),
          ...(this._permissionManager
            ? { permissionManager: this._permissionManager }
            : {}),
          ...(this._mcpManager ? { mcpManager: this._mcpManager } : {}),
        }),
      this._bus,
      provider,
    );

    // Server
    const server = new SocketServer(config.host, config.port);
    server.register("core.ping", (p) => this._pingHandler(p));
    server.register("agent.run", (p) => this._agentRunHandler(p));
    server.register("event.subscribe", (p) => this._subscribeHandler(p));
    server.register("session.create", (p) => this._sessionCreateHandler(p));
    server.register("session.send_message", (p) => this._sessionSendHandler(p));
    server.register("session.get_history", (p) =>
      Promise.resolve(this._sessionHistoryHandler(p)),
    );
    server.register("session.close", (p) => this._sessionCloseHandler(p));
    server.register("permission.respond", (p) =>
      this._permissionRespondHandler(p),
    );
    server.register("session.compact", (p) => this._sessionCompactHandler(p));

    const addr = await server.start();
    logger.info(`lark-core ${version} listening addr=${addr}`);

    // Wait for SIGINT/SIGTERM
    let shutdownResolve: (() => void) | undefined;
    const shutdownPromise = new Promise<void>((resolve) => {
      shutdownResolve = resolve;
    });
    const onSignal = (): void => {
      shutdownResolve?.();
    };
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);

    await shutdownPromise;

    logger.info("shutting down");
    await this._mcpManager.stopAll();
    await server.stop();
    if (this._trace) await this._trace.stop();

    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  }
}

// Return the full path to the events.jsonl file for a given run ID
// Resolves relative paths against the lark working directory
function eventsFilePath(runId: string): string {
  const rel = eventsFile(runId);
  return path.resolve(rel);
}

// Check whether an event type matches any of the subscribed topic patterns
// Supports wildcard suffix: "run.*" matches "run.started", "run.finished", etc.
function matchTopic(eventType: string, topics: string[]): boolean {
  for (const topic of topics) {
    if (topic.endsWith("*")) {
      const prefix = topic.slice(0, -1);
      if (eventType.startsWith(prefix)) return true;
    } else {
      if (eventType === topic) return true;
    }
  }
  return false;
}

// Daemon entry point
async function main(): Promise<void> {
  await new CoreApp().run();
}

const isDirectRun =
  process.argv[1].endsWith("/app.ts") || process.argv[1].endsWith("/app.js");

if (isDirectRun) {
  void main();
}
