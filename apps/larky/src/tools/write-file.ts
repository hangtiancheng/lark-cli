import { existsSync, mkdirSync, writeFileSync } from "fs";
import { dirname } from "path";
import { asErrorString } from "../utils/index.js";
import { WRITE_FILE_DESCRIPTION } from "./descriptions.js";
import {
  type Tool,
  type ToolCategory,
  type ToolContext,
  type ToolResult,
  type ToolSchema,
} from "./types.js";
import { strArg } from "../utils/index.js";

export class WriteFileTool implements Tool {
  // Use a hardcoded string instead of WriteFileTool.name.replace("Tool", "")
  // because class names are not stable after minification — bundlers like
  // Terser/esbuild may rename or mangle them, producing incorrect tool names at runtime.
  name = "WriteFile";

  description = WRITE_FILE_DESCRIPTION;

  category: ToolCategory = "write";

  schema(): ToolSchema {
    const inputSchema = {
      type: "object" as const,
      properties: {
        file_path: {
          type: "string" as const,
          description: "Absolute path to write",
        },
        content: {
          type: "string" as const,
          description: "Content to write",
        },
      },
      required: ["file_path", "content"],
    };

    return {
      name: this.name,
      description: this.description,
      input_schema: inputSchema,
    };
  }

  execute(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const filePath = strArg(args, "file_path");
    const content = strArg(args, "content");
    if (!filePath) {
      return Promise.resolve({
        output: "Error: file_path is required",
        isError: true,
      });
    }

    // Gate: read-before-write enforcement (skip for new files)
    if (ctx.fileStateCache && existsSync(filePath)) {
      const gate = ctx.fileStateCache.check(filePath);
      if (!gate.ok) {
        return Promise.resolve({
          output: gate.error,
          isError: true,
        });
      }
    }

    try {
      ctx.fileHistory?.trackEdit(filePath);
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, content, "utf-8");
      ctx.fileStateCache?.update(filePath, content);
      const lineCount = content.split("\n").length;
      return Promise.resolve({
        output: `File written: ${filePath} (${String(lineCount)} lines)`,
        isError: false,
      });
    } catch (err) {
      return Promise.resolve({
        output: `Error writing file: ${asErrorString(err)}`,
        isError: true,
      });
    }
  }
}
