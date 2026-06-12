// Run ID generation and run directory management
import { mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export const RUNS_DIR = path.join("runs");

// Return the directory path for a given run ID
export function runDir(runId: string): string {
  return path.join(RUNS_DIR, runId);
}

// Return the events log file path for a given run ID
export function eventsFile(runId: string): string {
  return path.join(runDir(runId), "events.jsonl");
}

// Generate a unique run ID in format YYYYMMDD-HHMMSS-xxxxxx
export function newRunId(): string {
  const now = new Date();
  const ts = [
    now.getUTCFullYear().toString(),
    String(now.getUTCMonth() + 1).padStart(2, "0"),
    String(now.getUTCDate()).padStart(2, "0"),
    "-",
    String(now.getUTCHours()).padStart(2, "0"),
    String(now.getUTCMinutes()).padStart(2, "0"),
    String(now.getUTCSeconds()).padStart(2, "0"),
  ].join("");
  const suffix = randomUUID().replace(/-/g, "").slice(0, 6);
  return `${ts}-${suffix}`;
}

// Create the run directory (including parent directories) and return the path
export function ensureRunDir(runId: string): string {
  const dir = runDir(runId);
  mkdirSync(dir, { recursive: true });
  return dir;
}
