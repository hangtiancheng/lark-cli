// Initialize pino logger from config with file rotation support
// (pino v10: multistream supports formatters, transport.targets does not)
import { existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import pino from "pino";

import type { LarkConfig } from "./config.js";

type PinoLevel = "fatal" | "error" | "warn" | "info" | "debug" | "trace";

// Log rotation settings (matches Python RotatingFileHandler: 10MB, 5 backups)
const MAX_LOG_BYTES = 10 * 1024 * 1024;
const MAX_BACKUPS = 5;

// Valid pino log level set
const VALID_LEVELS = new Set<string>(["fatal", "error", "warn", "info", "debug", "trace"]);

// Convert config level string to pino-compatible PinoLevel
function toPinoLevel(raw: string): PinoLevel {
  const lower = raw.toLowerCase();
  // Python logging uses WARNING; pino uses warn — map accordingly
  if (lower === "warning") return "warn";
  if (VALID_LEVELS.has(lower)) {
    const levels: Record<string, PinoLevel> = {
      fatal: "fatal",
      error: "error",
      warn: "warn",
      info: "info",
      debug: "debug",
      trace: "trace",
    };
    return levels[lower] ?? "info";
  }
  return "info";
}

// Expand ~ to user home directory
function expandUser(p: string): string {
  if (p.startsWith("~/")) {
    return path.join(homedir(), p.slice(2));
  }
  return p;
}

// Rotate log file if it exceeds MAX_LOG_BYTES, shifting backups .1 through .5
function rotateFile(logPath: string): void {
  if (!existsSync(logPath)) return;
  try {
    const stat = statSync(logPath);
    if (stat.size < MAX_LOG_BYTES) return;
  } catch {
    return;
  }
  for (let i = MAX_BACKUPS; i >= 1; i--) {
    const src = i === 1 ? logPath : `${logPath}.${String(i - 1)}`;
    const dest = `${logPath}.${String(i)}`;
    try {
      renameSync(src, dest);
    } catch {
      // Skip missing files or permission errors during rotation
    }
  }
}

// Create and return pino logger instance from config
export function setupLogging(config: LarkConfig): pino.Logger {
  const level = toPinoLevel(config.logging.level);
  const isJson = config.logging.format === "json";

  const streams: pino.StreamEntry[] = [
    // stderr output
    { stream: process.stderr, level },
  ];

  // Optional file output with rotation (matches Python RotatingFileHandler)
  if (config.logging.file) {
    const logPath = expandUser(config.logging.file);
    mkdirSync(path.dirname(logPath), { recursive: true });
    rotateFile(logPath);
    streams.push({
      stream: pino.destination({ dest: logPath, append: true, mkdir: true }),
      level,
    });
  }

  const logger = pino(
    {
      level,
      ...(isJson
        ? {}
        : {
            formatters: {
              level(label: string) {
                return { level: label };
              },
            },
            messageKey: "msg",
            timestamp: pino.stdTimeFunctions.isoTime,
          }),
    },
    pino.multistream(streams),
  );

  return logger;
}
