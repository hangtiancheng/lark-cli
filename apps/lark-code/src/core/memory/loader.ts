// load_context_file: Read context.md file with ~ expansion and whitespace trim
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

// Read context file content, expanding ~ to home dir and trimming whitespace;
// returns empty string if not found or unreadable
export function loadContextFile(filePath: string): string {
  const expanded = filePath.startsWith("~/") ? path.join(homedir(), filePath.slice(2)) : filePath;
  if (!existsSync(expanded)) return "";
  try {
    return readFileSync(expanded, "utf-8").trim();
  } catch {
    return "";
  }
}
