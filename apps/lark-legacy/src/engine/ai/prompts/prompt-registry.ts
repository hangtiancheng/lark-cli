import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { CodegenType } from "../../codegen-type.js";
import { CodegenType as CT } from "../../codegen-type.js";

const findPromptsDir = (): string => {
  const file = fileURLToPath(import.meta.url);
  let dir = dirname(file);
  return join(dir, "md");
};

const promptsDir = findPromptsDir();

const readPrompt = (filename: string): string => readFileSync(join(promptsDir, filename), "utf-8");

export const SYSTEM_PROMPTS: Readonly<Record<CodegenType, string>> = {
  [CT.MULTI_FILES]: readPrompt("multi-files-system-prompt.md"),
  [CT.VANILLA_HTML]: readPrompt("vanilla-html-system-prompt.md"),
  [CT.VITE_PROJECT]: readPrompt("vite-project-system-prompt.md"),
};

export const ROUTE_SYSTEM_PROMPT: string = readPrompt("route-system-prompt.md");

export const CODE_QUALITY_CHECK_SYSTEM_PROMPT =
  "You are a frontend master, review the generated code.";

export const getSystemPrompt = (codegenType: CodegenType): string => SYSTEM_PROMPTS[codegenType];
