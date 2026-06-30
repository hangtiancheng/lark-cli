import { render } from "ink";
import { loadConfig } from "./config/config.js";
import { App } from "./tui/app.js";
import { parseTeammateFlags, runTeammate } from "./teammate.js";
import { asErrorString } from "./utils/index.js";
import cliCursor from "cli-cursor";
import { openSync, writeSync, closeSync } from "node:fs";
async function main() {
  const args = process.argv.slice(2);

  const teammateArgs = parseTeammateFlags(args);
  if (teammateArgs) {
    try {
      await runTeammate(teammateArgs);
    } catch (err) {
      console.error(`teammate: ${asErrorString(err)}`);
      process.exit(1);
    }
    return;
  }

  let cfg;
  try {
    cfg = loadConfig();
  } catch (err) {
    console.error(`Error: ${asErrorString(err)}`);
    process.exit(1);
  }

  // Patch cli-cursor to write hide/show to the actual TTY, not stderr
  let ttyFd: number | null = null;
  try {
    ttyFd = openSync("/dev/tty", "w");
  } catch (e) {
    console.error(e);
  }

  const writeTty = (seq: string) => {
    if (ttyFd !== null) {
      writeSync(ttyFd, seq);
    }
    process.stdout.write(seq);
    process.stderr.write(seq);
  };

  // Intercept cli-cursor to prevent Ink from re-showing cursor
  const origShow = cliCursor.show.bind(cliCursor);
  cliCursor.show = () => {
    /** noop */
  };

  writeTty("\x1b[?25l");

  const restoreCursor = () => {
    cliCursor.show = origShow;
    writeTty("\x1b[?25h");
    if (ttyFd !== null) {
      try {
        closeSync(ttyFd);
      } catch (e) {
        console.error(e);
      }
      ttyFd = null;
    }
  };
  process.on("exit", restoreCursor);

  const instance = render(
    <App providers={cfg.providers} mcpServers={cfg.mcp_servers} hooks={cfg.hooks} />,
    { exitOnCtrlC: false },
  );
  await instance.waitUntilExit();
  restoreCursor();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(-1);
});
