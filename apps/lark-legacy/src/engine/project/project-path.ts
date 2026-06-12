import { mkdir } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { CliError, ErrorCode } from "../errors.js";

export const resolveInsideBase = (baseDir: string, relativePath: string): string => {
  if (relativePath.trim().length === 0) {
    throw new CliError(ErrorCode.ParamsError, "Path cannot be empty");
  }
  if (relativePath.startsWith("/") || relativePath.startsWith("\\")) {
    throw new CliError(ErrorCode.ParamsError, "Absolute paths are not allowed");
  }
  const base = resolve(baseDir);
  const target = resolve(base, relativePath);
  if (target !== base && !target.startsWith(`${base}${sep}`)) {
    throw new CliError(ErrorCode.ParamsError, "Path traversal is not allowed");
  }
  return target;
};

export const ensureParentDir = async (filePath: string): Promise<void> => {
  await mkdir(dirname(filePath), { recursive: true });
};

export const buildCodeOutputDir = (
  rootDir: string,
  codegenType: string,
  projectName: string,
): string => resolve(rootDir, "tmp", `${codegenType}_${projectName}`);
