// SessionStore: file-based session persistence (meta.json, thread.jsonl, notes.md)
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
  renameSync,
} from "node:fs";
import path from "node:path";

import type Anthropic from "@anthropic-ai/sdk";
import type { ContentBlockParam } from "@anthropic-ai/sdk/resources";

import type { Session } from "./model.js";
import { sessionToDict, sessionFromDict } from "./model.js";
import { truncateToolResults } from "../compact/budget.js";

// Type predicate: validate that an unknown value is a ContentBlockParam (has required 'type' field)
function isContentBlockParam(item: unknown): item is ContentBlockParam {
  return typeof item === "object" && item !== null && "type" in item;
}

function now(): string {
  return new Date().toISOString();
}

export class SessionStore {
  private _root: string;

  // Initialize session file storage root directory
  constructor(root: string) {
    this._root = root;
    mkdirSync(this._root, { recursive: true });
  }

  // Return the directory path for a given session
  sessionDir(sid: string): string {
    return path.join(this._root, sid);
  }

  // Return the runs directory path under a given session
  runsDir(sid: string): string {
    return path.join(this.sessionDir(sid), "runs");
  }

  // Write session meta to meta.json
  writeMeta(session: Session): void {
    const dir = this.sessionDir(session.id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, "meta.json"),
      JSON.stringify(sessionToDict(session), null, 2) + "\n",
      "utf-8",
    );
  }

  // Read session meta from meta.json
  readMeta(sid: string): Session {
    const raw: unknown = JSON.parse(
      readFileSync(path.join(this.sessionDir(sid), "meta.json"), "utf-8"),
    );
    if (typeof raw !== "object" || raw === null) {
      throw new Error(`Invalid meta.json for session ${sid}`);
    }
    return sessionFromDict(Object.fromEntries(Object.entries(raw)));
  }

  // Append a single message to thread.jsonl
  appendMessage(sid: string, role: string, content: unknown, runId?: string): void {
    const row: Record<string, unknown> = { ts: now(), role, content };
    if (runId !== undefined) row["run_id"] = runId;
    const dir = this.sessionDir(sid);
    mkdirSync(dir, { recursive: true });
    appendFileSync(path.join(dir, "thread.jsonl"), JSON.stringify(row) + "\n", "utf-8");
  }

  // Batch-append messages from a single run to thread.jsonl
  appendMessages(sid: string, messages: Anthropic.MessageParam[], runId: string): void {
    for (const msg of messages) {
      this.appendMessage(sid, msg.role, msg.content, runId);
    }
  }

  // Read the full thread and return messages ready for the Anthropic API
  readMessages(sid: string): Anthropic.MessageParam[] {
    const filePath = path.join(this.sessionDir(sid), "thread.jsonl");
    if (!existsSync(filePath)) return [];

    const messages: Anthropic.MessageParam[] = [];
    for (const line of readFileSync(filePath, "utf-8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const parsed: unknown = JSON.parse(line);
        if (typeof parsed !== "object" || parsed === null) continue;
        const row = parsed;
        const role = "role" in row ? row.role : undefined;
        if (role !== "user" && role !== "assistant") continue;
        const content = "content" in row ? (row.content ?? "") : "";
        if (typeof content === "string") {
          messages.push({ role, content });
        } else if (Array.isArray(content)) {
          messages.push({ role, content: content.filter(isContentBlockParam) });
        }
      } catch {
        continue;
      }
    }

    return truncateToolResults(this._trimOrphanToolUse(messages));
  }

  // Trim trailing unpaired tool_use blocks and all messages after them
  private _trimOrphanToolUse(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
    const pending = new Set<string>();
    let lastBalanced = 0;

    for (let idx = 0; idx < messages.length; idx++) {
      const msg = messages[idx];
      const content = msg.content;
      if (Array.isArray(content)) {
        if (msg.role === "assistant") {
          for (const block of content) {
            if (block.type === "tool_use") {
              pending.add(block.id);
            }
          }
        } else if (msg.role === "user") {
          for (const block of content) {
            if (block.type === "tool_result") {
              pending.delete(block.tool_use_id);
            }
          }
        }
      }
      if (pending.size === 0) lastBalanced = idx + 1;
    }

    if (pending.size > 0) return messages.slice(0, lastBalanced);
    return messages;
  }

  // Overwrite thread.jsonl with compacted messages; back up the original file
  writeCompacted(sid: string, messages: Anthropic.MessageParam[]): void {
    const filePath = path.join(this.sessionDir(sid), "thread.jsonl");
    const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 15);
    const bak = path.join(this.sessionDir(sid), `thread_${ts}.jsonl.bak`);
    if (existsSync(filePath)) renameSync(filePath, bak);

    const lines = messages.map((msg) =>
      JSON.stringify({ ts: now(), role: msg.role, content: msg.content }),
    );
    writeFileSync(filePath, lines.join("\n") + "\n", "utf-8");
  }

  // Read notes.md content; returns empty string if file does not exist
  readNotes(sid: string): string {
    const filePath = path.join(this.sessionDir(sid), "notes.md");
    if (!existsSync(filePath)) return "";
    return readFileSync(filePath, "utf-8");
  }

  // Append a proactive note to notes.md
  appendNote(sid: string, content: string, runId: string): void {
    const dir = this.sessionDir(sid);
    mkdirSync(dir, { recursive: true });
    appendFileSync(
      path.join(dir, "notes.md"),
      `## Note (${now()}, ${runId})\n${content}\n\n`,
      "utf-8",
    );
  }
}
