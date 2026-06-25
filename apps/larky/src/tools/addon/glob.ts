import { statSync } from "fs";
import { Glob } from "@lark.js/glob-addon";
import { join } from "path";
import { asErrorString } from "../../utils/index.js";
import { GLOB_DESCRIPTION } from "../descriptions.js";
import {
  SKIP_DIRS,
  strArg,
  type Tool,
  type ToolCategory,
  type ToolContext,
  type ToolResult,
  type ToolSchema,
} from "../types.js";

export class GlobTool implements Tool {
  // Use a hardcoded string instead of GlobTool.name.replace("Tool", "")
  // because class names are not stable after minification — bundlers like
  // Terser/esbuild may rename or mangle them, producing incorrect tool names at runtime.
  name = "Glob";
  description = GLOB_DESCRIPTION;
  category: ToolCategory = "read";

  schema(): ToolSchema {
    const inputSchema = {
      type: "object" as const,
      properties: {
        pattern: {
          type: "string" as const,
          description: "Glob pattern (e.g., '**/*.ts', '**/*.go')",
        },
        path: {
          type: "string" as const,
          description: "Base directory to search from",
          default: ".",
        },
      },
      required: ["pattern"],
    };

    return {
      name: this.name,
      description: this.description,
      input_schema: inputSchema,
    };
  }

  execute(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const pattern = strArg(args, "pattern");
    if (!pattern) {
      return Promise.resolve({
        output: "Error: pattern is required",
        isError: true,
      });
    }

    const basePath = strArg(args, "path", ctx.workDir);
    try {
      const g = new Glob(pattern);
      const matches = g.scan({
        cwd: basePath,
        exclude: [...SKIP_DIRS],
        maxResults: 1000,
      });

      matches.sort((a, b) => {
        try {
          const ma = statSync(join(basePath, a)).mtimeMs;
          const mb = statSync(join(basePath, b)).mtimeMs;
          return mb - ma;
        } catch {
          return a.localeCompare(b);
        }
      });

      if (matches.length === 0) {
        return Promise.resolve({
          output: "No files matched the pattern.",
          isError: false,
        });
      }

      return Promise.resolve({
        output: matches.join("\n"),
        isError: false,
      });
    } catch (err) {
      return Promise.resolve({
        output: `Error: ${asErrorString(err)}`,
        isError: true,
      });
    }
  }
}
