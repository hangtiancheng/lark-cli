/**
 * Terminal output manager.
 * Handles writing ANSI strings to stdout with incremental updates.
 * Uses ANSI escape codes to erase previous output and write new frames.
 *
 * Supports:
 * - Dynamic area: erased and rewritten on each frame
 * - Static area: written above dynamic area, never erased (scrollback)
 * - Synchronized output: BSU/ESU sequences to prevent terminal tearing
 */
import { stdout } from "process";

/** ANSI escape sequences */
const ESC = "\x1b";

/** Begin Synchronized Update (prevents tearing) */
const BSU = ESC + "P=1s" + ESC + "\\";

/** End Synchronized Update */
const ESU = ESC + "P=2s" + ESC + "\\";

/** Hide cursor */
const HIDE_CURSOR = ESC + "[?25l";

/** Show cursor */
const SHOW_CURSOR = ESC + "[?25h";

/** Number of lines in the previous dynamic output */
let previousLineCount = 0;

/** Whether synchronized output is supported */
let syncOutputSupported: boolean | undefined;

/** Erase N lines above cursor */
function eraseLines(count: number): string {
  if (count <= 0) {
    return "";
  }
  let result = "";
  for (let i = 0; i < count; i++) {
    if (i > 0) {
      result += ESC + "[1A";
    }
    result += ESC + "[2K";
  }
  if (count > 1) {
    result += ESC + "[" + String(count - 1) + "A";
  }
  return result;
}

/** Check if the terminal supports synchronized output */
function checkSyncOutput(): boolean {
  if (syncOutputSupported !== undefined) {
    return syncOutputSupported;
  }
  const term = process.env.TERM ?? "";
  const termProgram = process.env.TERM_PROGRAM ?? "";
  syncOutputSupported =
    termProgram === "iTerm.app" || termProgram === "WezTerm" || term === "xterm-kitty";
  return syncOutputSupported;
}

/** Count the number of lines in a string */
function countLines(str: string): number {
  if (!str) {
    return 0;
  }
  let count = 0;
  for (const char of str) {
    if (char === "\n") {
      count++;
    }
  }
  if (!str.endsWith("\n")) {
    count++;
  }
  return count;
}

/** Render a frame to stdout (erase previous + write new) */
export function renderFrame(output: string): void {
  const useSync = checkSyncOutput();
  let buf = "";

  if (useSync) {
    buf += BSU;
  }

  if (previousLineCount > 0) {
    buf += eraseLines(previousLineCount);
  }

  buf += output;

  if (useSync) {
    buf += ESU;
  }

  stdout.write(buf);
  previousLineCount = countLines(output);
}

/** Write static content above the dynamic area (scrollback) */
export function appendStatic(output: string): void {
  if (previousLineCount > 0) {
    stdout.write(eraseLines(previousLineCount));
  }

  stdout.write(output);
  if (!output.endsWith("\n")) {
    stdout.write("\n");
  }

  previousLineCount = 0;
}

/** Clear all dynamic output */
export function clearOutput(): void {
  if (previousLineCount > 0) {
    stdout.write(eraseLines(previousLineCount));
    previousLineCount = 0;
  }
}

/** Get the terminal width in columns */
export function getTerminalWidth(): number {
  return stdout.columns || 80;
}

/** Get the terminal height in rows */
export function getTerminalHeight(): number {
  return stdout.rows || 24;
}

/** Show the cursor (call on exit) */
export function showCursor(): void {
  stdout.write(SHOW_CURSOR);
}

/** Hide the cursor */
export function hideCursor(): void {
  stdout.write(HIDE_CURSOR);
}

/** Reset the line counter (e.g., after clearing the screen) */
export function resetLineCount(): void {
  previousLineCount = 0;
}
