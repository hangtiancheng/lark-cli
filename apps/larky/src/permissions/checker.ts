import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { homedir } from "node:os";
import yaml from "js-yaml";

export type DecisionEffect = "allow" | "deny" | "ask";
export type PermissionMode =
  | "default"
  | "acceptEdits"
  | "plan"
  | "bypassPermissions";

export interface Decision {
  effect: DecisionEffect;
  reason: string;
}

type RuleEffect = "allow" | "deny";

interface Rule {
  tool: string;
  pattern: string;
  effect: RuleEffect;
}

interface DangerousPattern {
  re: RegExp;
  reason: string;
}

const DANGEROUS_PATTERNS: DangerousPattern[] = [
  {
    re: /rm\s+(-rf?|--recursive)\s+[\/~]/,
    reason: "recursive force delete root",
  },
  { re: /rm\s+-rf?\s+\*/, reason: "recursive force delete wildcard" },
  { re: /mkfs\./, reason: "format disk" },
  { re: /dd\s+if=/, reason: "direct write to disk device" },
  { re: />\s*\/dev\/sd/, reason: "overwrite disk device" },
  { re: /chmod\s+-R?\s*777\s+\//, reason: "recursive chmod root" },
  { re: /:\(\)\{\s*:\|\s*:\s*&\s*\}\s*;/, reason: "fork bomb" },
  { re: /curl\s+.*\|\s*(ba)?sh/, reason: "pipe remote script" },
  { re: /wget\s+.*\|\s*(ba)?sh/, reason: "pipe remote script" },
  { re: /git\s+push\s+.*--force/, reason: "force push" },
  { re: /git\s+reset\s+--hard/, reason: "hard reset" },
  { re: /git\s+clean\s+-f/, reason: "force clean untracked files" },
  { re: /git\s+checkout\s+\./, reason: "discard all changes" },
  { re: /git\s+branch\s+-D/, reason: "force delete branch" },
];

const SAFE_PREFIXES = [
  "cat",
  "date",
  "echo",
  "file",
  "head",
  "hostname",
  "ls",
  "pwd",
  "tail",
  "type",
  "uname",
  "wc",
  "which",
  "whoami",
  "git branch",
  "git diff",
  "git log",
  "git remote",
  "git rev-parse",
  "git show",
  "git status",
  "bun",
  "deno",
  "pnpm",
  "yarn",
  "go build",
  "go test",
  "go vet",
  "node",
  "python",
];

// Per-tool argument field treated as the "content" for safe/dangerous checks and rule matching
const CONTENT_FIELDS: Record<string, string> = {
  Bash: "command",
  ReadFile: "file_path",
  WriteFile: "file_path",
  EditFile: "file_path",
  Glob: "pattern",
  Grep: "pattern",
};


export class RuleEngine {
  private userPath: string;
  private projectPath: string;
  private localPath: string;

  constructor(workDir: string) {
    this.userPath = join(homedir(), ".lark", "permissions.yaml");
    this.projectPath = join(workDir, ".lark", "permissions.yaml");
    this.localPath = join(workDir, ".lark", "permissions.local.yaml");
  }

    // Loads the three rule files fresh on every call (so a just-written
  // "allow always" rule takes effect immediately) and returns the first match
  // scanning user → project → local, last-rule-wins within each file.
    evaluate(toolName: string, content: string): RuleEffect | null {
    for (const path of [this.userPath, this.projectPath, this.localPath]) {
      const rules = loadRulesFile(path);
      for (let i = rules.length - 1; i >= 0; i--) {
        const r = rules[i];
        if (r.tool !== toolName && r.tool !== "*") continue;
        if (globMatch(r.pattern, content)) return r.effect;
      }
    }
    return null;
  }
}
