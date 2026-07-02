// @ts-check
/**
 * Failing-test runner for Larky via tmux.
 *
 * Ported from run-failing.sh. Runs two scenarios (identity + rewind) that
 * previously failed, asserting on captured pane output and file state.
 * Requires Node 18+ and `tmux` on PATH.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";

/**
 * @typedef {Object} TmuxOptions
 * @property {boolean} [ignoreError]
 * @property {string} [cwd]
 */

// --- Configuration (override via env, no hardcoded home paths) ---
const SESS = process.env.LARKY_SESS ?? "lark-test-ts";
const CWD = process.env.LARKY_CWD ?? process.cwd();
const STDERR_LOG = process.env.LARKY_STDERR_LOG ?? "/tmp/larky-ts-stderr.log";
const RUN_CMD = process.env.LARKY_RUN_CMD ?? "npx tsx src/main.tsx";

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Execute a tmux command, returning stdout.
 * @param {string[]} args
 * @param {TmuxOptions} [options]
 * @returns {string}
 */
function tmux(args, options) {
  try {
    return execFileSync("tmux", args, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      cwd: options?.cwd,
    }).trimEnd();
  } catch (e) {
    if (options?.ignoreError) return "";
    throw e;
  }
}

/**
 * Send keys to the tmux session.
 * @param {string} msg
 * @param {boolean} [enter=true]
 * @returns {void}
 */
function sendKeys(msg, enter = true) {
  const args = ["send-keys", "-t", SESS, msg];
  if (enter) args.push("Enter");
  tmux(args);
}

/**
 * Capture the pane content with scrollback.
 * @param {number} [scrollback=0]
 * @returns {string}
 */
function capturePane(scrollback = 0) {
  const args = ["capture-pane", "-t", SESS, "-p"];
  if (scrollback > 0) {
    args.push("-S", `-${scrollback}`);
  }
  return tmux(args, { ignoreError: true });
}

/**
 * Start a fresh tmux session, waiting for the TUI to be ready.
 * @returns {Promise<boolean>}
 */
async function startSession() {
  tmux(["kill-session", "-t", SESS], { ignoreError: true });
  await sleep(1000);
  tmux(["new-session", "-d", "-s", SESS, "-x", "120", "-y", "40", `${RUN_CMD} 2>${STDERR_LOG}`], {
    cwd: CWD,
  });
  for (let elapsed = 0; elapsed < 15; elapsed++) {
    if (capturePane().includes("Type a message")) {
      console.log("[OK] Session started");
      return true;
    }
    await sleep(1000);
  }
  console.log("[FAIL] Session did not start");
  return false;
}

/**
 * Send a message and wait for the output to stabilize (Type a message reappears
 * and stays stable for two polls).
 * @param {string} msg
 * @param {number} [timeout=60]
 * @returns {Promise<string>}
 */
async function sendAndWait(msg, timeout = 60) {
  sendKeys(msg, true);
  await sleep(2000);
  let elapsed = 2;
  let prev = "";
  let stable = 0;
  while (elapsed < timeout) {
    const current = capturePane(500);
    if (current.includes("Type a message")) {
      if (current === prev) {
        stable++;
        if (stable >= 2) return current;
      } else {
        stable = 0;
      }
    }
    prev = current;
    await sleep(2000);
    elapsed += 2;
  }
  return capturePane(500);
}

/**
 * Kill the tmux session.
 * @returns {void}
 */
function stopSession() {
  tmux(["kill-session", "-t", SESS], { ignoreError: true });
}

/**
 * Read a file, returning "NOT FOUND" if it does not exist.
 * @param {string} file
 * @returns {string}
 */
function catFile(file) {
  try {
    return readFileSync(file, "utf-8");
  } catch {
    return "NOT FOUND";
  }
}

/**
 * Case-insensitive substring check.
 * @param {string} output
 * @param {string} value
 * @returns {boolean}
 */
function containsCi(output, value) {
  return output.toLowerCase().includes(value.toLowerCase());
}

/**
 * True if none of the `|`-separated values appear (case-insensitive).
 * @param {string} output
 * @param {string} value
 * @returns {boolean}
 */
function notContainsAny(output, value) {
  const lower = output.toLowerCase();
  return !value.split("|").some((v) => lower.includes(v.toLowerCase()));
}

/**
 * @returns {Promise<void>}
 */
async function main() {
  console.log("=== T05-01 Identity ===");
  await startSession();
  const output = await sendAndWait("Who are you? What is your name? What can you do?", 30);
  if (containsCi(output, "larky")) {
    console.log("[assertion] CONTAINS_CI larky: PASS");
  } else {
    console.log("[assertion] CONTAINS_CI larky: FAIL");
  }
  if (
    containsCi(output, "Claude") ||
    containsCi(output, "ChatGPT") ||
    containsCi(output, "GPT-4")
  ) {
    console.log("[assertion] NOT_CONTAINS Claude|ChatGPT|GPT-4: FAIL");
    console.log("[relevant output]:");
    output
      .split("\n")
      .filter((l) => /claude|chatgpt|gpt/i.test(l))
      .slice(0, 5)
      .forEach((l) => console.log(l));
  } else {
    console.log("[assertion] NOT_CONTAINS Claude|ChatGPT|GPT-4: PASS");
  }
  stopSession();

  console.log("");
  console.log("=== T16-01 Rewind ===");
  const rewindFile = "/tmp/larky-rewind-test.txt";
  rmSync(rewindFile, { force: true });
  await startSession();

  console.log("[step 1] Write version 1...");
  await sendAndWait('Write "version 1: hello world" to /tmp/larky-rewind-test.txt', 60);
  console.log(`File after step 1: ${catFile(rewindFile)}`);

  console.log("[step 2] Edit to version 2...");
  await sendAndWait('Change the content of /tmp/larky-rewind-test.txt to "version 2: modified content"', 60);
  console.log(`File after step 2: ${catFile(rewindFile)}`);

  console.log("[step 3] /rewind...");
  await sendAndWait("/rewind", 15);
  await sleep(2000);
  console.log(`File after rewind: ${catFile(rewindFile)}`);

  if (catFile(rewindFile).includes("version 1")) {
    console.log("[assertion] FILE_CONTENT version 1: PASS");
  } else {
    console.log("[assertion] FILE_CONTENT version 1: FAIL");
  }
  stopSession();
}

main();
