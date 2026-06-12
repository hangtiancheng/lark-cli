import { describe, test, expect, vi, beforeEach } from "vitest";
import { resolve } from "path";
import { homedir } from "os";

vi.mock("fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";

const mockedExistsSync = vi.mocked(existsSync);
const mockedReadFileSync = vi.mocked(readFileSync);
const mockedWriteFileSync = vi.mocked(writeFileSync);
const mockedMkdirSync = vi.mocked(mkdirSync);

const SETTINGS_DIR = resolve(homedir(), ".lark-cli");
const SETTINGS_PATH = resolve(SETTINGS_DIR, "settings.json");

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("loadSettings", () => {
  test("creates default settings on first run when file does not exist", async () => {
    mockedExistsSync.mockReturnValue(false);

    const { loadSettings } = await import("../src/settings.js");
    const settings = loadSettings();

    expect(mockedMkdirSync).toHaveBeenCalledWith(SETTINGS_DIR, { recursive: true });
    expect(mockedWriteFileSync).toHaveBeenCalledWith(
      SETTINGS_PATH,
      expect.stringContaining('"PROVIDER"'),
      "utf-8",
    );
    expect(settings.PROVIDER).toBe("ollama");
    expect(settings.env.MODEL).toBe("qwen3");
    expect(settings.providers).toHaveLength(1);
    expect(settings.providers[0].name).toBe("ollama");
  });

  test("reads existing settings from file", async () => {
    const existingSettings = {
      env: { BASE_URL: "http://custom:8080", API_KEY: "key123", MODEL: "llama3", DATA_DIR: "" },
      rag: { embeddingModel: "nomic-embed-text", docsDir: "", dimension: 768 },
      PROVIDER: "custom",
      providers: [
        { name: "custom", baseUrl: "http://custom:8080", models: ["llama3"], embeddingModels: [] },
      ],
      codegen: {
        maxTokens: 4096,
        temperature: 0.5,
        cr: { model: "llama3", maxTokens: 2048, temperature: 0.1 },
        route: { model: "llama3", maxTokens: 50, temperature: 0 },
      },
    };

    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(JSON.stringify(existingSettings));

    const { loadSettings } = await import("../src/settings.js");
    const settings = loadSettings();

    expect(settings.PROVIDER).toBe("custom");
    expect(settings.env.MODEL).toBe("llama3");
    expect(settings.rag.dimension).toBe(768);
  });

  test("caches settings after first load", async () => {
    mockedExistsSync.mockReturnValue(false);

    const { loadSettings } = await import("../src/settings.js");
    loadSettings();
    loadSettings();

    expect(mockedMkdirSync).toHaveBeenCalledTimes(1);
  });
});

describe("getSettings", () => {
  test("calls loadSettings if not yet loaded", async () => {
    mockedExistsSync.mockReturnValue(false);

    const { getSettings } = await import("../src/settings.js");
    const settings = getSettings();

    expect(settings.PROVIDER).toBe("ollama");
  });
});

describe("getCurrentProvider", () => {
  test("returns the matching provider", async () => {
    mockedExistsSync.mockReturnValue(false);

    const { getCurrentProvider } = await import("../src/settings.js");
    const provider = getCurrentProvider();

    expect(provider).toBeDefined();
    expect(provider!.name).toBe("ollama");
    expect(provider!.baseUrl).toBe("http://localhost:11434");
  });

  test("returns undefined for unknown provider", async () => {
    const settings = {
      env: { BASE_URL: "", API_KEY: "", MODEL: "", DATA_DIR: "" },
      rag: { embeddingModel: "", docsDir: "", dimension: 0 },
      PROVIDER: "nonexistent",
      providers: [],
      codegen: {
        maxTokens: 0,
        temperature: 0,
        cr: { model: "", maxTokens: 0, temperature: 0 },
        route: { model: "", maxTokens: 0, temperature: 0 },
      },
    };

    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(JSON.stringify(settings));

    const { getCurrentProvider } = await import("../src/settings.js");
    const provider = getCurrentProvider();

    expect(provider).toBeUndefined();
  });
});

describe("saveSettings", () => {
  test("writes settings to file", async () => {
    mockedExistsSync.mockReturnValue(false);

    const { loadSettings, saveSettings } = await import("../src/settings.js");
    loadSettings();
    saveSettings();

    expect(mockedWriteFileSync).toHaveBeenCalledTimes(2);
    const lastCall = mockedWriteFileSync.mock.calls[1];
    expect(lastCall[0]).toBe(SETTINGS_PATH);
    expect(lastCall[2]).toBe("utf-8");
  });

  test("does nothing if settings not loaded", async () => {
    const { saveSettings } = await import("../src/settings.js");
    saveSettings();

    expect(mockedWriteFileSync).not.toHaveBeenCalled();
  });
});
