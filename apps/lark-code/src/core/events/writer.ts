// EventWriter: Serialize events to JSONL and append to file
import { mkdirSync, appendFileSync } from "node:fs";
import path from "node:path";

import type { Event } from "../bus/events.js";
import type { EventBus } from "./bus.js";

export class EventWriter {
  private _path: string;
  private _opened = false;

  constructor(filePath: string) {
    this._path = filePath;
  }

  // Open event file (create directory)
  open(): void {
    mkdirSync(path.dirname(this._path), { recursive: true });
    this._opened = true;
  }

  // Close event file
  close(): void {
    this._opened = false;
  }

  // Support Symbol.asyncDispose (TypeScript 5.2+ using syntax)
  [Symbol.asyncDispose](): void {
    this.close();
  }

  // Serialize event as JSON line and append to file; silently skip on write failure
  handle(event: Event): void {
    if (!this._opened) return;
    try {
      appendFileSync(this._path, JSON.stringify(event) + "\n", "utf-8");
    } catch {
      // Silently skip on write failure
    }
  }

  // Register handle as a bus subscriber
  subscribe(bus: EventBus): void {
    bus.subscribe(async (event) => {
      await Promise.resolve();
      this.handle(event);
    });
  }
}
