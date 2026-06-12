import { exec } from "node:child_process";
import { tool } from "@langchain/core/tools";
import { shellExecInputSchema } from "./shell-tool-schemas.js";

const TIMEOUT_MS = 30_000;
const MAX_BUFFER = 1024 * 1024;

const DANGEROUS_PATTERNS: ReadonlyArray<RegExp> = [
  /\brm\s+-[^\s]*r[^\s]*f\s+\//u,
  /\bdd\s+.*of=\/dev\//u,
  /\bmkfs\b/u,
  new RegExp(":\\(\\)\\{\\s*:\\|:&\\s*\\};:", "u"),
  /\bfork\s+bomb/iu,
];

function isDangerous(command: string): boolean {
  return DANGEROUS_PATTERNS.some((p) => p.test(command));
}

function execShell(command: string, cwd?: string): Promise<string> {
  return new Promise((resolve) => {
    if (isDangerous(command)) {
      resolve("Error: command rejected as potentially dangerous");
      return;
    }
    exec(
      command,
      {
        cwd: cwd ?? process.cwd(),
        timeout: TIMEOUT_MS,
        maxBuffer: MAX_BUFFER,
        shell: process.env.SHELL ?? "/bin/zsh",
      },
      (error, stdout, stderr) => {
        if (error) {
          resolve(`Exit code: ${error.code ?? 1}\nstdout:\n${stdout}\nstderr:\n${stderr}`);
          return;
        }
        const output = [stdout, stderr].filter(Boolean).join("\n");
        resolve(output || "(no output)");
      },
    );
  });
}

export const createShellTool = () =>
  tool((input) => execShell(input.command, input.cwd), {
    description:
      "Execute a shell command (bash/zsh) and return stdout + stderr. Use for installing dependencies, running builds, listing files, etc.",
    name: "ShellExec",
    schema: shellExecInputSchema,
  });
