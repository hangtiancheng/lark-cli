import { mkdir, writeFile } from "node:fs/promises";
import type { CodegenType } from "../codegen-type.js";
import type { ParsedProject } from "./code-parser.js";
import { buildCodeOutputDir, ensureParentDir, resolveInsideBase } from "./project-path.js";

export type SaveProjectInput = Readonly<{
  codegenType: CodegenType;
  parsedProject: ParsedProject;
  projectName: string;
  rootDir?: string;
}>;

export type SaveProjectResult = Readonly<{
  outputDir: string;
  writtenFiles: readonly string[];
}>;

export const saveGeneratedProject = async (input: SaveProjectInput): Promise<SaveProjectResult> => {
  const rootDir = input.rootDir ?? process.cwd();
  const outputDir = buildCodeOutputDir(rootDir, input.codegenType, input.projectName);
  await mkdir(outputDir, { recursive: true });
  const writtenFiles: string[] = [];
  for (const file of input.parsedProject.files) {
    const target = resolveInsideBase(outputDir, file.filename);
    await ensureParentDir(target);
    await writeFile(target, file.content, "utf-8");
    writtenFiles.push(file.filename);
  }
  return { outputDir, writtenFiles };
};
