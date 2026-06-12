// CLI trace command: display daemon trace log with filtering and color output
import { readFileSync, statSync, createReadStream } from "node:fs";
import { homedir } from "node:os";
import readline from "node:readline";

import type { LarkConfig } from "../../core/config.js";
import { isRecord } from "../../core/bus/envelope.js";

const COLORS: Record<string, string> = {
  "CLIENT→CORE": "\x1b[36m", // cyan
  "CORE→CLIENT": "\x1b[33m", // yellow
  CORE: "\x1b[32m", // green
  "CORE→LLM": "\x1b[35m", // magenta
  "LLM→CORE": "\x1b[34m", // blue
};
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";

interface TraceRecord {
  ts: string;
  direction: string;
  layer: string;
  kind: string;
  run_id: string | null;
  step: number | null;
  client_id: string | null;
  data: Record<string, unknown>;
}

function str(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return JSON.stringify(v ?? "");
}

function summarize(record: TraceRecord): string {
  const data = record.data;
  const kind = record.kind;

  if (kind === "command") {
    const params = isRecord(data["params"]) ? data["params"] : {};
    const goal = typeof params["goal"] === "string" ? params["goal"] : "";
    const suffix = goal ? `  goal="${goal.slice(0, 50)}"` : "";
    return `method=${str(data["method"])}${suffix}`;
  }

  if (kind === "response") {
    const result = data["result"];
    if (isRecord(result) && typeof result["run_id"] === "string") {
      return `run_id=${result["run_id"].slice(0, 8)}`;
    }
    return JSON.stringify(result ?? "").slice(0, 60);
  }

  if (kind === "error") {
    const err = isRecord(data["error"]) ? data["error"] : {};
    return `code=${str(err["code"])}  ${str(err["message"])}`;
  }

  if (kind === "push") {
    return `event=${str(data["event_type"])}  sub=${str(data["sub_id"])}`;
  }

  if (kind === "event") {
    return `type=${str(data["type"])}`;
  }

  if (kind === "api_call") {
    const msgs = data["messages"];
    const count = Array.isArray(msgs)
      ? msgs.length
      : typeof data["message_count"] === "number"
        ? data["message_count"]
        : "?";
    const tools = data["tool_schemas"];
    const tc = Array.isArray(tools)
      ? tools.length
      : typeof data["tool_count"] === "number"
        ? data["tool_count"]
        : "?";
    return `msgs=${String(count)}  tools=${String(tc)}`;
  }

  if (kind === "api_response") {
    const usage = isRecord(data["usage"]) ? data["usage"] : {};
    const outTokens =
      typeof usage["output_tokens"] === "number" ? usage["output_tokens"] : "?";
    return `stop=${str(data["stop_reason"])}  latency=${str(data["latency_ms"])}ms  out_tokens=${String(outTokens)}`;
  }

  return JSON.stringify(data).slice(0, 60);
}

function printRecord(record: TraceRecord): void {
  const color = COLORS[record.direction] ?? "";
  const ts = record.ts.length >= 23 ? record.ts.slice(11, 23) : record.ts;
  const direction = record.direction.padEnd(14);
  const kind = record.kind.padEnd(13);
  const runId = record.run_id ? `run=${record.run_id.slice(0, 8)}` : "";
  const step = record.step !== null ? `step=${String(record.step)}` : "";
  const summary = summarize(record);

  console.log(
    `${ts}  ${color}${BOLD}${direction}${RESET}  ${kind}  ${[runId, step, summary].filter(Boolean).join("  ")}`,
  );
}

function processLine(
  line: string,
  runId: string | null,
  layer: string | undefined,
  direction: string | undefined,
  raw: boolean,
): void {
  if (!line.trim()) return;
  try {
    const parsed: unknown = JSON.parse(line);
    if (!isRecord(parsed)) return;
    if (
      typeof parsed["ts"] !== "string" ||
      typeof parsed["direction"] !== "string" ||
      typeof parsed["layer"] !== "string" ||
      typeof parsed["kind"] !== "string" ||
      !isRecord(parsed["data"])
    )
      return;

    const record: TraceRecord = {
      ts: parsed["ts"],
      direction: parsed["direction"],
      layer: parsed["layer"],
      kind: parsed["kind"],
      run_id: typeof parsed["run_id"] === "string" ? parsed["run_id"] : null,
      step: typeof parsed["step"] === "number" ? parsed["step"] : null,
      client_id:
        typeof parsed["client_id"] === "string" ? parsed["client_id"] : null,
      data: parsed["data"],
    };

    // Apply filters
    if (runId && record.run_id !== runId) return;
    if (layer && record.layer !== layer) return;
    if (direction && record.direction !== direction) return;

    if (raw) {
      console.log(line);
    } else {
      printRecord(record);
    }
  } catch {
    // Skip malformed lines
  }
}

export function cmdTrace(
  runId: string | null,
  config: LarkConfig,
  options?: {
    layer?: string;
    direction?: string;
    raw?: boolean;
    follow?: boolean;
  },
): void {
  const tracePath = config.trace.file.replace(/^~/, homedir());

  let exists = false;
  try {
    statSync(tracePath);
    exists = true;
  } catch {
    // File not found
  }

  if (!exists) {
    console.error(`trace file not found: ${tracePath}`);
    process.exit(1);
  }

  // Read and process existing content
  const content = readFileSync(tracePath, "utf-8");
  for (const line of content.split("\n")) {
    processLine(
      line,
      runId,
      options?.layer,
      options?.direction,
      options?.raw ?? false,
    );
  }

  // Follow mode: tail the file
  if (options?.follow) {
    const rl = readline.createInterface({
      input: createReadStream(tracePath, {
        start: statSync(tracePath).size,
      }),
    });

    rl.on("line", (line) => {
      processLine(
        line,
        runId,
        options.layer,
        options.direction,
        options.raw ?? false,
      );
    });

    // Keep process alive
    process.on("SIGINT", () => {
      rl.close();
      process.exit(0);
    });
  }
}
