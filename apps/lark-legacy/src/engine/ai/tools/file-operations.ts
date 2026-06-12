import { existsSync } from "node:fs";
import { readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { resolveInsideBase, ensureParentDir } from "../../project/project-path.js";

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  ".next",
  ".nuxt",
  "build",
  ".cache",
  "coverage",
]);

const PROTECTED_FILES = new Set([
  "package.json",
  "vite.config.ts",
  "vite.config.js",
  "index.html",
  "tsconfig.json",
  "tsconfig.node.json",
]);

export const writeProjectFile = async (
  workDir: string,
  filepath: string,
  content: string,
): Promise<string> => {
  const fullPath = resolveInsideBase(workDir, filepath);
  await ensureParentDir(fullPath);
  await writeFile(fullPath, content, "utf-8");
  return `File written: ${filepath}`;
};

export const readProjectFile = async (workDir: string, filePath: string): Promise<string> => {
  const fullPath = resolveInsideBase(workDir, filePath);
  if (!existsSync(fullPath)) return `File not found: ${filePath}`;
  return readFile(fullPath, "utf-8");
};

export const modifyProjectFile = async (
  workDir: string,
  filePath: string,
  searchStr: string,
  replaceStr: string,
): Promise<string> => {
  const fullPath = resolveInsideBase(workDir, filePath);
  if (!existsSync(fullPath)) return `File not found: ${filePath}`;
  const content = await readFile(fullPath, "utf-8");
  if (!content.includes(searchStr)) return `Search string not found in file: ${filePath}`;
  await writeFile(fullPath, content.replace(searchStr, replaceStr), "utf-8");
  return `File modified: ${filePath}`;
};

export const deleteProjectFile = async (workDir: string, filePath: string): Promise<string> => {
  const fullPath = resolveInsideBase(workDir, filePath);
  const fileName = basename(filePath);
  if (PROTECTED_FILES.has(fileName)) return `Cannot delete protected file: ${fileName}`;
  if (!existsSync(fullPath)) return `File not found: ${filePath}`;
  await unlink(fullPath);
  return `File deleted: ${filePath}`;
};

const buildTree = async (dir: string, prefix: string, depth: number): Promise<string> => {
  if (depth >= 5) return "";
  const entries = await readdir(dir, { withFileTypes: true });
  const lines = await Promise.all(
    entries
      .filter((entry) => !entry.name.startsWith(".") && !IGNORED_DIRS.has(entry.name))
      .map(async (entry) => {
        const label = `${prefix}${entry.name}${entry.isDirectory() ? "/" : ""}\n`;
        if (!entry.isDirectory()) return label;
        return label + (await buildTree(join(dir, entry.name), `${prefix}  `, depth + 1));
      }),
  );
  return lines.join("");
};

export const readProjectDir = async (workDir: string, dirPath = "."): Promise<string> => {
  const target = resolveInsideBase(workDir, dirPath);
  if (!existsSync(target)) return `Directory not found: ${dirPath}`;
  return buildTree(target, "", 0);
};
