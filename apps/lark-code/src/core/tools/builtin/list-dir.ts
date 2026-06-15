// ListDirTool: recursive directory listing with tree formatting and limits
import { readdirSync, statSync } from "node:fs";
import path from "node:path";

import { z } from "zod";

import type { BaseTool, ToolResult } from "../base.js";
import { toolSuccess } from "../base.js";

const MAX_DEPTH = 4;
const MAX_ENTRIES = 200;

export const ListDirParamsSchema = z.object({
  path: z.string().default(".").describe("Relative path to the directory (default '.')."),
  max_depth: z
    .number()
    .int()
    .min(1)
    .max(MAX_DEPTH)
    .default(2)
    .describe(`How many levels deep to recurse (default 2, max ${String(MAX_DEPTH)}).`),
});

interface DirEntry {
  name: string;
  isDir: boolean;
}

export class ListDirTool implements BaseTool {
  readonly name = "list_dir";
  readonly description =
    "List the contents of a directory as a tree. " +
    "Path must be relative to the current working directory. " +
    "Hidden entries (starting with .) are included. " +
    `Maximum depth is ${String(MAX_DEPTH)}, maximum total entries is ${String(MAX_ENTRIES)}.`;
  readonly inputSchema = {
    type: "object" as const,
    properties: {
      path: {
        type: "string",
        description: "Relative path to the directory (default '.').",
      },
      max_depth: {
        type: "integer",
        description: `How many levels deep to recurse (default 2, max ${String(MAX_DEPTH)}).`,
      },
    },
    required: [],
  };
  readonly paramsModel = ListDirParamsSchema;

  invoke(params: Record<string, unknown>): Promise<ToolResult> {
    const parsed = ListDirParamsSchema.parse(params);
    const rootPath = parsed.path;
    const maxDepth = parsed.max_depth;

    // Path traversal check: reject raw path components before normalize
    if (rootPath.split(path.sep).includes("..")) {
      throw new Error(`path traversal not allowed: ${rootPath}`);
    }

    const root = path.resolve(rootPath);
    const rootStat = statSync(root);
    if (!rootStat.isDirectory()) {
      throw new Error(`not a directory: ${rootPath}`);
    }

    const lines: string[] = [root + "/"];
    let count = 0;

    const walk = (dir: string, depth: number, prefix: string): void => {
      if (depth > maxDepth || count >= MAX_ENTRIES) return;

      let entries: DirEntry[];
      try {
        const raw = readdirSync(dir);
        entries = raw
          .map((name) => {
            try {
              const st = statSync(path.join(dir, name));
              return { name, isDir: st.isDirectory() };
            } catch {
              return { name, isDir: false };
            }
          })
          .sort((a, b) => {
            if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
            return a.name.localeCompare(b.name);
          });
      } catch {
        return;
      }

      for (const [i, entry] of entries.entries()) {
        if (count >= MAX_ENTRIES) {
          lines.push(`${prefix}... (truncated)`);
          return;
        }

        const isLast = i === entries.length - 1;
        const connector = isLast ? "└── " : "├── ";
        const suffix = entry.isDir ? "/" : "";
        lines.push(`${prefix}${connector}${entry.name}${suffix}`);
        count++;

        if (entry.isDir && depth < maxDepth) {
          const childPrefix = isLast ? `${prefix}    ` : `${prefix}│   `;
          walk(path.join(dir, entry.name), depth + 1, childPrefix);
        }
      }
    };

    walk(root, 1, "");
    return Promise.resolve(toolSuccess(lines.join("\n")));
  }
}
