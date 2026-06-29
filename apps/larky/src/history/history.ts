import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parse, z } from "zod";

const MAX_ENTRIES = 200;
const FILENAME = "prompt_history.jsonl";

const JSONLSchema = z.object();
export function load(dir: string): string[] {
  const filePath = join(dir, FILENAME);
  if (!existsSync(filePath)) {
    return [];
  }

  try {
    const content = readFileSync(filePath, "utf-8");
    return content
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          const entry: unknown = JSON.parse(line);
          const { text } = parse(JSONLSchema, entry);
          return text;
        } catch (err) {
          console.error(err);
          return "";
        }
      });
  } catch (err2) {
    console.error(err2);
    return [];
  }
}

export function append(dir: string, text: string): void {
  const filePath = join(dir, FILENAME);
  mkdirSync(dir, { recursive: true });

  const entries = load(dir);

  if (entries.length > 0 && entries[entries.length - 1] === text) {
    return;
  }

  entries.push(text);
  while (entries.length > MAX_ENTRIES) {
    entries.shift();
  }

  const lines = entries.map((t) => JSON.stringify({ text: t })).join("\n") + "\n";
  writeFileSync(filePath, lines, "utf-8");
}
