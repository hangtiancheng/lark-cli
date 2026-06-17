import type { FileHistory } from "../file-history/file-history.js";

export type ToolCategory = "read" | "write" | "command"

export interface ToolResult {
  output: string;
  isError: boolean;
}

export interface ToolContext {
  workDir: string;
  abortSignal?: AbortSignal
  fileHistory: FileHistory;
  fileStateCache: FileStateCache;
}
