import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Message, ToolResultBlock } from "../conversation/conversation.js";
import type { ContentReplacementState } from "./state.js";
import { isObject } from "../utils/index.js";

const SINGLE_RESULT_LIMIT = 50000;
const MESSAGE_AGGREGATE_LIMIT = 200000;
const OLD_RESULT_SNIP_CHARS = 2000;
const KEEP_RECENT_TURNS = 10;

function spillDir(workDir: string): string {
  return join(workDir, ".larky", "tool_results");
}

function writeSpill(
  workDir: string,
  toolUseId: string,
  content: string,
): string {
  const dir = spillDir(workDir);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, toolUseId);
  try {
    writeFileSync(path, content, { encoding: "utf-8", flag: "wx" });
  } catch (e: unknown) {
    if (isObject(e) && "code" in e && e.code !== "EEXIST") {
      throw e;
    }
  }
  return path;
}
const PREVIEW_CHARS = 2000;

function buildSpillPreview(content: string, spillPath: string): string {
  const sizeKB = Math.floor(content.length / 1024);
  const preview = content.slice(0, PREVIEW_CHARS);
  const hasMore = content.length > PREVIEW_CHARS;
  let msg = "<persisted-output>\n";
  msg += `Output too large (${String(sizeKB)}KB). Full content saved to:\n${spillPath}\n\n`;
  msg += `Preview (first 2KB):\n${preview}`;
  if (hasMore) msg += "\n...";
  msg += "\n</persisted-output>";
  return msg;
}

export function applyBudget(
  messages: Message[],
  workDir: string,
  state: ContentReplacementState,
): Message[] {
  const result: Message[] = [];

  for (const m of messages) {
    const msg = { ...m };

    if (msg.toolResults && msg.toolResults.length > 0) {
      const newResults = msg.toolResults.map((tr) => {
        // Existing replacement decision: replay directly to keep prompt-cache stable
        const existing = state.getReplacement(tr.toolUseId);
        if (existing !== undefined) {
          return { ...tr, content: existing };
        }

        let content = tr.content;

        // Pass 1: Single result exceeds limit → spill to disk
        if (content.length > SINGLE_RESULT_LIMIT) {
          const spillPath = writeSpill(workDir, tr.toolUseId, content);
          content = buildSpillPreview(content, spillPath);
          state.record(tr.toolUseId, tr.content, content);
        }

        return { ...tr, content };
      });

      // Pass 2: Message aggregate exceeds limit → spill the largest result
      let totalLen = newResults.reduce((sum, r) => sum + r.content.length, 0);
      if (totalLen > MESSAGE_AGGREGATE_LIMIT) {
        const sorted = [...newResults].sort(
          (a, b) => b.content.length - a.content.length,
        );
        for (const r of sorted) {
          if (totalLen <= MESSAGE_AGGREGATE_LIMIT) break;
          if (r.content.length > OLD_RESULT_SNIP_CHARS) {
            const before = r.content;
            const spillPath = writeSpill(workDir, r.toolUseId, before);
            const replacement = buildSpillPreview(before, spillPath);
            totalLen = totalLen - before.length + replacement.length;
            r.content = replacement;
            state.record(r.toolUseId, before, replacement);
          }
        }
      }

      msg.toolResults = newResults;
    }

    result.push(msg);
  }

  // Pass 3: Stale turn trimming (stateless); boundary naturally shifts as turns increase
  return snipStale(result);
}

// Prefix tag for replaced content, used to skip repeated trimming
const PERSISTED_TAG_PREFIX = "<persisted-output>";
const SNIPPED_TAG_PREFIX = "[Stale output snipped:";

function isAlreadyReplaced(s: string): boolean {
  return s.startsWith(PERSISTED_TAG_PREFIX) || s.startsWith(SNIPPED_TAG_PREFIX);
}

/**
 * snipStale performs stateless trimming of tool results from older turns.
 * "Turns" are counted by actual assistant messages without tool_use (i.e., plain text replies),
 * rather than simply approximating with messages.length / 2.
 */
function snipStale(messages: Message[]): Message[] {
  // Count actual turns: assistant messages that do not contain tool_use
  let totalTurns = 0;
  for (const m of messages) {
    if (m.role === "assistant" && (!m.toolUses || m.toolUses.length === 0)) {
      totalTurns++;
    }
  }
  // No trimming needed if there aren't enough turns
  if (totalTurns <= KEEP_RECENT_TURNS) {
    return messages;
  }

  const oldBoundary = totalTurns - KEEP_RECENT_TURNS;
  const out: Message[] = new Array<Message>(messages.length);
  let turnsSeen = 0;

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role === "assistant" && (!m.toolUses || m.toolUses.length === 0)) {
      turnsSeen++;
    }
    // Already within the recent window, or no tool results: keep directly
    if (
      turnsSeen > oldBoundary ||
      !m.toolResults ||
      m.toolResults.length === 0
    ) {
      out[i] = m;
      continue;
    }
    // Trim tool results from older turns
    let changed = false;
    const newResults: ToolResultBlock[] = [];
    for (const tr of m.toolResults) {
      if (
        isAlreadyReplaced(tr.content) ||
        tr.content.length <= OLD_RESULT_SNIP_CHARS
      ) {
        newResults.push(tr);
      } else {
        changed = true;
        newResults.push({
          ...tr,
          content: `[Stale output snipped: ${String(tr.content.length)} chars]`,
        });
      }
    }
    out[i] = changed ? { ...m, toolResults: newResults } : m;
  }
  return out;
}
