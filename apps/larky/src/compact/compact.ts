import type { LLMClient } from "../llm/client.js";
import { ConversationManager } from "../conversation/conversation.js";
import type { Message } from "../conversation/conversation.js";
import type { RecoveryState } from "./recovery.js";
import type { CompactBoundaryPayload } from "../session/session.js";
import { asErrorString } from "../utils/index.js";

// Structured outcome of a compaction. When `compacted` is true, `boundary`
// carries the summary plus the verbatim kept tail (inlined as role+text) so the
// caller that owns the sessionId can persist a compact_boundary record. The
// kept tail is flattened to text here — the same text-only shape the session
// .jsonl already uses — which is exactly what resume needs to replay.
export interface CompactResult {
  compacted: boolean;
  message: string;
  boundary?: CompactBoundaryPayload;
}

// Legacy ratio threshold, kept for reference. The live judgment below uses the
// token-budget formula aligned with Claude Code's autoCompact.ts: reserve room
// for the summary output, then leave a safety margin before the window fills.
// const AUTO_COMPACT_THRESHOLD = 0.8;
const MAX_CONSECUTIVE_FAILURES = 3;
const CHARS_PER_TOKEN = 3.5;

// Recent-history retention for compaction, aligned with Claude Code's
// buildPostCompactMessages messagesToKeep. When we compact we keep the tail of
// the transcript verbatim instead of collapsing everything into a summary, so
// the model still sees the literal recent exchange (not just a paraphrase).
//   KEEP_RECENT_TOKENS — lower bound: walk back from the tail until the kept
//     tail reaches at least this many tokens (one of two "good enough" stops).
//   MIN_KEEP_MESSAGES — floor: keep at least this many recent messages even if
//     they are short (the other "good enough" stop).
//   KEEP_MAX_TOKENS — upper bound: never let the kept tail exceed this; stop
//     walking back once adding the next message would cross it.
const KEEP_RECENT_TOKENS = 10000;
const MIN_KEEP_MESSAGES = 5;
const KEEP_MAX_TOKENS = 40000;

// If fewer than this many messages would be summarized (everything else is in
// the kept tail), skip compaction entirely — the savings aren't worth the
// summary round-trip and the lost cache. Degenerate-case guard for step 5.
const MIN_COMPACT_PREFIX = 2;

const SUMMARY_OUTPUT_RESERVE = 20000;
const AUTO_COMPACT_SAFETY_MARGIN = 13000;
const MANUAL_COMPACT_SAFETY_MARGIN = 3000;

// effectiveWindow = contextWindow − min(model maxOutput, SUMMARY_OUTPUT_RESERVE).
// Auto-compact triggers at effectiveWindow − AUTO margin; once token usage crosses
// effectiveWindow − MANUAL margin (the hard block line) we must force a compaction.
export function computeCompactThreshold(
  contextWindow: number,
  maxOutput: number,
  manual = false,
): number {
  const effective = contextWindow - Math.min(maxOutput, SUMMARY_OUTPUT_RESERVE);
  const margin = manual ? MANUAL_COMPACT_SAFETY_MARGIN : AUTO_COMPACT_SAFETY_MARGIN;
  return effective - margin;
}

export class AutoCompactTrackingState {
  consecutiveFailures = 0;
}

// Real-token anchor captured after each stream ends. Mirrors Claude Code's
// tokenCountWithEstimation: instead of re-estimating the whole transcript from
// characters every turn, we pin the last API-reported context size
// (input + cache_read + cache_creation + output) and the message count at that
// moment, then only character-estimate the messages appended afterwards.
export interface UsageAnchor {
  // input + cache_read + cache_creation + output from the last real API usage.
  baselineTokens: number;
  // conversation.len() at the moment the anchor was recorded; only messages
  // beyond this index are estimated incrementally.
  anchorCount: number;
}

// Rough character-based token estimate over an explicit message slice. Used both
// for the cold-start whole-transcript fallback and the post-anchor increment.
export function estimateMessages(messages: Message[]): number {
  let totalChars = 0;
  for (const msg of messages) {
    totalChars += msg.content.length;
    if (msg.toolUses) {
      totalChars += JSON.stringify(msg.toolUses).length;
    }
    if (msg.toolResults) {
      for (const tr of msg.toolResults) {
        totalChars += tr.content.length;
      }
    }
    if (msg.thinkingBlocks) {
      for (const tb of msg.thinkingBlocks) {
        totalChars += tb.thinking.length;
      }
    }
  }
  return Math.ceil(totalChars / CHARS_PER_TOKEN);
}

export function estimateTokens(conversation: ConversationManager): number {
  return estimateMessages(conversation.getMessages());
}

// Single-message token estimate, reusing the same char/3.5 heuristic as the
// slice estimator so the keep-walk and the context judgment agree.
function estimateOne(msg: Message): number {
  return estimateMessages([msg]);
}

// A user message carrying tool_result blocks is the second half of a
// tool_use↔tool_result pair; its partner tool_use lives on a preceding
// assistant message. We must never keep such a message without its tool_use.
function hasToolResult(msg: Message): boolean {
  return msg.role === "user" && !!msg.toolResults && msg.toolResults.length > 0;
}

// Choose where the kept (verbatim) tail begins. Walk backward from the end
// accumulating per-message tokens until we hit a "good enough" stop — either
// the kept tail reached KEEP_RECENT_TOKENS or we've kept MIN_KEEP_MESSAGES
// messages (whichever comes first is fine, each is a floor) — but never let the
// tail exceed KEEP_MAX_TOKENS (stop before crossing it). Returns the index of
// the first kept message. Mirrors Claude Code's messagesToKeep selection.
export function computeKeepStartIndex(messages: Message[]): number {
  let keepTokens = 0;
  let keepCount = 0;
  let keepStart = messages.length;

  for (let i = messages.length - 1; i >= 0; i--) {
    const t = estimateOne(messages[i]);
    // Upper bound: adding this message would overflow the kept tail. Stop and
    // leave it out (it belongs to the summarized prefix instead).
    if (keepCount > 0 && keepTokens + t > KEEP_MAX_TOKENS) {
      break;
    }
    keepStart = i;
    keepTokens += t;
    keepCount++;
    // Lower bounds: either floor satisfied → we've kept enough recent context.
    if (keepTokens >= KEEP_RECENT_TOKENS || keepCount >= MIN_KEEP_MESSAGES) {
      break;
    }
  }

  // Don't split a tool_use↔tool_result pair: if the boundary lands on a
  // tool_result user message, move it back past the matching tool_use assistant
  // message so the pair stays whole (better to keep one extra pair than to
  // leave an orphaned tool_result with no originating tool_use).
  keepStart = backUpPastToolUse(messages, keepStart);
  return keepStart;
}

// If messages[keepStart] is a tool_result user message, walk back to include
// the assistant tool_use message that produced its tool_use_id(s). Keeps the
// pair intact; idempotent when the boundary is already clean.
function backUpPastToolUse(messages: Message[], keepStart: number): number {
  if (keepStart <= 0 || keepStart >= messages.length) {
    return keepStart;
  }
  if (!hasToolResult(messages[keepStart])) {
    return keepStart;
  }

  const ids = new Set((messages[keepStart].toolResults ?? []).map((tr) => tr.toolUseId));
  for (let i = keepStart - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "assistant" && m.toolUses?.some((tu) => ids.has(tu.toolUseId))) {
      return i;
    }
  }
  // No matching tool_use found (shouldn't happen for well-formed transcripts);
  // leave keepStart unchanged rather than dropping the whole prefix.
  return keepStart;
}

// Current context size used for the compact judgment. With a real usage anchor
// we trust the last API-reported token count and only character-estimate the
// messages appended after it (baseline + increment). On a cold start (no anchor
// yet) we fall back to estimating the entire transcript so the very first turn
// still works. Mirrors CC tokenCountWithEstimation and the python last_input
// simplification, extended with cache tokens for a more accurate baseline.
export function currentContextTokens(
  conversation: ConversationManager,
  anchor: UsageAnchor | null,
): number {
  if (!anchor) {
    return estimateTokens(conversation);
  }
  const messages = conversation.getMessages();
  // Clamp in case the transcript was truncated (e.g. by a compaction) below the
  // anchor index — then nothing new to add on top of the baseline.
  const start = Math.min(anchor.anchorCount, messages.length);
  return anchor.baselineTokens + estimateMessages(messages.slice(start));
}

export async function manageContext(
  conversation: ConversationManager,
  client: LLMClient,
  contextWindow: number,
  maxOutput: number,
  trackingState: AutoCompactTrackingState,
  recoveryState: RecoveryState | null,
  toolSchemaNames: string[],
  anchor: UsageAnchor | null = null,
  sessionFilePath = "",
): Promise<CompactResult> {
  // Anchor the current-token estimate to the last real API usage when we have
  // one; otherwise fall back to whole-transcript char estimation (cold start).
  const tokens = currentContextTokens(conversation, anchor);
  const autoThreshold = computeCompactThreshold(contextWindow, maxOutput);
  const hardBlock = computeCompactThreshold(contextWindow, maxOutput, true);

  if (tokens < autoThreshold) {
    return { compacted: false, message: "" };
  }

  // Past the hard-block line we must compact even if the circuit breaker tripped.
  const forced = tokens >= hardBlock;
  if (!forced && trackingState.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
    return {
      compacted: false,
      message: `Auto-compact circuit breaker: ${String(MAX_CONSECUTIVE_FAILURES)} consecutive failures`,
    };
  }

  try {
    const result = await doCompact(
      conversation,
      client,
      recoveryState,
      toolSchemaNames,
      sessionFilePath,
    );
    trackingState.consecutiveFailures = 0;
    return result;
  } catch (err) {
    trackingState.consecutiveFailures++;
    return {
      compacted: false,
      message: `Auto-compact failed: ${asErrorString(err)}`,
    };
  }
}

export async function forceCompact(
  conversation: ConversationManager,
  client: LLMClient,
  recoveryState: RecoveryState | null,
  toolSchemaNames: string[],
  sessionFilePath = "",
): Promise<CompactResult> {
  return doCompact(conversation, client, recoveryState, toolSchemaNames, sessionFilePath);
}

async function doCompact(
  conversation: ConversationManager,
  client: LLMClient,
  recoveryState: RecoveryState | null,
  toolSchemaNames: string[],
  sessionFilePath = "",
): Promise<CompactResult> {
  const messages = conversation.getMessages();

  // Decide how much recent history to keep verbatim. Only messages[:keepStart]
  // get summarized; messages[keepStart:] are carried over untouched so the
  // model still sees the literal recent exchange.
  const keepStart = computeKeepStartIndex(messages);

  // Degenerate cases: if (almost) everything is already inside the kept tail,
  // compacting would only summarize a tiny prefix. Skip it and
  // keep the conversation as-is rather than churn for no real token savings.
  if (keepStart <= 0 || keepStart < MIN_COMPACT_PREFIX) {
    return {
      compacted: false,
      message: `Compaction skipped: only ${String(keepStart)} message(s) to summarize, kept verbatim`,
    };
  }

  const toSummarize = messages.slice(0, keepStart);
  const toKeep = messages.slice(keepStart);

  const conversationText = toSummarize
    .map((m) => {
      let text = `[${m.role}]: ${m.content}`;
      if (m.toolUses) {
        text += `\n[tools: ${m.toolUses.map((t) => t.toolName).join(", ")}]`;
      }
      return text;
    })
    .join("\n\n");

  const summaryConversation = new ConversationManager();
  summaryConversation.addUserMessage(
    "Summarize the following conversation. " +
      "Wrap your analysis in <analysis> tags, then provide the summary in <summary> tags.\n\n" +
      conversationText,
  );

  let summaryText = "";
  const stream = client.stream(summaryConversation, []);
  for await (const event of stream) {
    if (event.type === "text_delta") {
      summaryText += event.text;
    }
  }

  const summaryMatch = /<summary>([\s\S]*?)<\/summary>/.exec(summaryText);
  const summary = summaryMatch ? summaryMatch[1].trim() : summaryText;

  const recoveryAttachment = recoveryState
    ? recoveryState.buildRecoveryAttachment(toolSchemaNames)
    : "";

  // Rebuild: summary user message (no assistant ack), then
  // the verbatim recent tail. The summary only covers messages[:keepStart].
  let summaryContent =
    "This session continues from a previous conversation that was compacted due to context size limits. Below is a summary of the earlier discussion:\n\n" +
    summary;
  if (toKeep.length > 0) {
    summaryContent += "\n\nRecent messages have been preserved as-is.";
  }
  if (sessionFilePath) {
    summaryContent += `\n\nIf you need specific details from before the compression (such as code snippets or error messages), please use ReadFile to access the full session log at: ${sessionFilePath}`;
  }

  if (recoveryAttachment) {
    summaryContent += `\n\n---\n\n${recoveryAttachment}`;
  }
  conversation.replaceWithCompacted(summaryContent, toKeep);

  // Build the boundary payload the session owner will persist. We inline the
  // kept tail as role+text only (the session .jsonl never stores tool blocks),
  // dropping messages whose flattened text is empty (e.g. pure tool_result
  // user messages) — those carry no replayable text, matching how resume
  // already skips empty-content lines. The summary here is the bare summary
  // (no recovery attachment): recovery context is rebuilt fresh per process, so
  // baking it into the persisted boundary would be stale on the next resume.
  const keep = toKeep
    .filter((m) => (m.role === "user" || m.role === "assistant") && m.content)
    .map((m) => ({ role: m.role, content: m.content }));

  return {
    compacted: true,
    message: `Compacted ${String(toSummarize.length)} messages into summary (${String(summary.length)} chars), kept ${String(toKeep.length)} recent messages verbatim`,
    boundary: { summary, keep },
  };
}
