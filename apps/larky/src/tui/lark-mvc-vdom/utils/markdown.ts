import chalk from "chalk";
import { marked } from "marked";
import { markedTerminal } from "@lark.js/marked-terminal";

chalk.level = 3;
marked.use(markedTerminal({ showSectionPrefix: false }));

export async function renderMarkdown(text: string): Promise<string> {
  try {
    return await marked.parse(text);
  } catch {
    return text;
  }
}

/** Synchronous markdown rendering (works when marked-terminal is used as the only extension) */
export function renderMarkdownSync(text: string): string {
  try {
    const result = marked.parse(text);
    if (typeof result === "string") {
      return result;
    }
    return text;
  } catch {
    return text;
  }
}
