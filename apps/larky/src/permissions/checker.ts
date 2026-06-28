import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { homedir } from "node:os";
import yaml from "js-yaml";
import z, { parse } from "zod";
import { strArg } from "../utils/index.js";

export type DecisionEffect = "allow" | "deny" | "ask";
export type PermissionMode = "default" | "acceptEdits" | "plan" | "bypassPermissions";

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

// Dangerous command patterns: each carries a match reason for HITL (Human-in-the-Loop) display
interface DangerousPattern {
  re: RegExp;
  reason: string;
}

const DANGEROUS_PATTERNS: DangerousPattern[] = [
  {
    re: /rm\s+(-rf?|--recursive)\s+[/~]/,
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

export function extractContent(toolName: string, args: Record<string, unknown>): string {
  const field = CONTENT_FIELDS[toolName];
  if (!field) {
    return "";
  }
  const v = args[field];
  return typeof v === "string" ? v : "";
}

export class PathSandbox {
  private allowedRoots: string[];

  constructor(projectDir: string) {
    this.allowedRoots = [resolve(projectDir), "/tmp"];
  }

  addRoot(root: string): void {
    this.allowedRoots.push(resolve(root));
  }

  check(filePath: string): Decision | null {
    const absolute = resolve(filePath);
    for (const root of this.allowedRoots) {
      if (absolute.startsWith(root)) {
        return null;
      }
    }
    return {
      effect: "deny",
      reason: `Path ${filePath} is outside allowed directories`,
    };
  }
}

// Glob match mirroring Go filepath.Match: `*` matches a run of non-separator
// characters, `?` matches a single non-separator character.
function globMatch(pattern: string, content: string): boolean {
  const re =
    "^" +
    pattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, "[^/]*")
      .replace(/\?/g, "[^/]") +
    "$";
  try {
    return new RegExp(re).test(content);
  } catch {
    return false;
  }
}

const RULE_RE = /^(\w+)\((.+)\)$/;

// Loads a rules file in Go's format: a top-level YAML list of
// `{ rule: "Tool(pattern)", effect: "allow"|"deny" }`.
function loadRulesFile(path: string): Rule[] {
  let data: string;
  try {
    data = readFileSync(path, "utf-8");
  } catch {
    return [];
  }
  const YamlEntrySchema = z.object({
    rule: z.string().optional(),
    effect: z.string().optional(),
  });
  type YamlEntry = z.infer<typeof YamlEntrySchema>;
  let yamlData: YamlEntry[];
  try {
    const parsed: unknown = yaml.load(data);
    yamlData = parse(z.array(YamlEntrySchema), parsed);
  } catch {
    return [];
  }
  const rules: Rule[] = [];
  for (const entry of yamlData) {
    if (entry.effect !== "allow" && entry.effect !== "deny") {
      continue;
    }
    const m = RULE_RE.exec((entry.rule ?? "").trim());
    if (!m) {
      continue;
    }
    rules.push({ tool: m[1], pattern: m[2], effect: entry.effect });
  }
  return rules;
}

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
        if (r.tool !== toolName && r.tool !== "*") {
          continue;
        }
        if (globMatch(r.pattern, content)) {
          return r.effect;
        }
      }
    }
    return null;
  }

  // Persists a rule to the project-local YAML file in Go's `Tool(pattern)`
  // format so "allow always" survives a restart.
  appendLocalRule(rule: Rule): void {
    mkdirSync(dirname(this.localPath), { recursive: true });
    const rules = loadRulesFile(this.localPath);
    rules.push(rule);
    const entries = rules.map((r) => ({
      rule: `${r.tool}(${r.pattern})`,
      effect: r.effect,
    }));
    writeFileSync(this.localPath, yaml.dump(entries), "utf-8");
  }
}

// Detect dangerous commands and return the matched reason (empty string means safe)
function detectDangerous(command: string): string {
  for (const p of DANGEROUS_PATTERNS) {
    if (p.re.test(command)) {
      return p.reason;
    }
  }
  return "";
}

function isSafeCommand(command: string): boolean {
  const trimmed = command.trim();
  // Reject anything with shell metacharacters: a "safe" prefix like `cat` must
  // not become a gateway to piping/chaining/redirection/substitution.
  if (
    trimmed.includes(">") ||
    trimmed.includes("|") ||
    trimmed.includes(";") ||
    trimmed.includes("&&") ||
    trimmed.includes("$(") ||
    trimmed.includes("`")
  ) {
    return false;
  }
  return SAFE_PREFIXES.some(
    (prefix) =>
      trimmed === prefix || trimmed.startsWith(prefix + " ") || trimmed.startsWith(prefix + "\t"),
  );
}

function modeDecide(mode: PermissionMode, category: "read" | "write" | "command"): DecisionEffect {
  switch (mode) {
    case "bypassPermissions":
      return "allow";
    case "plan":
      return category === "read" ? "allow" : "ask";
    case "acceptEdits":
      return category === "command" ? "ask" : "allow";
    case "default":
    default:
      return category === "read" ? "allow" : "ask";
  }
}

export class PermissionChecker {
  mode: PermissionMode;
  planFilePath = "";
  private sandbox: PathSandbox;
  private ruleEngine: RuleEngine;
  // Layer 4b: Session-level temporary allowlist (in-memory, invalidated on process exit)
  // Key format: "ToolName:pattern". Matches are allowed directly without writing to disk.
  private sessionAllowed = new Set<string>();

  constructor(workDir: string, mode: PermissionMode = "default") {
    this.mode = mode;
    this.sandbox = new PathSandbox(workDir);
    this.ruleEngine = new RuleEngine(workDir);
  }

  check(
    toolName: string,
    category: "read" | "write" | "command",
    args: Record<string, unknown>,
  ): Decision {
    const content = extractContent(toolName, args);

    // Layer 0: plan-mode plan-file write exception.
    // Both WriteFile and EditFile targeting the plan file are allowed so the
    // model can create and update its plan. Mirrors Go's category-level check
    // against CategoryWrite (which covers both tools).
    if (this.mode === "plan" && (toolName === "WriteFile" || toolName === "EditFile")) {
      const path = strArg(args, "file_path", "");
      if (path.includes(".larky/plans/")) {
        return {
          effect: "allow",
          reason: "Plan file write allowed in plan mode",
        };
      }
    }

    // Layer 2: safe read-only command auto-allow (metaChar-guarded).
    if (category === "command" && isSafeCommand(content)) {
      return { effect: "allow", reason: "Safe read-only command" };
    }

    // Layer 3: dangerous command block — reason records the specific matched pattern
    const dangerReason = category === "command" ? detectDangerous(content) : "";
    if (dangerReason) {
      return {
        effect: "deny",
        reason: `Dangerous command blocked: ${dangerReason}`,
      };
    }

    // Layer 4: path sandbox (file tools only).
    const filePath = strArg(args, "file_path", strArg(args, "path", ""));
    if ((category === "read" || category === "write") && filePath) {
      const sandboxDecision = this.sandbox.check(filePath);
      if (sandboxDecision) {
        return sandboxDecision;
      }
    }

    // Layer 4b: Session-level temporary allow — check the in-memory sessionAllowed set
    const sessionKey = `${toolName}:${content}`;
    if (this.sessionAllowed.has(sessionKey)) {
      return { effect: "allow", reason: "Session allow: previously approved" };
    }

    // Layer 5: rule engine — per-tool content + glob match.
    const ruleEffect = this.ruleEngine.evaluate(toolName, content);
    if (ruleEffect) {
      return { effect: ruleEffect, reason: `Permission rule: ${ruleEffect}` };
    }

    // Layer 6: mode matrix.
    return {
      effect: modeDecide(this.mode, category),
      reason: `Mode: ${this.mode}`,
    };
  }

  // Session-level allow: effective only during the current process lifecycle, not persisted to disk
  allowForSession(toolName: string, args: Record<string, unknown>): void {
    const content = extractContent(toolName, args);
    this.sessionAllowed.add(`${toolName}:${content}`);
  }

  // Persist a scoped "allow always" rule. The pattern is derived from the
  // tool's content field (capped at 60 chars) so it allows that specific
  // command/path family rather than the whole tool. Mirrors Go.
  allowAlways(toolName: string, args: Record<string, unknown>): void {
    const content = extractContent(toolName, args);
    const pattern = content.length > 60 ? content.slice(0, 60) + "*" : content + "*";
    this.ruleEngine.appendLocalRule({
      tool: toolName,
      pattern,
      effect: "allow",
    });
  }

  /**
   * Generate a human-readable description of the tool action for display in HITL confirmation dialogs.
   * Prioritizes extracting fields defined in contentFields (e.g., command, file_path);
   * falls back to a key:value summary of parameters if no match is found.
   */
  describeToolAction(toolName: string, args: Record<string, unknown>): string {
    const content = extractContent(toolName, args);
    if (content) {
      return content;
    }
    // Fallback: concatenate key: value for all parameters, truncating overly long values
    const parts: string[] = [];
    for (const [k, v] of Object.entries(args)) {
      let s = String(v);
      if (s.length > 80) {
        s = s.slice(0, 80) + "...";
      }
      parts.push(`${k}: ${s}`);
    }
    return parts.join(", ");
  }
}
