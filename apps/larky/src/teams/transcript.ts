import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { ConversationManager } from "../conversation/conversation.js";
import z, { parse } from "zod";

// Serialized data structure
const TranscriptToolUseSchema = z.object({
  tool_use_id: z.string(),
  tool_name: z.string(),
  arguments: z.record(z.string(), z.unknown()),
});

const TranscriptToolResultSchema = z.object({
  tool_use_id: z.string(),
  content: z.string(),
  is_error: z.boolean().optional(),
});

const TranscriptEntrySchema = z.object({
  role: z.string(),
  content: z.string().optional(),
  tool_uses: z.array(TranscriptToolUseSchema).optional(),
  tool_results: z.array(TranscriptToolResultSchema).optional(),
});

type TranscriptEntry = z.infer<typeof TranscriptEntrySchema>;

// Serialization / Deserialization

/**
 * Serializes the conversation history into a list of persistable entries.
 */

function serializeConversation(conversation: ConversationManager): TranscriptEntry[] {
  const entries: TranscriptEntry[] = [];
  for (const msg of conversation.getMessages()) {
    const entry: TranscriptEntry = { role: msg.role, content: msg.content };
    if (msg.toolUses && msg.toolUses.length > 0) {
      entry.tool_uses = msg.toolUses.map((tu) => ({
        tool_use_id: tu.toolUseId,
        tool_name: tu.toolName,
        arguments: tu.arguments,
      }));
    }
    if (msg.toolResults && msg.toolResults.length > 0) {
      entry.tool_results = msg.toolResults.map((tr) => ({
        tool_use_id: tr.toolUseId,
        content: tr.content,
        is_error: tr.isError || undefined,
      }));
    }
    entries.push(entry);
  }
  return entries;
}

/**
 * Returns the storage directory for team transcripts.
 */
function transcriptDir(workDir: string, teamName: string): string {
  return join(workDir, ".larky", "teams", teamName, "transcripts");
}

/**
 * Persists a teammate's conversation history to disk for debugging and troubleshooting.
 * File path: .larky/teams/{team}/transcripts/{agentId}.json
 */
export function saveTranscript(
  workDir: string,
  teamName: string,
  agentId: string,
  conversation: ConversationManager,
): string {
  const dir = transcriptDir(workDir, teamName);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${agentId}.json`);
  const data = serializeConversation(conversation);
  writeFileSync(path, JSON.stringify(data, null, 2), "utf-8");
  return path;
}

/**
 Loads a teammate's conversation history from disk.
 Returns null if the file does not exist or parsing fails.
 */
export function loadTranscript(
  workDir: string,
  teamName: string,
  agentId: string,
): TranscriptEntry[] | null {
  const path = join(transcriptDir(workDir, teamName), `${agentId}.json`);
  if (!existsSync(path)) {
    return null;
  }
  try {
    const raw: unknown = JSON.parse(readFileSync(path, "utf-8"));
    const parsed = parse(z.array(TranscriptEntrySchema), raw);
    return parsed;
  } catch {
    return null;
  }
}
