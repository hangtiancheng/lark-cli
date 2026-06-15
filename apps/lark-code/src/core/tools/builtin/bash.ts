// BashTool: execute shell commands with timeout and output truncation
import { spawn } from "node:child_process";

import { z } from "zod";

import type { BaseTool, ToolResult } from "../base.js";
import { toolError, toolSuccess } from "../base.js";

const MAX_OUTPUT_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT = 60;

export const BashParamsSchema = z.object({
  command: z.string().describe("Shell command to execute."),
  timeout: z
    .number()
    .int()
    .min(1)
    .max(120)
    .default(DEFAULT_TIMEOUT)
    .describe("Maximum seconds to wait (default 60, max 120)."),
});

export class BashTool implements BaseTool {
  readonly name = "bash";
  readonly description =
    "Execute a shell command and return its output (stdout + stderr combined). " +
    "Non-interactive only -- commands requiring user input will hang and time out. " +
    "Prefer short, focused commands. Output is truncated at 64 KB.";
  readonly inputSchema = {
    type: "object" as const,
    properties: {
      command: { type: "string", description: "Shell command to execute." },
      timeout: {
        type: "integer",
        description: "Maximum seconds to wait (default 60, max 120).",
      },
    },
    required: ["command"],
  };
  readonly paramsModel = BashParamsSchema;

  async invoke(params: Record<string, unknown>): Promise<ToolResult> {
    const parsed = BashParamsSchema.parse(params);
    const { command, timeout } = parsed;

    return new Promise<ToolResult>((resolve) => {
      const proc = spawn("sh", ["-c", command], {
        stdio: ["ignore", "pipe", "pipe"],
      });

      let output = "";
      let killed = false;

      const timer = setTimeout(() => {
        killed = true;
        proc.kill("SIGTERM");
      }, timeout * 1000);

      const collectOutput = (chunk: Buffer): void => {
        output += chunk.toString("utf-8");
      };

      proc.stdout.on("data", collectOutput);
      proc.stderr.on("data", collectOutput);

      proc.on("error", (err: Error) => {
        clearTimeout(timer);
        resolve(toolError(String(err), "runtime_error"));
      });

      proc.on("close", (code) => {
        clearTimeout(timer);

        if (killed) {
          resolve(toolError(`[timeout after ${String(timeout)}s]`, "timeout"));
          return;
        }

        // Truncate output if needed
        if (Buffer.byteLength(output, "utf-8") > MAX_OUTPUT_BYTES) {
          const buf = Buffer.from(output, "utf-8");
          output = buf.subarray(0, MAX_OUTPUT_BYTES).toString("utf-8") + "\n[truncated]";
        }

        if (code !== 0) {
          resolve(toolError(`[exit ${String(code)}]\n${output}`, "runtime_error"));
          return;
        }

        if (output === "") {
          resolve(toolSuccess("[no output]"));
          return;
        }

        resolve(toolSuccess(output));
      });
    });
  }
}
