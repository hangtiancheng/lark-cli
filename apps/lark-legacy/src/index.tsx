import { render } from "ink";
import App from "./app.js";
import { closeDb } from "./services/storage.js";
import { getActiveSessionId } from "./session-state.js";
import { initLogger, getLogger } from "./logger.js";
import { loadSettings, saveSettings } from "./settings.js";

function parseArgs(): { sessionId?: string; debug: boolean } {
  const args = process.argv.slice(2);
  let sessionId: string | undefined;
  const sessionIdx = args.indexOf("--session");
  if (sessionIdx !== -1 && sessionIdx + 1 < args.length) {
    sessionId = args[sessionIdx + 1];
  }
  const debug = args.includes("--debug");
  return { sessionId, debug };
}

const { sessionId, debug } = parseArgs();

initLogger(debug ? "debug" : "info");
loadSettings();
getLogger().info({ debug }, "lark-cli started");

function gracefulExit(): void {
  const sid = getActiveSessionId();
  if (sid) {
    process.stderr.write(`\nlark-cli --session ${sid}\n`);
  }
  saveSettings();
  getLogger().info("lark-cli exited");
  closeDb();
  process.exit(0);
}

process.on("SIGINT", gracefulExit);

const { waitUntilExit } = render(<App sessionId={sessionId} />, {
  exitOnCtrlC: false,
});

waitUntilExit().then(gracefulExit);
