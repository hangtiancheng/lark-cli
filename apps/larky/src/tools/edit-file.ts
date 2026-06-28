import { readFile, writeFile } from "node:fs/promises";
import { asErrorString } from "../utils/index.js";
import { EDIT_FILE_DESCRIPTION } from "./descriptions.js";
import {
  type Tool,
  type ToolCategory,
  type ToolContext,
  type ToolResult,
  type ToolSchema,
} from "./types.js";
import { boolArg, strArg } from "../utils/index.js";

export class EditFileTool implements Tool {
  // Use a hardcoded string instead of EditFileTool.name.replace("Tool", "")
  // because class names are not stable after minification — bundlers like
  // Terser/esbuild may rename or mangle them, producing incorrect tool names at runtime.
  name = "EditFile";

  description = EDIT_FILE_DESCRIPTION;

  category: ToolCategory = "write";

  schema(): ToolSchema {
    const inputSchema = {
      type: "object" as const,
      properties: {
        file_path: {
          type: "string" as const,
          description: "Absolute path to the file",
        },
        old_string: {
          type: "string" as const,
          description: "Exact string to find and replace",
        },
        new_string: {
          type: "string" as const,
          description: "Replacement string",
        },
        replace_all: {
          type: "boolean" as const,
          description: "Replace all occurrences of old_string (default false)",
          default: false,
        },
      },
      required: ["file_path", "old_string", "new_string"],
    };
    return {
      name: this.name,
      description: this.description,
      input_schema: inputSchema,
    };
  }

  async execute(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const filePath = strArg(args, "file_path");
    const oldString = strArg(args, "old_string");
    const newString = strArg(args, "new_string");
    const replaceAll = boolArg(args, "replace_all");

    if (!filePath) {
      return {
        output: "Error: file_path is required",
        isError: true,
      };
    }

    if (!oldString) {
      return {
        output: "Error: old_string is required",
        isError: true,
      };
    }

    if (oldString === newString) {
      return {
        output: "Error: old_string and new_string MUST be different",
        isError: true,
      };
    }

    // Gate: read-before-edit enforcement
    if (ctx.fileStateCache) {
      const gate = ctx.fileStateCache.check(filePath);
      if (!gate.ok) {
        return {
          output: gate.error,
          isError: true,
        };
      }
    }

    ctx.fileHistory?.trackEdit(filePath);

    let content: string;
    try {
      content = await readFile(filePath, "utf-8");
    } catch (err) {
      return {
        output: `Error reading file: ${asErrorString(err)}`,
        isError: true,
      };
    }

    const count = content.split(oldString).length - 1;
    if (count === 0) {
      return {
        output: "Error: old_string not found in file",
        isError: true,
      };
    }

    if (!replaceAll && count > 1) {
      return {
        output: `Error: old_string found ${String(count)} times in file. It must be unique. Add more surrounding context, or set replace_all to true`,
        isError: true,
      };
    }

    const newContent = replaceAll
      ? content.replaceAll(oldString, newString)
      : content.replace(oldString, newString);

    try {
      await writeFile(filePath, newContent, "utf-8");
      ctx.fileStateCache?.update(filePath, newContent);
      const msg =
        replaceAll && count > 1
          ? `File edited: ${filePath} (${String(count)} replacements)`
          : `File edited: ${filePath}`;
      return { output: msg, isError: false };
    } catch (err) {
      return {
        output: `Error writing file: ${asErrorString(err)}`,
        isError: true,
      };
    }
  }
}
