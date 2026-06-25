import {
  readFileSync,
  writeFileSync,
  readdirSync,
  mkdirSync,
  statSync,
  existsSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import z, { parse, safeParse } from "zod";

// Persistent session lines. Ordinary messages have an empty `type`, while compaction boundary records
// have the type COMPACT_BOUNDARY. Their `content` is the JSON-serialized CompactBoundaryPayload
// (containing a summary and the retained recent tail messages).
// Inlining the retained tail directly into the boundary record avoids "physical location" issues:
// during restoration, reading the boundary is sufficient to reconstruct
// [summary] + retained messages + messages appended after the boundary, without needing to search
// for the retained messages in the area preceding the boundary.
export const COMPACT_BOUNDARY = "compact_boundary";

/** Session expiry days. Session files older than this will be automatically cleaned up. */
const SESSION_EXPIRY_DAYS = 30;

const SessionMessageSchema = z.object({
  role: z.string(),
  content: z.string(),
  timestamp: z.string(),
  type: z.string().optional(),
  /** Tool call ID, used to verify the integrity of the tool_use/tool_result chain during restoration. */
  toolUseId: z.string().optional(),
});

export type SessionMessage = z.infer<typeof SessionMessageSchema>;

// One inlined kept message stored inside a boundary record. We only store
// role + text — consistent with how the rest of the session is persisted
// (the .jsonl only ever holds text, never tool_use/tool_result blocks).
const KeptMessageSchema = z.object({
  role: z.string(),
  content: z.string(),
});

export type KeptMessage = z.infer<typeof KeptMessageSchema>;

const CompactBoundaryPayloadSchema = z.object({
  summary: z.string(),
  keep: z.array(KeptMessageSchema),
});

// Structured payload serialized into a compact_boundary record's `content`.
export type CompactBoundaryPayload = z.infer<typeof CompactBoundaryPayloadSchema>;

export interface SessionInfo {
  id: string;
  firstMessage: string;
  messageCount: number;
  size: number;
  modTime: Date;
}

function sessionsDir(workDir: string): string {
  return join(workDir, ".larky", "sessions");
}

export function getSessionFilePath(workDir: string, sessionId: string): string {
  return join(sessionsDir(workDir), sessionId + ".jsonl");
}

export function newSessionId(): string {
  const ts = Date.now().toString(36);
  const rand = randomBytes(4).toString("hex");
  return `${ts}-${rand}`;
}

export function saveMessage(workDir: string, sessionId: string, msg: SessionMessage): void {
  const dir = sessionsDir(workDir);
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, `${sessionId}.jsonl`);
  const line = JSON.stringify(msg) + "\n";
  writeFileSync(filePath, line, { flag: /* append */ "a", encoding: "utf-8" });
}

// Append a compaction boundary to the session. The summary and the verbatim
// kept tail are inlined into one COMPACT_BOUNDARY record. This is append-only:
// the pre-boundary original messages stay in the file (they just won't be
// replayed on resume — see rebuildFromSession). Mirrors the Go/Java boundary
// record and the Python COMPACT_BOUNDARY RecordType.
export function saveCompactBoundary(
  workDir: string,
  sessionId: string,
  payload: CompactBoundaryPayload,
): void {
  saveMessage(workDir, sessionId, {
    role: "system",
    content: JSON.stringify(payload),
    timestamp: new Date().toISOString(),
    type: COMPACT_BOUNDARY,
  });
}

export function loadSession(workDir: string, sessionId: string): SessionMessage[] {
  const filePath = join(sessionsDir(workDir), `${sessionId}.jsonl`);
  if (!existsSync(filePath)) {
    return [];
  }

  const out: SessionMessage[] = [];
  for (const line of readFileSync(filePath, "utf-8").split("\n")) {
    if (!line.trim()) {
      continue;
    }
    try {
      const message: unknown = JSON.parse(line);
      const { success, data, error } = safeParse(SessionMessageSchema, message);
      // Boundary records carry their text payload in `content`, so keep them
      // (they pass the non-empty content check). Skip malformed or
      // empty-content ordinary messages rather than crashing the load.
      if (success) {
        out.push(data);
      } else {
        console.error(error);
      }
    } catch {
      // skip malformed line
    }
  }
  return out;
}

// A message ready to replay on resume. Boundary records expand into the summary
// (as a synthetic user message) followed by their inlined kept tail; ordinary
// records map 1:1. This is the compacted-state reconstruction.
export interface RestoredMessage {
  role: "user" | "assistant";
  content: string;
}

// Rebuild the conversation to replay on resume, honoring compaction boundaries.
//
//   - If the session contains at least one compact_boundary, take the LAST one
//     and rebuild: [summary as a user message] + its inlined keep tail +
//     every ordinary message appended AFTER that boundary. The original
//     messages before the boundary stay in the file but are NOT replayed —
//     that's the whole point of compaction surviving a resume.
//   - If there is no boundary (old sessions, or never compacted), replay every
//     ordinary message verbatim. Fully backward-compatible.
export function rebuildFromSession(saved: SessionMessage[]): RestoredMessage[] {
  // Find the last boundary record.
  let lastBoundary = -1;
  for (let i = saved.length - 1; i >= 0; i--) {
    if (saved[i].type === COMPACT_BOUNDARY) {
      lastBoundary = i;
      break;
    }
  }

  const out: RestoredMessage[] = [];

  if (lastBoundary >= 0) {
    // Compacted state: summary + inlined keep, then post-boundary appends.
    let payload: CompactBoundaryPayload | null = null;
    try {
      const payload_: unknown = JSON.parse(saved[lastBoundary].content);
      payload = parse(CompactBoundaryPayloadSchema, payload_);
    } catch {
      payload = null;
    }
    if (payload) {
      // The summary stands in for everything before the boundary, replayed as a
      // single user message (mirrors how doCompact rebuilds the live transcript).
      let resumeSummary =
        "This session is the previous conversation, which has been compressed due to context limitations. Here is a summary of the earlier messages:\n\n" +
        payload.summary;
      if (payload.keep.length > 0) {
        resumeSummary += "\n\nRecent messages have been preserved verbatim.";
      }
      out.push({ role: "user", content: resumeSummary });
      for (const k of payload.keep) {
        if (k.role === "user" || k.role === "assistant") {
          if (k.content) {
            out.push({ role: k.role, content: k.content });
          }
        }
      }
    }
    // Replay ordinary messages appended after the boundary (continuation turns).
    for (let i = lastBoundary + 1; i < saved.length; i++) {
      const m = saved[i];
      if (m.type === COMPACT_BOUNDARY) {
        continue;
      } // defensive; last() already found
      if (m.role === "user" && m.content) {
        out.push({ role: "user", content: m.content });
      } else if (m.role === "assistant" && m.content) {
        out.push({ role: "assistant", content: m.content });
      }
    }
    return out;
  }

  // No boundary → full replay (backward compatible).
  for (const m of saved) {
    if (m.role === "user" && m.content) {
      out.push({ role: "user", content: m.content });
    } else if (m.role === "assistant" && m.content) {
      out.push({ role: "assistant", content: m.content });
    }
  }
  return out;
}

export function listSessions(workDir: string): SessionInfo[] {
  const dir = sessionsDir(workDir);
  if (!existsSync(dir)) {
    return [];
  }

  const files = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
  const sessions: SessionInfo[] = [];

  for (const file of files) {
    const filePath = join(dir, file);
    const stat = statSync(filePath);
    const id = file.replace(".jsonl", "");

    let firstMessage = "";
    let messageCount = 0;
    try {
      for (const line of readFileSync(filePath, "utf-8").split("\n")) {
        if (!line.trim()) {
          continue;
        }
        let m: SessionMessage;
        try {
          const raw: unknown = JSON.parse(line);
          m = parse(SessionMessageSchema, raw);
        } catch {
          continue;
        }
        messageCount++;
        // Label the session by its first user message (untruncated role match).
        if (!firstMessage && m.role === "user" && m.content) {
          firstMessage = m.content.slice(0, 100);
        }
      }
    } catch {
      continue;
    }

    sessions.push({
      id,
      firstMessage,
      messageCount,
      size: stat.size,
      modTime: stat.mtime,
    });
  }

  sessions.sort((a, b) => b.modTime.getTime() - a.modTime.getTime());
  return sessions;
}

/**
 * Cleans up expired sessions: deletes .jsonl files whose last modified time exceeds SESSION_EXPIRY_DAYS.
 * Called during listSessions or on startup to prevent the session directory from growing indefinitely.
 * Silently skips failures (best-effort).
 */
export function cleanExpiredSessions(workDir: string): number {
  const dir = sessionsDir(workDir);
  if (!existsSync(dir)) {
    return 0;
  }

  const now = Date.now();
  const expiryMs = SESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
  let removed = 0;

  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
  } catch {
    return 0;
  }

  for (const file of files) {
    const filePath = join(dir, file);
    try {
      const stat = statSync(filePath);
      if (now - stat.mtimeMs > expiryMs) {
        unlinkSync(filePath);
        removed++;
      }
    } catch {
      // Silently skip if deletion fails
    }
  }
  return removed;
}
