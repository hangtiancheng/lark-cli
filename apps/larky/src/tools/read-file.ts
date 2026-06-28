import { existsSync, readFileSync, statSync } from "fs";
import { asErrorString } from "../utils/index.js";
import { READ_FILE_DESCRIPTION } from "./descriptions.js";
import {
  type Tool,
  type ToolCategory,
  type ToolContext,
  type ToolResult,
  type ToolSchema,
} from "./types.js";
import { intArg, strArg } from "../utils/index.js";

export class ReadFileTool implements Tool {
  // Use a hardcoded string instead of ReadFileTool.name.replace("Tool", "")
  // because class names are not stable after minification — bundlers like
  // Terser/esbuild may rename or mangle them, producing incorrect tool names at runtime.
  name = "ReadFile";

  description = READ_FILE_DESCRIPTION;

  category: ToolCategory = "read";
  schema(): ToolSchema {
    const inputSchema = {
      type: "object" as const,
      properties: {
        file_path: {
          type: "string" as const,
          description: "Absolute path to the file",
        },
        offset: {
          type: "integer" as const,
          description: "Line number to start from (0-based)",
          default: 0,
        },
        limit: {
          type: "integer" as const,
          description: "Max lines to read",
          default: 2000,
        },
      },
      required: ["file_path"],
    };

    return {
      name: this.name,
      description: this.description,
      input_schema: inputSchema,
    };
  }

  execute(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const filePath = strArg(args, "file_path");
    if (!filePath) {
      return Promise.resolve({
        output: "Error: file_path is required",
        isError: true,
      });
    }

    if (!existsSync(filePath)) {
      return Promise.resolve({
        output: `Error: file not found: ${filePath}`,
        isError: true,
      });
    }

    const stat = statSync(filePath);
    if (stat.isDirectory()) {
      return Promise.resolve({
        output: `Error: ${filePath} is a directory, not a file. Use Glob to list directory contents.`,
        isError: true,
      });
    }

    const offset = intArg(args, "offset", 0);
    const limit = intArg(args, "limit", 2000);

    try {
      const content = readFileSync(filePath, "utf-8");
      const lines = content.split("\n");
      const slice = lines.slice(offset, offset + limit);

      // Register the file as "read" in the state cache so subsequent
      // EditFile / WriteFile calls are allowed.
      ctx.fileStateCache?.record(filePath, content, stat.mtimeMs);

      const numbered = slice.map((line, i) => `${String(offset + i + 1)}\t${line}`);
      return Promise.resolve({
        output: numbered.join("\n"),
        isError: false,
      });
    } catch (err) {
      return Promise.resolve({
        output: `Error reading file: ${asErrorString(err)}`,
        isError: true,
      });
    }
  }
}
