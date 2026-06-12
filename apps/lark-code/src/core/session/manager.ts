// SessionManager: session creation, message routing, lifecycle management
import { randomUUID } from "node:crypto";

import type Anthropic from "@anthropic-ai/sdk";

import { HandlerError } from "../bus/envelope.js";
import type { EventBus } from "../events/bus.js";
import type { LLMProvider } from "../llm/base.js";
import { newRunId } from "../runs.js";
import { SkillLoader } from "../skills/loader.js";
import { Compactor } from "../compact/compactor.js";
import type { Session, SessionMode } from "./model.js";
import { createSession } from "./model.js";
import type { SessionStore } from "./store.js";

const SESSION_NOT_FOUND = -32010;
const SESSION_CLOSED = -32011;
const SESSION_BUSY = -32012;
const PROVIDER_NOT_AVAILABLE = -32020;
const COMPACTION_FAILED = -32021;

function now(): string {
  return new Date().toISOString();
}

// AgentRunner interface (avoids circular dependency)
interface AgentRunnerLike {
  runAndCapture(
    goal: string,
    options?: {
      runId?: string;
      session?: Session;
      store?: SessionStore;
      systemPromptOverride?: string | null;
      toolWhitelist?: string[] | null;
    },
  ): Promise<{ status: string; result: string; reason: string | null }>;
}

export interface SessionCompactResult {
  summaryTokens: number;
  savedTokens: number;
}

export class SessionManager {
  private _store: SessionStore;
  private _runnerFactory: () => AgentRunnerLike;
  private _bus: EventBus;
  private _provider: LLMProvider | undefined;
  private _sessions = new Map<string, Session>();
  private _locks = new Map<string, boolean>();
  private _skillLoader = new SkillLoader();

  constructor(
    store: SessionStore,
    runnerFactory: () => AgentRunnerLike,
    bus: EventBus,
    provider?: LLMProvider,
  ) {
    this._store = store;
    this._runnerFactory = runnerFactory;
    this._bus = bus;
    this._provider = provider;
  }

  // Create a new session and write meta.json
  async create(mode: SessionMode, title = ""): Promise<Session> {
    const sid = `session-${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const session = createSession(sid, mode, title);
    this._sessions.set(sid, session);
    this._locks.set(sid, false);
    this._store.writeMeta(session);
    await this._bus.publish({
      type: "session.created",
      session_id: sid,
      mode,
      timestamp: now(),
    });
    return session;
  }

  // Handle user message, append to thread and start an agent run
  async sendMessage(
    sid: string,
    content: string,
    runId?: string,
  ): Promise<string> {
    const session = this._getSession(sid);
    if (this._locks.get(sid)) {
      throw new HandlerError(SESSION_BUSY, "session busy");
    }

    this._locks.set(sid, true);
    try {
      if (session.status === "closed") {
        throw new HandlerError(SESSION_CLOSED, "session already closed");
      }

      if (session.status === "waiting_for_input") {
        await this._bus.publish({
          type: "session.resumed",
          session_id: sid,
          timestamp: now(),
        });
      }

      this._store.appendMessage(sid, "user", content);
      await this._bus.publish({
        type: "session.message_received",
        session_id: sid,
        content,
        timestamp: now(),
      });

      if (!session.title) session.title = content.slice(0, 40);

      const resolvedRunId = runId ?? newRunId();
      session.runIds.push(resolvedRunId);
      session.updatedAt = now();
      this._store.writeMeta(session);

      // Skill resolution
      let goal = content;
      let systemPromptOverride: string | null = null;
      let toolWhitelist: string[] | null = null;

      if (content.startsWith("/")) {
        const parts = content.slice(1).split(/\s+/);
        const skillName = parts[0] ?? "";
        const arguments_ = parts.slice(1).join(" ");
        const skill = this._skillLoader.resolve(skillName);
        if (skill) {
          goal = this._skillLoader.renderPrompt(skill, arguments_);
          systemPromptOverride = skill.systemPromptTemplate;
          toolWhitelist =
            skill.allowedTools.length > 0 ? skill.allowedTools : null;
          await this._bus.publish({
            type: "skill.invoked",
            skill_name: skillName,
            arguments: arguments_,
            run_id: resolvedRunId,
            timestamp: now(),
          });
        }
      }

      const runner = this._runnerFactory();
      await runner.runAndCapture(goal, {
        runId: resolvedRunId,
        session,
        store: this._store,
        systemPromptOverride,
        toolWhitelist,
      });

      session.updatedAt = now();
      if (session.mode === "one_shot") {
        session.status = "closed";
        await this._bus.publish({
          type: "session.closed",
          session_id: sid,
          timestamp: session.updatedAt,
        });
      } else {
        session.status = "waiting_for_input";
        await this._bus.publish({
          type: "session.waiting_for_input",
          session_id: sid,
          last_run_id: resolvedRunId,
          timestamp: session.updatedAt,
        });
      }
      this._store.writeMeta(session);
      return resolvedRunId;
    } finally {
      this._locks.set(sid, false);
    }
  }

  // Close the specified session
  async close(sid: string): Promise<void> {
    const session = this._getSession(sid);
    if (this._locks.get(sid)) {
      throw new HandlerError(SESSION_BUSY, "session busy");
    }
    session.status = "closed";
    session.updatedAt = now();
    this._store.writeMeta(session);
    await this._bus.publish({
      type: "session.closed",
      session_id: sid,
      timestamp: session.updatedAt,
    });
  }

  // Manually compact the session thread, persisting the summary into thread.jsonl
  async compact(sid: string, focus = ""): Promise<SessionCompactResult> {
    this._getSession(sid);
    if (this._locks.get(sid)) {
      throw new HandlerError(SESSION_BUSY, "session busy");
    }
    if (!this._provider) {
      throw new HandlerError(
        PROVIDER_NOT_AVAILABLE,
        "provider not available for compaction",
      );
    }

    this._locks.set(sid, true);
    try {
      const messages = this._store.readMessages(sid);
      const sessionDir = this._store.sessionDir(sid);
      const compactor = new Compactor(this._bus, sessionDir, sid);
      const result = await compactor.compactMessages(
        messages,
        this._provider,
        focus,
      );

      if (!result) {
        throw new HandlerError(
          COMPACTION_FAILED,
          "compaction failed or not beneficial",
        );
      }

      this._store.writeCompacted(sid, [
        { role: "user", content: result.summaryText },
        {
          role: "assistant",
          content: "Understood, I'll continue from this summary.",
        },
      ]);

      await Promise.resolve();

      return {
        summaryTokens: result.summaryTokens,
        savedTokens: Math.max(
          0,
          result.originalTokenEstimate - result.summaryTokens,
        ),
      };
    } finally {
      this._locks.set(sid, false);
    }
  }

  // Read the full thread history for a session
  getHistory(sid: string): Anthropic.MessageParam[] {
    this._getSession(sid);
    return this._store.readMessages(sid);
  }

  // Retrieve session from in-memory index; throw JSON-RPC error if not found
  private _getSession(sid: string): Session {
    const session = this._sessions.get(sid);
    if (!session)
      throw new HandlerError(SESSION_NOT_FOUND, "session not found");
    return session;
  }
}
