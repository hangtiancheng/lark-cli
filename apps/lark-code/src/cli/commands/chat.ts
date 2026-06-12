// CLI chat command: multi-turn interactive chat session with permission prompts
import process from "node:process";
import readline from "node:readline";

import type { LarkConfig } from "../../core/config.js";
import { SocketClient } from "../../core/transport/socket-client.js";

const DECISION_MAP: Record<string, string> = {
  y: "allow_once",
  a: "always_allow",
  n: "deny_once",
  d: "always_deny",
};

class ChatPrinter {
  private _inline = false;
  pendingPermissionId: string | null = null;

  handle(event: Record<string, unknown>): void {
    const eventType = event["type"];
    switch (eventType) {
      case "llm.token":
        process.stdout.write(String(event["token"]));
        this._inline = true;
        break;
      case "tool.call_started":
        this._ensureNewline();
        console.log(`[tool] ${String(event["tool_name"])}`);
        break;
      case "permission.requested": {
        this._ensureNewline();
        console.log(
          `[permission] ${String(event["tool_name"])} ${String(event["params_preview"])}`,
        );
        console.log(
          "  [y] allow once  [a] always allow  [n] deny once  [d] always deny",
        );
        const toolUseId = event["tool_use_id"];
        this.pendingPermissionId =
          typeof toolUseId === "string" ? toolUseId : null;
        break;
      }
      case "session.waiting_for_input":
        this._ensureNewline();
        this.pendingPermissionId = null;
        console.log("[waiting for input]");
        break;
      case "session.closed":
        this._ensureNewline();
        console.log("session closed.");
        break;
    }
  }

  private _ensureNewline(): void {
    if (this._inline) {
      process.stdout.write("\n");
      this._inline = false;
    }
  }
}

function readlinePrompt(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

export async function cmdChat(config: LarkConfig): Promise<void> {
  const client = new SocketClient(config.host, config.port);
  await client.connect();

  const printer = new ChatPrinter();
  client.onEvent((event) => {
    printer.handle(event);
    return Promise.resolve();
  });

  // Start event loop
  void client.runEventLoop();

  // Subscribe to relevant events
  await client.sendCommand("event.subscribe", {
    topics: ["session.*", "run.*", "tool.*", "llm.token", "permission.*"],
    scope: "global",
  });

  // Create chat session
  const createResult = await client.sendCommand("session.create", {
    mode: "chat",
  });
  const sessionId = String(createResult["session_id"]);
  console.log(`[session: ${sessionId}]`);

  try {
    for (;;) {
      const line = await readlinePrompt("> ");
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Handle permission response
      if (printer.pendingPermissionId) {
        const decision = DECISION_MAP[trimmed];
        if (!decision) {
          console.log("Invalid decision. Use: y, a, n, d");
          continue;
        }
        await client.sendCommand("permission.respond", {
          tool_use_id: printer.pendingPermissionId,
          decision,
        });
        printer.pendingPermissionId = null;
        continue;
      }

      // Normal chat message
      await client.sendCommand("session.send_message", {
        session_id: sessionId,
        content: trimmed,
      });
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("readline")) {
      // User sent EOF (Ctrl+D) - normal exit
    } else {
      throw error;
    }
  } finally {
    // Close session
    await client.sendCommand("session.close", { session_id: sessionId });
    client.close();
  }
}
