// PermissionManager: policy evaluation, user approval gating, caching, and timeout
import {
  DEFAULT_POLICIES,
  type PermissionDecision,
  type ToolPolicy,
  evaluate,
  matchesOutsideCwd,
  paramPreview,
} from "./policy.js";
import { loadPolicyFile, savePolicyFile } from "./storage.js";

interface PendingRequest {
  resolve: (decision: string) => void;
  sessionId: string;
  toolName: string;
}

// Timeout utility for promises
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("timeout"));
    }, ms);
    promise
      .then((v) => {
        clearTimeout(timer);
        resolve(v);
      })
      .catch((e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      });
  });
}

// Manage tool call permissions: policy evaluation, user approval gating, session-level and persistent always-cache, timeout
export class PermissionManager {
  private _policies: Record<string, ToolPolicy>;
  private _pending = new Map<string, PendingRequest>();
  // (session_id, tool_name) → "allow" | "deny"
  private _sessionAlways = new Map<string, string>();
  private _policyFile: string | undefined;
  private _persistentAlways: Record<string, string>;
  private _timeoutS: number;

  constructor(options?: {
    policies?: Record<string, ToolPolicy>;
    policyFile?: string;
    timeoutS?: number;
  }) {
    this._policies = options?.policies ?? { ...DEFAULT_POLICIES };
    this._policyFile = options?.policyFile;
    this._persistentAlways = this._policyFile ? loadPolicyFile(this._policyFile) : {};
    this._timeoutS = options?.timeoutS ?? 60.0;
  }

  // Evaluate tool name + params through 4-tier static policy; does not suspend
  evaluate(toolName: string, params: Record<string, unknown>): PermissionDecision {
    const policy = this._policies[toolName];
    return evaluate(toolName, params, policy);
  }

  // Check permissions; emit ask event to client and await response if needed; returns [allowed, decision_str]
  async checkAndWait(
    toolUseId: string,
    toolName: string,
    params: Record<string, unknown>,
    sessionId: string,
    eventEmitter: (event: Record<string, unknown>) => Promise<void>,
  ): Promise<[boolean, string]> {
    const commandRaw = params["command"];
    const command = toolName === "bash" && typeof commandRaw === "string" ? commandRaw : "";
    const hasPolicy = toolName in this._policies;
    const policy = this._policies[toolName];

    // Tier 1: deny_patterns (only if policy exists)
    if (command && hasPolicy) {
      for (const pat of policy.denyPatterns) {
        if (new RegExp(pat).test(command)) {
          return [false, "auto_deny"];
        }
      }
    }

    // Tier 2: OUTSIDE_CWD_HEURISTICS
    const outsideCwd = Boolean(command && matchesOutsideCwd(command));

    if (!outsideCwd) {
      // Tier 3: session-level always cache
      const sessionKey = `${sessionId}:${toolName}`;
      const sessionCached = this._sessionAlways.get(sessionKey);
      if (sessionCached !== undefined) {
        return [sessionCached === "allow", `auto_${sessionCached}`];
      }

      // Tier 4: persistent always
      if (toolName in this._persistentAlways) {
        const cached = this._persistentAlways[toolName];
        return [cached === "allow", `auto_${cached}`];
      }

      // Tier 5: allow_patterns (only if policy exists)
      if (command && hasPolicy) {
        for (const pat of policy.allowPatterns) {
          if (new RegExp(pat).test(command)) {
            return [true, "auto_allow"];
          }
        }
      }

      // Tier 6: tool default (only if policy exists)
      if (hasPolicy) {
        if (policy.default === "allow") return [true, "auto_allow"];
        if (policy.default === "deny") return [false, "auto_deny"];
      }
    }

    // ASK path
    const { promise, resolve } = Promise.withResolvers<string>();
    this._pending.set(toolUseId, { resolve, sessionId, toolName });

    await eventEmitter({
      type: "permission.requested",
      tool_use_id: toolUseId,
      tool_name: toolName,
      params,
      params_preview: paramPreview(toolName, params),
      session_id: sessionId,
      timestamp: new Date().toISOString(),
    });

    let raw: string;
    try {
      if (this._timeoutS > 0) {
        raw = await withTimeout(promise, this._timeoutS * 1000);
      } else {
        raw = await promise;
      }
    } catch {
      this._pending.delete(toolUseId);
      return [false, "timeout"];
    }

    const allowed = this._applyResponse(raw, sessionId, toolName);
    return [allowed, raw];
  }

  // Handle client approval decision and resolve the pending promise
  respond(toolUseId: string, decision: string): void {
    const req = this._pending.get(toolUseId);
    if (!req) return;
    this._pending.delete(toolUseId);
    req.resolve(decision);
  }

  // Apply approval decision and update caches
  private _applyResponse(decision: string, sessionId: string, toolName: string): boolean {
    const allow = decision === "allow_once" || decision === "always_allow";

    if (decision === "always_allow") {
      this._sessionAlways.set(`${sessionId}:${toolName}`, "allow");
      this._persistentAlways[toolName] = "allow";
      if (this._policyFile) {
        try {
          savePolicyFile(this._persistentAlways, this._policyFile);
        } catch {
          // Persistence failure is non-blocking
        }
      }
    } else if (decision === "always_deny") {
      this._sessionAlways.set(`${sessionId}:${toolName}`, "deny");
      this._persistentAlways[toolName] = "deny";
      if (this._policyFile) {
        try {
          savePolicyFile(this._persistentAlways, this._policyFile);
        } catch {
          // Persistence failure is non-blocking
        }
      }
    }
    return allow;
  }

  // Reject all pending requests for a session when the client disconnects
  cancelSession(sessionId: string, _reason = "client_disconnected"): void {
    for (const [uid, req] of this._pending) {
      if (req.sessionId === sessionId) {
        this._pending.delete(uid);
        req.resolve("deny_once");
      }
    }
  }
}
