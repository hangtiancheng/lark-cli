// Feature: Verify 4-tier config priority chain (defaults → TOML → .env → environment variables)
// Design: Use vitest temp directories and environment variable isolation to cover all config source behaviors
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { getConfig } from "../../src/core/config.js";

// Create unique temp directory for each test
function makeTmpDir(): string {
  const dir = path.join(
    tmpdir(),
    `lark-test-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

// Environment variable names to save and restore
const ENV_KEYS = [
  "LARK_CONFIG",
  "LARK_HOST",
  "LARK_PORT",
  "LARK_LOG_LEVEL",
  "LARK_LOG_FILE",
  "LARK_LOG_FORMAT",
  "LARK_MAX_STEPS",
  "LARK_LLM_DEFAULT_MODEL",
  "LARK_TRACE_ENABLED",
  "LARK_TRACE_FILE",
  "LARK_TRACE_INCLUDE_LLM_PAYLOAD",
  "LARK_PERMISSION_TIMEOUT_S",
  "LARK_COMPACT_THRESHOLD",
  "LARK_COMPACT_TOOL_LIMIT",
  "LARK_COMPACT_TOOL_KEEP",
];

describe("config priority chain", () => {
  let origDir: string;
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    origDir = process.cwd();
    savedEnv = {};
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      // delete process.env[key];
      Reflect.deleteProperty(process.env, key);
    }
  });

  afterEach(() => {
    process.chdir(origDir);
    for (const key of ENV_KEYS) {
      if (savedEnv[key] !== undefined) {
        process.env[key] = savedEnv[key];
      } else {
        // delete process.env[key];
        Reflect.deleteProperty(process.env, key);
      }
    }
  });

  // Feature: Verify silent skip when .env file doesn't exist, use built-in defaults
  // Design: chdir to empty directory, clear env vars, confirm getConfig() doesn't crash on missing .env
  test("missing env file is silent, uses defaults", () => {
    const dir = makeTmpDir();
    process.chdir(dir);

    const cfg = getConfig();
    expect(cfg.port).toBe(7437);
  });

  // Feature: Verify .env file values are loaded correctly and override built-in defaults
  // Design: Write .env to temp directory and chdir into it, confirm .env load path works
  test("dotenv values loaded and override defaults", () => {
    const dir = makeTmpDir();
    writeFileSync(path.join(dir, ".env"), "LARK_PORT=9999\n");
    process.chdir(dir);

    const cfg = getConfig();
    expect(cfg.port).toBe(9999);
  });

  // Feature: Verify system environment variables have higher priority than .env file values
  // Design: Write 9999 to .env, write 8888 to system env var, confirm final value is 8888
  test("system env overrides dotenv", () => {
    const dir = makeTmpDir();
    writeFileSync(path.join(dir, ".env"), "LARK_PORT=9999\n");
    process.chdir(dir);
    process.env["LARK_PORT"] = "8888";

    const cfg = getConfig();
    expect(cfg.port).toBe(8888);
  });

  // Feature: Verify LARK_CONFIG environment variable correctly affects TOML config file load path
  // Design: Point env var to custom TOML file, write different port to TOML
  test("LARK_CONFIG env var overrides TOML path", () => {
    const dir = makeTmpDir();
    const tomlPath = path.join(dir, "custom.toml");
    writeFileSync(tomlPath, "[core]\nport = 5555\n");
    process.chdir(dir);
    process.env["LARK_CONFIG"] = tomlPath;

    const cfg = getConfig();
    expect(cfg.port).toBe(5555);
  });

  // Feature: Verify full 4-tier priority chain: defaults(7437) → TOML(6000) → .env(7000) → env var(8000)
  // Design: Set all 4 tiers simultaneously, confirm final value is highest priority env var
  test("full priority chain: env var wins", () => {
    const dir = makeTmpDir();
    const tomlPath = path.join(dir, "lark.toml");
    writeFileSync(tomlPath, "[core]\nport = 6000\n");
    writeFileSync(path.join(dir, ".env"), "LARK_PORT=7000\n");
    process.chdir(dir);
    process.env["LARK_CONFIG"] = tomlPath;
    process.env["LARK_PORT"] = "8000";

    const cfg = getConfig();
    expect(cfg.port).toBe(8000);
  });

  // Feature: Verify error thrown when TOML contains unknown top-level section
  // Design: Write TOML with unknown section, confirm getConfig throws error containing "Unknown"
  test("unknown TOML section throws error", () => {
    const dir = makeTmpDir();
    const tomlPath = path.join(dir, "bad.toml");
    writeFileSync(tomlPath, '[unknown_section]\nfoo = "bar"\n');
    process.chdir(dir);
    process.env["LARK_CONFIG"] = tomlPath;

    expect(() => getConfig()).toThrow("Unknown top-level config keys");
  });
});
