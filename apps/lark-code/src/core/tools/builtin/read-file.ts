// ReadFileTool: read file contents with size limit and path traversal protection
import { readFileSync } from "node:fs";
import path from "node:path";

import { z } from "zod";

import type { BaseTool, ToolResult } from "../base.js";
import { toolError, toolSuccess } from "../base.js";

const MAX_BYTES = 512 * 1024;

export const ReadFileParamsSchema = z.object({
  path: z.string().describe("Relative path to the file (relative to current working directory)."),
});

export class ReadFileTool implements BaseTool {
  readonly name = "read_file";
  readonly description = `Read the text content of a file, path must be relative to current working directory, files larger than 512 KB are truncated.`;
  readonly inputSchema = {
    type: "object" as const,
    properties: {
      path: {
        type: "string",
        description: "Relative path to the file (relative to current working directory).",
      },
    },
    required: ["path"],
  };
  readonly paramsModel = ReadFileParamsSchema;

  invoke(params: Record<string, unknown>): Promise<ToolResult> {
    const parsed = ReadFileParamsSchema.parse(params);
    const filePath = parsed.path;

    // Path traversal check: reject raw path components before normalize
    if (filePath.split(path.sep).includes("..")) {
      return Promise.resolve(toolError(`path traversal not allowed: ${filePath}`, "runtime_error"));
    }

    try {
      const raw = readFileSync(filePath);
      let truncated = false;
      let data = raw;

      if (raw.length > MAX_BYTES) {
        data = raw.subarray(0, MAX_BYTES);
        truncated = true;
      }

      let text = data.toString("utf-8");
      if (truncated) {
        text += "\n[truncated]";
      }

      return Promise.resolve(toolSuccess(text));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return Promise.resolve(toolError(msg, "runtime_error"));
    }
  }
}
