import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve } from "path";
import { homedir } from "os";

const SETTINGS_DIR = resolve(homedir(), ".lark-cli");
const SETTINGS_PATH = resolve(SETTINGS_DIR, "settings.json");

const DEFAULT_SETTINGS: Settings = {
  env: {
    BASE_URL: "http://localhost:11434",
    API_KEY: "",
    MODEL: "qwen3",
    DATA_DIR: "",
  },
  rag: {
    embeddingModel: "nomic-embed-text",
    docsDir: "",
    dimension: 1024,
  },
  PROVIDER: "ollama",
  providers: [
    {
      name: "ollama",
      baseUrl: "http://localhost:11434",
      models: ["qwen2.5", "qwen3", "qwen3.5", "gemma3"],
      embeddingModels: ["nomic-embed-text"],
    },
  ],
  codegen: {
    maxTokens: 8192,
    temperature: 0.2,
    cr: { model: "qwen2.5", maxTokens: 4096, temperature: 0.2 },
    route: { model: "qwen2.5", maxTokens: 100, temperature: 0 },
  },
};

export interface ProviderEntry {
  name: string;
  baseUrl: string;
  models: string[];
  embeddingModels: string[];
}

export interface Settings {
  env: {
    BASE_URL: string;
    API_KEY: string;
    MODEL: string;
    DATA_DIR: string;
  };
  rag: {
    embeddingModel: string;
    docsDir: string;
    dimension: number;
  };
  PROVIDER: string;
  providers: ProviderEntry[];
  codegen: {
    maxTokens: number;
    temperature: number;
    cr: {
      model: string;
      maxTokens: number;
      temperature: number;
    };
    route: {
      model: string;
      maxTokens: number;
      temperature: number;
    };
  };
}

let settings: Settings | null = null;

export function loadSettings(): Settings {
  if (settings) return settings;

  if (!existsSync(SETTINGS_PATH)) {
    mkdirSync(SETTINGS_DIR, { recursive: true });
    settings = structuredClone(DEFAULT_SETTINGS);
    writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + "\n", "utf-8");
    return settings;
  }

  const raw = readFileSync(SETTINGS_PATH, "utf-8");
  settings = JSON.parse(raw) as Settings;
  return settings;
}

export function getSettings(): Settings {
  if (!settings) return loadSettings();
  return settings;
}

export function saveSettings(): void {
  if (!settings) return;
  writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + "\n", "utf-8");
}

export function getCurrentProvider(): ProviderEntry | undefined {
  const s = getSettings();
  return s.providers.find((p) => p.name === s.PROVIDER);
}
