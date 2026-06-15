// lark CLI entry: parse subcommands and dispatch execution
import process from "node:process";

import { version } from "../index.js";
import { getConfig } from "../core/config.js";
import { setupLogging } from "../core/logging.js";
import { cmdPing } from "../core/commands/ping.js";
import { cmdVersion } from "./commands/version.js";
import { cmdCoreStart, cmdCoreStop, cmdCoreStatus } from "./commands/core.js";
import { cmdRun } from "./commands/run.js";
import { cmdChat } from "./commands/chat.js";
import { cmdTrace } from "./commands/trace.js";
import { launchTUI } from "../tui/index.js";

// Print help information
function printHelp(): void {
  console.log(`lark ${version} - LarkCode CLI

Usage:
  lark <command> [options]

Commands:
  ping                Ping the core daemon
  version             Print version
  core start          Start the core daemon
  core stop           Stop the core daemon
  core status         Show daemon status
  run <goal>          Run a one_shot agent task
  chat                Start an interactive chat session
  tui                 Launch the terminal UI
  trace [run_id]      Display daemon trace log

Options:
  --help, -h          Show this help
  --version, -V       Print version

Examples:
  lark ping
  lark core start
  lark run "Summarize the project README"
  lark chat
  lark trace --layer llm`);
}

// Parse command-line arguments and dispatch to corresponding subcommand
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }

  if (args.includes("--version") || args.includes("-V")) {
    cmdVersion();
    return;
  }

  const config = getConfig();
  setupLogging(config);
  const subcommand = args[0];

  switch (subcommand) {
    case "ping":
      await cmdPing(config);
      break;

    case "version":
      cmdVersion();
      break;

    case "core": {
      const coreSubcommand = args[1];
      switch (coreSubcommand) {
        case "start":
          cmdCoreStart(config);
          break;
        case "stop":
          cmdCoreStop(config);
          break;
        case "status":
          await cmdCoreStatus(config);
          break;
        default:
          console.error(`Unknown core subcommand: ${coreSubcommand}`);
          printHelp();
          process.exit(1);
      }
      break;
    }

    case "run": {
      const goal = args.slice(1).join(" ");
      if (!goal) {
        console.error("Error: run command requires a goal argument");
        console.error("Usage: lark run <goal>");
        process.exit(1);
      }
      await cmdRun(goal, config);
      break;
    }

    case "chat":
      await cmdChat(config);
      break;

    case "tui":
      await launchTUI();
      break;

    case "trace": {
      const runId = args[1] ?? null;
      const layerIdx = args.indexOf("--layer");
      const directionIdx = args.indexOf("--direction");
      const raw = args.includes("--raw");
      const follow = args.includes("--follow") || args.includes("-f");
      const layer = layerIdx >= 0 ? args[layerIdx + 1] : undefined;
      const direction = directionIdx >= 0 ? args[directionIdx + 1] : undefined;
      const options: {
        layer?: string;
        direction?: string;
        raw?: boolean;
        follow?: boolean;
      } = {};
      if (layer) options.layer = layer;
      if (direction) options.direction = direction;
      if (raw) options.raw = true;
      if (follow) options.follow = true;
      cmdTrace(runId, config, options);
      break;
    }

    default:
      console.error(`Unknown command: ${subcommand}`);
      printHelp();
      process.exit(1);
  }
}

const isDirectRun = process.argv[1].endsWith("/main.ts") || process.argv[1].endsWith("/main.js");

if (isDirectRun) {
  void main();
}
