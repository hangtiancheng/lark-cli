// @ts-check

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import typescript from "@rollup/plugin-typescript";
import json from "@rollup/plugin-json";

const __dirname = dirname(fileURLToPath(import.meta.url));
const promptsDir = join(__dirname, "src", "engine", "ai", "prompts", "md");

function inlinePrompts() {
  const PROMPT_REGISTRY_SUFFIX = "engine/ai/prompts/prompt-registry.ts";
  const READ_PROMPT_REGEX = /readPrompt\("([^"]+)"\)/g;

  return {
    name: "inline-prompts",
    /**
     *
     * @param {string} code
     * @param {string} id
     * @returns
     */
    transform(code, id) {
      if (!id.includes(PROMPT_REGISTRY_SUFFIX)) return null;

      const hasMatch = READ_PROMPT_REGEX.test(code);
      READ_PROMPT_REGEX.lastIndex = 0;
      if (!hasMatch) return null;

      let transformed = code.replace(READ_PROMPT_REGEX, (_match, filename) => {
        const content = readFileSync(join(promptsDir, filename), "utf-8");
        return JSON.stringify(content);
      });

      transformed = transformed
        .replace(/const findPromptsDir[\s\S]*?^};/m, "")
        .replace(/const promptsDir\s*=\s*findPromptsDir\(\);?\s*/g, "")
        .replace(/const readPrompt[\s\S]*?readFileSync\([^)]+\),\s*"utf-8"\);?\s*/g, "")
        .replace(/import\s*\{[^}]*\}\s*from\s*"node:fs";\s*/g, "")
        .replace(/import\s*\{[^}]*\}\s*from\s*"node:path";\s*/g, "")
        .replace(/import\s*\{[^}]*\}\s*from\s*"node:url";\s*/g, "");

      return { code: transformed, map: null };
    },
  };
}

export default {
  input: "src/index.tsx",
  output: {
    file: "dist/index.js",
    format: "esm",
    sourcemap: true,
    banner: "#!/usr/bin/env node",
    inlineDynamicImports: true,
  },
  external: [/^node:/, "better-sqlite3"],
  plugins: [
    {
      name: "stub-optional-deps",
      resolveId(/** @type {string} */ source) {
        if (source === "react-devtools-core") return source;
        return null;
      },
      load(/** @type {string} */ id) {
        if (id === "react-devtools-core") return "export default undefined;";
        return null;
      },
    },
    inlinePrompts(),
    resolve({
      extensions: [".ts", ".tsx", ".js", ".jsx", ".json"],
      preferBuiltins: true,
    }),
    json(),
    commonjs(),
    typescript({
      tsconfig: "./tsconfig.json",
      declaration: false,
      sourceMap: true,
    }),
  ],
};
