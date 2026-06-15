// WriteFileTool: write file contents with size limit and path traversal protection
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { z } from "zod";

import type { BaseTool, ToolResult } from "../base.js";
import { toolError, toolSuccess } from "../base.js";

const MAX_BYTES = 1 * 1024 * 1024;

export const WriteFileParamsSchema = z.object({
  path: z.string().describe("Relative path to the file (relative to current working directory)."),
  content: z.string().describe("Text content to write."),
});

export class WriteFileTool implements BaseTool {
  readonly name = "write_file";
  readonly description =
    "Write text content to a file, creating it (and any parent directories) if it does not exist, " +
    "or overwriting it if it does. Path must be relative to the current working directory. " +
    "Content size is limited to 1 MB.";
  readonly inputSchema = {
    type: "object" as const,
    properties: {
      path: {
        type: "string",
        description: "Relative path to the file (relative to current working directory).",
      },
      content: { type: "string", description: "Text content to write." },
    },
    required: ["path", "content"],
  };
  readonly paramsModel = WriteFileParamsSchema;

  invoke(params: Record<string, unknown>): Promise<ToolResult> {
    const parsed = WriteFileParamsSchema.parse(params);
    const filePath = parsed.path;
    const content = parsed.content;

    // Path traversal check: reject raw path components before normalize
    if (filePath.split(path.sep).includes("..")) {
      throw new Error(`path traversal not allowed: ${filePath}`);
    }

    const encoded = Buffer.from(content, "utf-8");
    if (encoded.length > MAX_BYTES) {
      return Promise.resolve(
        toolError(
          `content too large: ${String(encoded.length)} bytes (limit 1 MB)`,
          "runtime_error",
        ),
      );
    }

    const dir = path.dirname(filePath);
    mkdirSync(dir, { recursive: true });
    writeFileSync(filePath, content, "utf-8");

    return Promise.resolve(toolSuccess(`wrote ${String(encoded.length)} bytes to ${filePath}`));
  }
}
