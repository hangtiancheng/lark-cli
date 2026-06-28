import type { LLMClient } from "../llm/client.js";
import type {
  ConversationManager,
  ToolUseBlock,
  ToolResultBlock,
} from "../conversation/conversation.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { PermissionChecker, Decision } from "../permissions/checker.js";
import type { HookEngine, EventName } from "../hooks/hooks.js";
import type { FileHistory } from "../file-history/file-history.js";
import type { FileStateCache } from "../tools/file-state-cache.js";
import type { AgentEvent } from "./events.js";
import { StreamingExecutor } from "./streaming-executor.js";
import { manageContext, forceCompact, AutoCompactTrackingState } from "../compact/compact.js";
import { getSessionFilePath } from "../session/session.js";
import type { UsageAnchor } from "../compact/compact.js";
import { RecoveryState } from "../compact/recovery.js";
import { ContextTooLongError, RateLimitError } from "../llm/errors.js";
import { getOrCreatePlanPath, planExists } from "../plan-file/plan-file.js";
import { buildPlanModeReminder } from "../prompt/plan-mode.js";
import { applyBudget } from "../tool-result/budget.js";
import { buildManager } from "../tool-result/reconstruct.js";
import { ContentReplacementState } from "../tool-result/state.js";
import { readFile } from "node:fs/promises";
import { type ToolSchema } from "@/tools/types.js";
import { strArg, asError } from "@/utils/index.js";
import type Anthropic from "@anthropic-ai/sdk";

// When the model stops on max_tokens, escalate its output ceiling once to this
// value, then attempt a bounded number of multi-turn recoveries.
const MAX_TOKENS_CEILING = 64000;
const MAX_OUTPUT_TOKENS_RECOVERIES = 3;
// Hard per-result cap on tool output stored back into the conversation. The tool result budget handles spilling separately; this is a final safety cap.
const MAX_OUTPUT_CHARS = 10000;

export interface AgentConfig {
  /** LLM client */
  client: LLMClient;
  /** Tool registry */
  registry: ToolRegistry;
  /**  */
  checker: PermissionChecker;
  conversation: ConversationManager;
  workDir: string;
  sessionId?: string;
  hookEngine?: HookEngine;
  fileHistory?: FileHistory;
  fileStateCache?: FileStateCache;
  abortSignal?: AbortSignal;
  contextWindow?: number;
  maxOutput?: number;
  recoveryState?: RecoveryState;
  replacementState?: ContentReplacementState;
  maxIterations?: number;
  notificationFn?: () => string[];
  onLoopComplete?: (conversation: ConversationManager) => void;
  activeSkills?: Map<string, string>;
  toolFilter?: (name: string) => boolean;
  onPermissionRequest?: (
    toolName: string,
    args: Record<string, unknown>,
    decision: Decision,
  ) => Promise<"allow" | "deny" | "allowAlways">;
}

export class Agent {
  private client: LLMClient;
  private registry: ToolRegistry;
  private checker: PermissionChecker;
  private conversation: ConversationManager;
  private workDir: string;
  private sessionFilePath: string;
  private hookEngine?: HookEngine | undefined;
  private fileHistory?: FileHistory | undefined;
  private fileStateCache?: FileStateCache | undefined;
  private abortSignal?: AbortSignal | undefined;
  private contextWindow: number;
  private maxOutput: number;
  private recoveryState: RecoveryState;
  private replacementState: ContentReplacementState;
  private maxIterations: number;
  private notificationFn?: (() => string[]) | undefined;
  private onLoopComplete?: ((conversation: ConversationManager) => void) | undefined;
  private compactTracking = new AutoCompactTrackingState();

  // Real-token anchor from the last stream's API usage. null until the first
  // turn completes, so the very first manageContext() call falls back to
  // whole-transcript char estimation (cold start). Mirrors python
  // conversation.last_input_tokens, extended with cache tokens + an increment.
  private usageAnchor: UsageAnchor | null = null;
  private onPermissionRequest?: AgentConfig["onPermissionRequest"];
  private toolFilter?: ((name: string) => boolean) | undefined;
  activeSkills: Map<string, string>;

  constructor(config: AgentConfig) {
    this.client = config.client;
    this.registry = config.registry;
    this.checker = config.checker;
    this.conversation = config.conversation;
    this.workDir = config.workDir;
    this.sessionFilePath = config.sessionId
      ? getSessionFilePath(config.workDir, config.sessionId)
      : "";
    this.hookEngine = config.hookEngine;
    this.fileHistory = config.fileHistory;
    this.fileStateCache = config.fileStateCache;
    this.abortSignal = config.abortSignal;
    this.contextWindow = config.contextWindow ?? 200000;
    this.maxOutput = config.maxOutput ?? 8192;
    this.recoveryState = config.recoveryState ?? new RecoveryState();
    this.replacementState = config.replacementState ?? new ContentReplacementState();
    this.maxIterations = config.maxIterations ?? 0;
    this.notificationFn = config.notificationFn;
    this.onLoopComplete = config.onLoopComplete;
    this.onPermissionRequest = config.onPermissionRequest;
    this.activeSkills = config.activeSkills ?? new Map<string, string>();
    this.toolFilter = config.toolFilter;
  }

  async *run(): AsyncGenerator<AgentEvent> {
    // Apply an active skill's allowed-tools filter to the schemas sent to the
    // LLM. System tools always remain available.
    let toolSchemas: Anthropic.Tool[] = this.registry.getAllSchemas();
    if (this.toolFilter) {
      toolSchemas = toolSchemas.filter((s) => {
        const n = s.name;
        return this.registry.get(n)?.system === true || this.toolFilter?.(n);
      });
    }
    const toolSchemaNames = this.registry.listTools().map((t) => t.name);

    let maxTokensEscalated = false;
    let outputRecoveries = 0;
    let consecutiveUnknown = 0;
    let iteration = 0;

    await this.fireLifecycle("session_start");
    try {
      let looping = true;
      while (looping) {
        iteration++;
        if (this.maxIterations > 0 && iteration > this.maxIterations) {
          yield {
            type: "error",
            error: new Error(`Agent reached maximum iterations (${String(this.maxIterations)})`),
          };
          return;
        }

        let fullText = "";
        const thinkingBlocks: { thinking: string; signature: string }[] = [];
        const toolUses: ToolUseBlock[] = [];
        let stopReason = "end_turn";

        // Two-layer context management: auto-compact when the window fills up.
        const mc = await manageContext(
          this.conversation,
          this.client,
          this.contextWindow,
          this.maxOutput,
          this.compactTracking,
          this.recoveryState,
          toolSchemaNames,
          this.usageAnchor,
          this.sessionFilePath,
        );
        if (mc.message) {
          yield {
            type: "compact",
            message: mc.message,
            boundary: mc.boundary,
          };
        }
        // Compaction rewrote the transcript (summary + verbatim tail), so the
        // usage anchor's (baselineTokens, anchorCount) no longer line up with the
        // new message list — its message count is stale and the baseline counted
        // tokens that were just summarized away. Drop the anchor so the next
        // currentContextTokens() cold-starts on the compacted transcript instead
        // of adding a stale baseline to a misaligned tail.
        if (mc.compacted) {
          this.usageAnchor = null;
        }

        // Plan mode: sync the plan path onto the checker (so the Layer-0 plan-file
        // write exception works however plan mode was entered) and inject a
        // per-turn reminder keeping the model read-only.
        if (this.checker.mode === "plan") {
          const planPath = getOrCreatePlanPath(this.workDir);
          this.checker.planFilePath = planPath;
          this.conversation.addSystemReminder(
            buildPlanModeReminder(planPath, planExists(this.workDir), iteration),
          );
        }

        // Re-inject pinned active-skill SOPs each turn so the model sees them at
        // the most prominent position regardless of conversation length.
        const skillReminder = buildActiveSkillsReminder(this.activeSkills);
        if (skillReminder) {
          this.conversation.addSystemReminder(skillReminder);
        }

        // Drain queued hook notifications and any external notifications (e.g. a
        // team mailbox) into system reminders for this turn.
        if (this.hookEngine) {
          for (const note of this.hookEngine.drainNotifications()) {
            this.conversation.addSystemReminder(note);
          }
        }
        if (this.notificationFn) {
          for (const note of this.notificationFn()) {
            this.conversation.addSystemReminder(note);
          }
        }

        await this.fireLifecycle("turn_start");
        await this.fireLifecycle("pre_send");

        // Layer 1: apply the tool-result budget against the ReplacementState so
        // large/old tool outputs are spilled or snipped before resend. Builds a
        // fresh apiConversation with replacements baked in; this.conversation is never mutated.
        const apiConversation = buildManager(
          applyBudget(this.conversation.getMessages(), this.workDir, this.replacementState),
        );

        // Message count of the live conversation at the moment we send. The API
        // usage we receive back covers exactly these messages, so this becomes
        // the anchor index: only messages appended after it are estimated.
        const sentMessageCount = this.conversation.len();

        try {
          const stream = this.client.stream(
            apiConversation,
            // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
            toolSchemas as ToolSchema[],
            this.abortSignal,
          );

          for await (const event of stream) {
            if (this.abortSignal?.aborted) {
              looping = false;
              break;
            }
            switch (event.type) {
              case "text_delta": {
                fullText += event.text;
                yield { type: "stream_text", text: event.text };
                break;
              }

              case "thinking_delta": {
                yield { type: "thinking_text", text: event.text };
                break;
              }

              case "thinking_complete": {
                thinkingBlocks.push({
                  thinking: event.thinking,
                  signature: event.signature,
                });
                yield {
                  type: "thinking_complete",
                  thinking: event.thinking,
                  signature: event.signature,
                };
                break;
              }

              case "tool_call_start": {
                break;
              }

              case "tool_call_complete": {
                toolUses.push({
                  toolUseId: event.toolId,
                  toolName: event.toolName,
                  arguments: event.arguments,
                });
                yield {
                  type: "tool_use",
                  toolName: event.toolName,
                  toolId: event.toolId,
                  args: event.arguments,
                };
                break;
              }

              case "stream_end":
                stopReason = event.stopReason;
                // Record the real-token anchor: the full context size the API
                // just reported (input + cache_read + cache_creation + output)
                // plus the message count it covered. The next manageContext()
                // trusts this baseline and only char-estimates the tail beyond it.
                this.usageAnchor = {
                  baselineTokens:
                    event.usage.inputTokens +
                    event.usage.cacheReadInputTokens +
                    event.usage.cacheCreationInputTokens +
                    event.usage.outputTokens,
                  anchorCount: sentMessageCount,
                };
                yield { type: "usage", usage: event.usage };
                break;
            }
          }
        } catch (err) {
          if (this.abortSignal?.aborted) {
            yield { type: "loop_complete", stopReason: "interrupted" };
            return;
          }

          // Self-heal: context too long → force-compact, then retry the turn.
          if (err instanceof ContextTooLongError) {
            try {
              const result = await forceCompact(
                this.conversation,
                this.client,
                this.recoveryState,
                toolSchemaNames,
                this.sessionFilePath,
              );
              // Transcript was rewritten — the usage anchor is now stale (see the
              // reset after manageContext above). Drop it so the retry re-estimates
              // against the compacted transcript.
              this.usageAnchor = null;
              yield {
                type: "compact",
                message: "Auto-compacted due to context length: " + result.message,
                boundary: result.boundary,
              };
              continue;
            } catch {
              yield { type: "error", error: err };
              return;
            }
          }

          // Self-heal: rate limited → wait (Retry-After header or 5s), then retry.
          if (err instanceof RateLimitError) {
            const waitMs = parseRetryAfter(err.retryAfter);
            yield { type: "retry", reason: "rate limited", delay: waitMs };
            if (await this.interruptSleep(waitMs)) {
              yield { type: "loop_complete", stopReason: "interrupted" };
              return;
            }
            continue;
          }

          yield { type: "error", error: asError(err) };
          return;
        }

        if (this.abortSignal?.aborted) {
          if (fullText) {
            this.conversation.addAssistantFull(fullText, thinkingBlocks, []);
          }
          yield { type: "loop_complete", stopReason: "interrupted" };
          return;
        }

        await this.fireLifecycle("post_receive", fullText);

        // Handle the max_tokens stop reason: escalate the output ceiling once,
        // then do up to N multi-turn recoveries before giving up. Each recovery
        // re-prompts the model to resume from where it stopped.
        if (stopReason === "max_tokens") {
          if (!maxTokensEscalated) {
            this.client.setMaxOutputTokens?.(MAX_TOKENS_CEILING);
            maxTokensEscalated = true;
            if (fullText) {
              this.conversation.addAssistantFull(fullText, thinkingBlocks, []);
              this.conversation.addUserMessage(
                "Output token limit hit. Resume directly from where you stopped. Do not apologize or repeat previous content. Pick up mid-thought if needed.",
              );
            }
            yield { type: "retry", reason: "max_tokens escalation", delay: 0 };
            continue;
          } else if (outputRecoveries < MAX_OUTPUT_TOKENS_RECOVERIES) {
            outputRecoveries++;
            this.conversation.addAssistantFull(fullText, thinkingBlocks, []);
            this.conversation.addUserMessage(
              "Output token limit hit. Resume directly from where you stopped. Break remaining work into smaller pieces.",
            );
            yield {
              type: "retry",
              reason: `max_tokens recovery ${String(outputRecoveries)}/${String(MAX_OUTPUT_TOKENS_RECOVERIES)}`,
              delay: 0,
            };
            continue;
          }
          // Exhausted recoveries: fall through to normal completion.
        } else {
          outputRecoveries = 0;
        }

        this.conversation.addAssistantFull(fullText, thinkingBlocks, toolUses);

        if (toolUses.length > 0) {
          const results = await this.executeTools(toolUses);
          for (const r of results) {
            yield r;
          }

          // Safety guard: bail out if the model keeps calling tools that don't
          // exist — a sign it's stuck. Mirrors Go's consecutiveUnknown >= 3.
          for (const tu of toolUses) {
            if (this.registry.get(tu.toolName)) {
              consecutiveUnknown = 0;
            } else {
              consecutiveUnknown++;
            }
          }
          if (consecutiveUnknown >= 3) {
            yield {
              type: "error",
              error: new Error("Too many consecutive unknown tool calls"),
            };
            return;
          }

          const toolResults: ToolResultBlock[] = [];
          for (const r of results) {
            if (r.type === "tool_result") {
              toolResults.push({
                toolUseId: r.toolId,
                content:
                  r.output.length > MAX_OUTPUT_CHARS
                    ? r.output.slice(0, MAX_OUTPUT_CHARS) + "\n… (output truncated)"
                    : r.output,
                isError: r.isError,
              });
            }
          }
          const exitPlanCalled = toolUses.some((tu) => tu.toolName === "ExitPlanMode");
          this.conversation.addToolResultsMessage(toolResults);

          if (exitPlanCalled) {
            yield { type: "turn_complete" };
            yield { type: "loop_complete", stopReason: "end_turn" };
            return;
          }

          yield { type: "turn_complete" };
          await this.fireLifecycle("turn_end");
        } else {
          looping = false;
          if (this.fileHistory) {
            const summary = fullText.length > 60 ? fullText.slice(0, 60) + "..." : fullText;
            this.fileHistory.makeSnapshot(this.conversation.len(), summary);
          }
          yield { type: "loop_complete", stopReason };
          // Fire-and-forget post-completion hook (e.g. background memory
          // extraction). Mirrors Go's OnLoopComplete goroutine.
          if (this.onLoopComplete) {
            try {
              this.onLoopComplete(this.conversation);
            } catch {
              /* non-fatal */
            }
          }
        }
      }
    } finally {
      await this.fireLifecycle("session_end");
    }
  }

  // Fire a lifecycle hook event and queue any non-empty hook output as a
  // notification to be surfaced on the next turn. No-op without a HookEngine.
  private async fireLifecycle(event: EventName, message?: string): Promise<void> {
    if (!this.hookEngine) {
      return;
    }
    const results = await this.hookEngine.fire(event, { event, message });
    for (const r of results) {
      if (r.output) {
        this.hookEngine.recordNotification(r.output);
      }
    }
  }

  // Sleep for ms, resolving early with `true` if the abort signal fires during the wait. Resolves `false` on timeout.
  private interruptSleep(ms: number): Promise<boolean> {
    return new Promise((resolve) => {
      if (this.abortSignal?.aborted) {
        resolve(true);
        return;
      }
      const onAbort = () => {
        clearTimeout(timer);
        resolve(true);
      };
      const timer = setTimeout(() => {
        this.abortSignal?.removeEventListener("abort", onAbort);
        resolve(false);
      }, ms);
      this.abortSignal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  private async executeTools(toolUses: ToolUseBlock[]): Promise<AgentEvent[]> {
    const events: AgentEvent[] = [];

    // Partition tool calls into read-safe (parallel) and write/dangerous
    // (sequential) groups. Read-safe tools (Glob, Grep, ReadFile, etc.)
    // can safely overlap; write tools and commands execute one at a time.
    const readSafe: ToolUseBlock[] = [];
    const writeDangerous: ToolUseBlock[] = [];
    for (const tu of toolUses) {
      const tool = this.registry.get(tu.toolName);
      const category = tool?.category ?? "command";
      if (category === "read") {
        readSafe.push(tu);
      } else {
        writeDangerous.push(tu);
      }
    }

    // Execute read-safe batch in parallel first.
    if (readSafe.length > 0) {
      const batchEvents = await this.executeBatch(readSafe, true);
      events.push(...batchEvents);
    }

    // Execute write/dangerous tools sequentially.
    for (const tu of writeDangerous) {
      const batchEvents = await this.executeBatch([tu], false);
      events.push(...batchEvents);
    }

    return events;
  }

  // executeBatch runs a set of tool calls through permission checks, hooks,
  // and the streaming executor. When parallel is true all calls run
  // concurrently; otherwise they run one at a time.
  private async executeBatch(toolUses: ToolUseBlock[], parallel: boolean): Promise<AgentEvent[]> {
    const events: AgentEvent[] = [];
    const executor = new StreamingExecutor(this.registry, {
      workDir: this.workDir,
      fileHistory: this.fileHistory,
      fileStateCache: this.fileStateCache,
    });

    for (const tu of toolUses) {
      // Fire pre-tool hooks
      if (this.hookEngine) {
        const hookResult = await this.hookEngine.firePreToolHooks(tu.toolName, tu.arguments);
        if (hookResult.rejected) {
          events.push({
            type: "tool_result",
            toolName: tu.toolName,
            toolId: tu.toolUseId,
            output: `Rejected by hook: ${hookResult.reason}`,
            isError: true,
            elapsed: 0,
          });
          continue;
        }
      }

      const tool = this.registry.get(tu.toolName);
      const category = tool?.category ?? "command";

      const decision = this.checker.check(tu.toolName, category, tu.arguments);

      if (decision.effect === "deny") {
        events.push({
          type: "tool_result",
          toolName: tu.toolName,
          toolId: tu.toolUseId,
          output: `Permission denied: ${decision.reason}. This action has been intercepted and blocked by the security policy. Please inform the user that the command was denied, without describing what the command would do.`,
          isError: true,
          elapsed: 0,
        });
        continue;
      }

      if (decision.effect === "ask" && this.onPermissionRequest) {
        const response = await this.onPermissionRequest(tu.toolName, tu.arguments, decision);
        if (response === "deny") {
          events.push({
            type: "tool_result",
            toolName: tu.toolName,
            toolId: tu.toolUseId,
            output: "Permission denied by user",
            isError: true,
            elapsed: 0,
          });
          continue;
        }
        if (response === "allowAlways") {
          this.checker.allowAlways(tu.toolName, tu.arguments);
        }
      }

      executor.submit(tu.toolUseId, tu.toolName, tu.arguments);

      // Sequential mode: collect after every single call.
      if (!parallel) {
        const batchResults = await executor.collectResults();
        for (const r of batchResults) {
          await this.processToolResult(r, toolUses, events);
        }
      }
    }

    // Parallel mode: collect all results at once.
    if (parallel) {
      const batchResults = await executor.collectResults();
      for (const r of batchResults) {
        await this.processToolResult(r, toolUses, events);
      }
    }

    return events;
  }

  // processToolResult handles a single executor result: records file-read
  // snapshots, emits the tool_result event, and fires post-tool hooks.
  private async processToolResult(
    r: {
      toolId: string;
      toolName: string;
      result: { output: string; isError: boolean };
      elapsed: number;
    },
    toolUses: ToolUseBlock[],
    events: AgentEvent[],
  ): Promise<void> {
    // Snapshot ReadFile content into recovery state so a later auto-compact
    // can replay it after the transcript collapses into a summary.
    if (!r.result.isError && r.toolName === "ReadFile") {
      const tu = toolUses.find((t) => t.toolUseId === r.toolId);
      const p = strArg(tu?.arguments ?? {}, "file_path");
      if (p) {
        try {
          this.recoveryState.recordFileRead(p, await readFile(p, "utf-8"));
        } catch {
          /* best-effort; recovery snapshots are optional */
        }
      }
    }

    events.push({
      type: "tool_result",
      toolName: r.toolName,
      toolId: r.toolId,
      output: r.result.output,
      isError: r.result.isError,
      elapsed: r.elapsed,
    });

    // Fire post-tool hooks; queue any output as a notification.
    if (this.hookEngine) {
      const hookResults = await this.hookEngine.fire("post_tool_use", {
        event: "post_tool_use",
        toolName: r.toolName,
        message: r.result.output,
      });
      for (const hr of hookResults) {
        if (hr.output) {
          this.hookEngine.recordNotification(hr.output);
        }
      }
    }
  }
}

// buildActiveSkillsReminder renders all pinned skill SOPs into a single
// system-reminder string ("" when none are active). Mirrors Go.
function buildActiveSkillsReminder(active: Map<string, string>): string {
  if (active.size === 0) {
    return "";
  }
  let out =
    "# Active Skills\n\nThe following Skill SOPs are pinned to the environment context. Follow each SOP when its triggering condition applies.\n\n";
  for (const [name, body] of active) {
    out += `## Active Skill: ${name}\n\n${body}\n\n`;
  }
  return out;
}

// parseRetryAfter converts a Retry-After header (seconds) into milliseconds,
// defaulting to 5s when absent or unparsable.
function parseRetryAfter(header?: string): number {
  if (!header) {
    return 5000;
  }
  const secs = parseInt(header, 10);
  if (!Number.isNaN(secs)) {
    return secs * 1000;
  }
  return 5000;
}
