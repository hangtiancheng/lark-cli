// NoteSaveTool: persist session notes via SessionStore
import { z } from "zod";

import type { BaseTool, ToolResult } from "../base.js";
import { toolError, toolSuccess } from "../base.js";
import type { SessionStore } from "../../session/store.js";

export const NoteSaveParamsSchema = z.object({
  content: z.string().describe("The durable fact or decision to remember."),
});

export class NoteSaveTool implements BaseTool {
  readonly name = "note_save";
  readonly description =
    "Save a concise fact or decision to this session's notes. " +
    "These notes are visible in future turns of the same session.";
  readonly inputSchema = {
    type: "object" as const,
    properties: {
      content: {
        type: "string",
        description: "The durable fact or decision to remember.",
      },
    },
    required: ["content"],
  };
  readonly paramsModel = NoteSaveParamsSchema;

  private _store: SessionStore;
  private _sessionId: string;
  private _runId: string;

  constructor(store: SessionStore, sessionId: string, runId: string) {
    this._store = store;
    this._sessionId = sessionId;
    this._runId = runId;
  }

  invoke(params: Record<string, unknown>): Promise<ToolResult> {
    const parsed = NoteSaveParamsSchema.parse(params);
    const content = parsed.content.trim();

    if (!content) {
      return Promise.resolve(toolError("empty content", "runtime_error"));
    }

    this._store.appendNote(this._sessionId, content, this._runId);
    return Promise.resolve(toolSuccess("saved"));
  }
}
