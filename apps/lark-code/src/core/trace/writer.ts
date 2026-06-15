// TraceWriter: synchronous appendFileSync for reliability and simplicity.
// Trace records are small (~200 bytes) and writes are sub-millisecond, so the
// blocking I/O cost is negligible. A true async queue would add complexity
// (drain lifecycle, unhandled rejection handling) without meaningful benefit.
// This matches the Python design intent while avoiding asyncio queue overhead.
import { mkdirSync, appendFileSync } from "node:fs";
import path from "node:path";

import type { TraceRecord } from "./record.js";

export class TraceWriter {
  private _path: string;
  private _stopped = false;

  // Initialize TraceWriter; target file path is not created until start()
  constructor(filePath: string) {
    this._path = filePath;
  }

  // Create directory and mark as started
  start(): void {
    mkdirSync(path.dirname(this._path), { recursive: true });
    this._stopped = false;
  }

  // Flush any remaining records and stop
  async stop(): Promise<void> {
    this._stopped = true;
    await Promise.resolve();
  }

  // Synchronously write a single trace record to file
  emit(record: TraceRecord): void {
    if (this._stopped) return;
    try {
      appendFileSync(this._path, JSON.stringify(record) + "\n", "utf-8");
    } catch {
      // Silently skip on write failure, do not block main flow
    }
  }
}
