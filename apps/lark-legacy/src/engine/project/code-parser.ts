import { z } from "zod";
import { CodegenType } from "../codegen-type.js";
import { CliError, ErrorCode } from "../errors.js";
import { extractMarkdownCodeBlocks } from "./markdown-code-blocks.js";
import { filenameFromFence, hasUnsupportedFileWriteOutput } from "./vite-project-output-format.js";

const fileWriteSchema = z.object({
  content: z.string(),
  filepath: z.string().min(1),
});

export const parsedProjectFileSchema = z.object({
  content: z.string(),
  filename: z.string().min(1),
});

export const parsedProjectSchema = z.object({
  files: z.array(parsedProjectFileSchema).min(1),
});

export type ParsedProject = z.infer<typeof parsedProjectSchema>;
export type ParsedProjectFile = z.infer<typeof parsedProjectFileSchema>;

const requireContent = (content: string): string => {
  const trimmed = content.trim();
  if (trimmed.length === 0) {
    throw new CliError(ErrorCode.ParamsError, "Generated content cannot be empty");
  }
  return trimmed;
};

const extractFencedCode = (
  content: string,
  languageNames: readonly string[],
): string | undefined => {
  const normalizedNames = new Set(languageNames.map((name) => name.toLowerCase()));
  for (const block of extractMarkdownCodeBlocks(content)) {
    if (normalizedNames.has(block.language.toLowerCase())) return block.body.trim();
  }
  return undefined;
};

const parseVanillaHtml = (content: string): ParsedProject => ({
  files: [
    {
      content: extractFencedCode(content, ["html"]) ?? requireContent(content),
      filename: "index.html",
    },
  ],
});

const parseMultiFiles = (content: string): ParsedProject => {
  const html = extractFencedCode(content, ["html"]);
  if (html === undefined) {
    throw new CliError(ErrorCode.ParamsError, "HTML code block is required");
  }
  return {
    files: [
      { content: html, filename: "index.html" },
      {
        content: extractFencedCode(content, ["css"]) ?? "",
        filename: "index.css",
      },
      {
        content: extractFencedCode(content, ["js", "javascript"]) ?? "",
        filename: "index.js",
      },
    ],
  };
};

const parseFileWriteBlock = (body: string): ParsedProjectFile | undefined => {
  const raw: unknown = JSON.parse(body);
  const parsed = fileWriteSchema.parse(raw);
  return { content: parsed.content, filename: parsed.filepath };
};

const parseViteProject = (content: string): ParsedProject => {
  const files: ParsedProjectFile[] = [];
  const invalidJsonBlocks: string[] = [];
  for (const { body, language, meta } of extractMarkdownCodeBlocks(content)) {
    const filename = filenameFromFence(language, meta);
    if (filename !== undefined) {
      files.push({ content: body.trim(), filename });
      continue;
    }
    if (language.toLowerCase() === "json") {
      try {
        const file = parseFileWriteBlock(body);
        if (file !== undefined) files.push(file);
      } catch (error) {
        invalidJsonBlocks.push(error instanceof Error ? error.message : String(error));
      }
    }
  }
  if (invalidJsonBlocks.length > 0) {
    throw new CliError(
      ErrorCode.ParamsError,
      `Invalid Vite project JSON file block: ${invalidJsonBlocks[0]}`,
    );
  }
  if (files.length === 0) {
    if (hasUnsupportedFileWriteOutput(content)) {
      throw new CliError(
        ErrorCode.ParamsError,
        "Unsupported Vite project FileWrite pseudo-code output",
      );
    }
    throw new CliError(ErrorCode.ParamsError, "Vite project output contains no files");
  }
  return { files };
};

export const parseGeneratedCode = (content: string, codegenType: CodegenType): ParsedProject => {
  switch (codegenType) {
    case CodegenType.VANILLA_HTML:
      return parseVanillaHtml(content);
    case CodegenType.MULTI_FILES:
      return parseMultiFiles(content);
    case CodegenType.VITE_PROJECT:
      return parseViteProject(content);
  }
};
