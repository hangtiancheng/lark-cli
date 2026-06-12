import { resolve } from "path";
import { homedir } from "os";
import { mkdirSync, existsSync } from "fs";
import { getSettings } from "./settings.js";

export interface Config {
  ai: {
    baseUrl: string;
    modelName: string;
  };
  rag: {
    embeddingModel: string;
    docsDir: string;
    dimension: number;
  };
  dataDir: string;
  dbPath: string;
}

export function getConfig(): Config {
  const s = getSettings();
  const dataDir = s.env.DATA_DIR || resolve(homedir(), ".lark-cli");

  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  return {
    ai: {
      baseUrl: s.env.BASE_URL,
      modelName: s.env.MODEL,
    },
    rag: {
      embeddingModel: s.rag.embeddingModel,
      docsDir: s.rag.docsDir || resolve(dataDir, "docs"),
      dimension: s.rag.dimension,
    },
    dataDir,
    dbPath: resolve(dataDir, "data.db"),
  };
}
