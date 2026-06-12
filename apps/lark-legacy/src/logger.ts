import { existsSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { resolve, join } from "node:path";
import pino from "pino";
import type { Level } from "pino";
import { getConfig } from "./config.js";

const MAX_LOG_FILES = 5;

function getLogDir(): string {
  const dir = resolve(getConfig().dataDir, "logs");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function buildLogFilePath(): string {
  const date = new Date().toISOString().slice(0, 10);
  return join(getLogDir(), `lark-cli-${date}.log`);
}

function pruneOldLogFiles(): void {
  const dir = getLogDir();
  const files = readdirSync(dir)
    .filter((f) => f.startsWith("lark-cli-") && f.endsWith(".log"))
    .sort()
    .reverse();
  for (const file of files.slice(MAX_LOG_FILES)) {
    unlinkSync(join(dir, file));
  }
}

let loggerInstance: pino.Logger | null = null;

export function initLogger(level: Level): pino.Logger {
  const logFile = buildLogFilePath();
  pruneOldLogFiles();

  const dest = pino.destination({ dest: logFile, mkdir: true, sync: false });
  loggerInstance = pino({ level }, dest);
  return loggerInstance;
}

export function getLogger(): pino.Logger {
  if (!loggerInstance) {
    return initLogger("info");
  }
  return loggerInstance;
}
