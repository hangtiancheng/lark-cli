import { execSync } from "child_process";
import { safeParseAsync, z } from "zod";
import { BASH_DESCRIPTION } from "./descriptions.js";
import {
  type Tool,
  type ToolCategory,
  type ToolContext,
  type ToolResult,
  type ToolSchema,
} from "./types.js";
import { intArg, strArg } from "../utils/index.js";

const MAX_TIMEOUT = 600;

// Command exit code semantic mapping table:
// Some command use non-zero exit code to indicate normal result;

// e.g. grep returns when no match is found
// The value represents the minimum exit code threshold for determining a real error.

const commandErrorThresholds = new Map<string, number>([
  ["grep", 2], // exit 1 = no match found, not an error
  ["egrep", 2],
  ["fgrep", 2],
  ["rg", 2], // MacOS ripgrep shares the same exit code semantics as grep,
  ["diff", 2], // exit 1 = files differ, not an error
  ["test", 2], // exit 1 = condition is false, not an error
  ["find", 1],
]);

/**
 * Determines whether an exit code indicates an error based on command semantics.
 *
 * For piped commands, only the last segment is considered (as Bash defaults to returning the exit code of the last command in the pipeline)
 *
 */

function interpretExitCode(command: string, exitCode: number): boolean {
  // Split by pipeline operator and take the last command segment
  const lastSegment = command.split("|").pop()?.trim() ?? command;

  // Extract the base command name: skip env variable assignments and path prefixes
  const tokens = lastSegment.split(/\s+/);

  let baseCmd = "";
  for (const token of tokens) {
    // SKip env variable assignments like JANE=doe
    if (token.includes("=") && !token.startsWith("-")) {
      continue;
    }
    // Strip path prefixes and keep only the command name
    baseCmd = token.split("/").pop() ?? token;
    break;
  }

  const threshold = commandErrorThresholds.get(baseCmd);
  if (threshold !== undefined) {
    return exitCode >= threshold;
  }

  // Default rule: any non-zero exit code is considered an error
  return exitCode !== 0;
}

const BashErrorSchema = z.object({
  status: z.coerce.number().optional(),
  stdout: z.string().optional(),
  stderr: z.string().optional(),
  killed: z.boolean().optional(),
  message: z.string().optional(),
});

export class BashTool implements Tool {
  // Use a hardcoded string instead of BashTool.name.replace("Tool", "")
  // because class names are not stable after minification — bundlers like
  // Terser/esbuild may rename or mangle them, producing incorrect tool names at runtime.
  name = "Bash";

  description: string = BASH_DESCRIPTION;
  category: ToolCategory = "command";

  schema(): ToolSchema {
    const inputSchema = {
      type: "object" as const,
      properties: {
        command: {
          type: "string" as const,
          description: "Shell command to execute",
        },
        timeout: {
          type: "integer" as const,
          description: "Timeout in seconds (max 600)",
          default: 120,
        },
      },
      required: ["command"],
    };

    return {
      name: this.name,
      description: this.description,
      input_schema: inputSchema,
    };
  }

  async execute(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    // TODO: Migrate manual parse to zod.
    const command = strArg(args, "command");
    if (!command) {
      return {
        output: "Error: command is required",
        isError: true,
      };
    }

    let timeout = intArg(args, "timeout", 120);
    if (timeout > MAX_TIMEOUT) {
      timeout = MAX_TIMEOUT;
    }

    try {
      const result = execSync(command, {
        shell: "bash",
        cwd: ctx.workDir,
        timeout: timeout * 1000,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
        maxBuffer: 10 * 1024 * 1024,
      });

      return {
        output: `$ ${command}\n${result}(exit code 0)`,
        isError: false,
      };
    } catch (err) {
      const {
        success,
        data: errData,
        error: parseErr,
      } = await safeParseAsync(BashErrorSchema, err);
      if (!success) {
        return {
          output: `Error: execute error ${err instanceof Error ? err.message : String(err)}, parse error ${parseErr.message}`,
          isError: true,
        };
      }

      if (errData.killed) {
        return {
          output: `Error: command timeout after ${String(timeout)}s`,
          isError: true,
        };
      } // end if (errData.killed)

      const exitCode = errData.status ?? 1;
      let output = `$ ${command}\n`;
      if (errData.stdout) {
        output += `stdout: ${errData.stdout}\n`;
      }
      if (errData.stderr) {
        output += `stderr: ${errData.stderr}\n`;
      }
      output += `(exit code: ${String(exitCode)})`;
      return {
        output,
        isError: interpretExitCode(command, exitCode),
      };
    }
  }
}
