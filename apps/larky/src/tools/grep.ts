import type { Stats } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { Glob } from "@lark.js/glob-wasm";
import { asErrorString } from "../utils/index.js";
import { GREP_DESCRIPTION } from "./descriptions.js";
import {
  SKIP_DIRS,
  strArg,
  type Tool,
  type ToolCategory,
  type ToolContext,
  type ToolResult,
  type ToolSchema,
} from "./types.js";

const MAX_RESULTS = 500;

export class GrepTool implements Tool {
  // Use a hardcoded string instead of GrepTool.name.replace("Tool", "")
  // because class names are not stable after minification — bundlers like
  // Terser/esbuild may rename or mangle them, producing incorrect tool names at runtime.
  name = "Grep";

  description = GREP_DESCRIPTION;

  category: ToolCategory = "read";

  schema(): ToolSchema {
    const inputSchema = {
      type: "object" as const,
      properties: {
        pattern: {
          type: "string" as const,
          description: "Regex pattern to search",
        },
        path: {
          type: "string" as const,
          description: "Directory or file to search",
          default: ".",
        },
        include: {
          type: "string" as const,
          description: "File pattern filter (e.g., '*.ts')",
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

  async execute(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const pattern = strArg(args, "pattern");
    if (!pattern) {
      return {
        output: "Error: pattern is required",
        isError: true,
      };
    }

    const searchPath = strArg(args, "path", ctx.workDir);
    const include = strArg(args, "include");

    let regex: RegExp;
    try {
      regex = new RegExp(pattern, "i");
    } catch (err) {
      console.error(err);
      return {
        output: `Error: invalid regex pattern: ${pattern}`,
        isError: true,
      };
    }

    const includeGlob = include ? new Glob(include) : null;
    const results: string[] = [];

    const walk = async (dir: string): Promise<void> => {
      if (results.length >= MAX_RESULTS) {
        return;
      }

      let entries: string[];
      try {
        entries = await readdir(dir);
      } catch {
        return;
      }

      for (const entry of entries) {
        if (results.length >= MAX_RESULTS) {
          return;
        }
        if (SKIP_DIRS.has(entry)) {
          continue;
        }

        const fullPath = join(dir, entry);
        let fileStat: Stats;
        try {
          fileStat = await stat(fullPath);
        } catch {
          continue;
        }

        if (fileStat.isDirectory()) {
          await walk(fullPath);
        } else if (fileStat.isFile()) {
          if (includeGlob && !(await includeGlob.match(entry))) {
            continue;
          }
          await searchFile(fullPath);
        }
      }
    };

    const searchFile = async (filePath: string): Promise<void> => {
      try {
        const content = await readFile(filePath, "utf-8");
        const lines = content.split("\n");
        const rel = relative(ctx.workDir, filePath);

        for (let i = 0; i < lines.length && results.length < MAX_RESULTS; i++) {
          if (regex.test(lines[i])) {
            results.push(`${rel}:${String(i + 1)}:${lines[i]}`);
          }
        }
      } catch {
        // skip binary or unreadable files
      }
    };

    try {
      const pathStat = await stat(searchPath);
      if (pathStat.isFile()) {
        await searchFile(searchPath);
      } else {
        await walk(searchPath);
      }
    } catch (err) {
      return {
        output: `Error: ${asErrorString(err)}`,
        isError: true,
      };
    }

    if (results.length === 0) {
      return { output: "No matches found.", isError: false };
    }

    let output = results.join("\n");
    if (results.length >= MAX_RESULTS) {
      output += `\n\n(results truncated at ${String(MAX_RESULTS)} matches)`;
    }
    return { output, isError: false };
  }
}
