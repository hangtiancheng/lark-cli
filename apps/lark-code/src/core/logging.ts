// Initialize pino logger from config (pino v10: multistream supports formatters, transport.targets does not)
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import pino from "pino";

import type { LarkConfig } from "./config.js";

type PinoLevel = "fatal" | "error" | "warn" | "info" | "debug" | "trace";

// Valid pino log level set
const VALID_LEVELS = new Set<string>([
  "fatal",
  "error",
  "warn",
  "info",
  "debug",
  "trace",
]);

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

// Create and return pino logger instance from config
export function setupLogging(config: LarkConfig): pino.Logger {
  const level = toPinoLevel(config.logging.level);
  const isJson = config.logging.format === "json";

  const streams: pino.StreamEntry[] = [
    // stderr output
    { stream: process.stderr, level },
  ];

  // Optional file output (pino.destination provides high-performance sync writing)
  if (config.logging.file) {
    const logPath = expandUser(config.logging.file);
    mkdirSync(path.dirname(logPath), { recursive: true });
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
