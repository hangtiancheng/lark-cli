// load_context_file: Read context.md file
import { existsSync, readFileSync } from "node:fs";

// Read context.md file content, return empty string if not found
export function loadContextFile(filePath: string): string {
  if (!existsSync(filePath)) return "";
  try {
    return readFileSync(filePath, "utf-8");
  } catch {
    return "";
  }
}
