// CLI run command: one_shot agent task runner with event streaming
import process from "node:process";

import type { LarkConfig } from "../../core/config.js";
import { SocketClient } from "../../core/transport/socket-client.js";

export class StdoutPrinter {
  private _inline = false;
  private _runStart = 0;
  private _write: (chunk: string) => void;

  constructor(write?: (chunk: string) => void) {
    this._write =
      write ??
      ((chunk: string) => {
        process.stdout.write(chunk);
      });
  }

  handle(event: Record<string, unknown>): void {
    const eventType = event["type"];
    switch (eventType) {
      case "run.started":
        this._runStart = Date.now();
        console.log(`[run] ${String(event["run_id"])}`);
        break;
      case "step.started":
        this._ensureNewline();
        console.log(`[step ${String(event["step"])}] planning...`);
        break;
      case "llm.token":
        this._write(String(event["token"]));
        this._inline = true;
        break;
      case "tool.call_started":
        this._ensureNewline();
        console.log(`[tool] ${String(event["tool_name"])}`);
        break;
      case "tool.call_finished":
        this._ensureNewline();
        console.log(
          `[tool] ${String(event["tool_name"])} ok ${String(event["elapsed_ms"])}ms`,
        );
        break;
      case "tool.call_failed":
        this._ensureNewline();
        console.error(
          `[tool] ${String(event["tool_name"])} FAIL ${String(event["error_message"])}`,
        );
        break;
      case "step.finished":
        this._ensureNewline();
        console.log(`[step ${String(event["step"])}] done`);
        break;
      case "run.finished": {
        this._ensureNewline();
        const elapsed = ((Date.now() - this._runStart) / 1000).toFixed(1);
        console.log(
          `[run] ${String(event["status"])} ${String(event["steps"])} steps ${elapsed}s`,
        );
        break;
      }
    }
  }

  private _ensureNewline(): void {
    if (this._inline) {
      this._write("\n");
      this._inline = false;
    }
  }
}

export async function cmdRun(goal: string, config: LarkConfig): Promise<void> {
  const client = new SocketClient(config.host, config.port);
  await client.connect();

  const printer = new StdoutPrinter();
  let exitCode = 0;

  const finished = new Promise<void>((resolve) => {
    client.onEvent((event) => {
      printer.handle(event);
      const eventType = event["type"];
      if (eventType === "run.finished") {
        if (event["status"] !== "success") exitCode = 1;
        resolve();
      }
      return Promise.resolve();
    });
  });

  // Start event loop
  void client.runEventLoop();

  // Subscribe to relevant events
  await client.sendCommand("event.subscribe", {
    topics: ["run.*", "step.*", "tool.*", "llm.token", "llm.usage"],
    scope: "global",
  });

  // Start agent run
  await client.sendCommand("agent.run", { goal });

  // Wait for completion
  await finished;

  client.close();
  process.exit(exitCode);
}
