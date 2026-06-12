import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

export type CommandResult = Readonly<{
  exitCode: number | null;
  stderr: string;
  stdout: string;
  timedOut: boolean;
}>;

export type CommandRunner = (
  command: string,
  args: readonly string[],
  options: Readonly<{ cwd: string; timeoutMs: number }>,
) => Promise<CommandResult>;

export type BuildProjectResult = Readonly<{
  logs: string;
  success: boolean;
}>;

export const runCommand: CommandRunner = (command, args, options) =>
  new Promise((resolveCommand) => {
    const child = spawn(command, [...args], { cwd: options.cwd, shell: false });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolveCommand({ exitCode: null, stderr, stdout, timedOut: true });
    }, options.timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf-8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf-8");
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolveCommand({ exitCode, stderr, stdout, timedOut: false });
    });
  });

const npmCommand = (): string => (process.platform === "win32" ? "npm.cmd" : "npm");

export const buildViteProject = async (
  projectDir: string,
  runner: CommandRunner = runCommand,
): Promise<BuildProjectResult> => {
  if (!existsSync(projectDir)) {
    return { logs: "Project directory not found", success: false };
  }
  if (!existsSync(join(projectDir, "package.json"))) {
    return { logs: "package.json not found", success: false };
  }
  const install = await runner(npmCommand(), ["install"], {
    cwd: projectDir,
    timeoutMs: 300_000,
  });
  if (install.exitCode !== 0 || install.timedOut) {
    return { logs: `${install.stdout}${install.stderr}`, success: false };
  }
  const build = await runner(npmCommand(), ["run", "build"], {
    cwd: projectDir,
    timeoutMs: 180_000,
  });
  if (build.exitCode !== 0 || build.timedOut) {
    return {
      logs: `${install.stdout}${install.stderr}${build.stdout}${build.stderr}`,
      success: false,
    };
  }
  const logs = `${install.stdout}${install.stderr}${build.stdout}${build.stderr}`;
  return { logs, success: existsSync(join(projectDir, "dist")) };
};
