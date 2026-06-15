// Permission policy definition and evaluation
export const PermissionDecision = {
  ALLOW: "allow",
  DENY: "deny",
  ASK: "ask",
} as const;

export type PermissionDecision = (typeof PermissionDecision)[keyof typeof PermissionDecision];

// Regex rules to detect bash commands operating outside cwd
const OUTSIDE_CWD_HEURISTICS = [
  /(^|\s)\/[^\s]/,
  /(^|\s)~/,
  /(^|\s)\.\.(\/|$|\s)/,
  /\$\{?HOME\b/,
  /\$\{?PWD\b/,
  /(^|\s|;|&&|\|\|)cd(\s|$)/,
];

// Check if a bash command matches outside-cwd heuristics
export function matchesOutsideCwd(command: string): boolean {
  return OUTSIDE_CWD_HEURISTICS.some((pat) => pat.test(command));
}

export interface ToolPolicy {
  default: PermissionDecision;
  allowPatterns: string[];
  denyPatterns: string[];
}

// Convenience factory for ToolPolicy
function policy(def: PermissionDecision, opts?: { allow?: string[]; deny?: string[] }): ToolPolicy {
  return {
    default: def,
    allowPatterns: opts?.allow ?? [],
    denyPatterns: opts?.deny ?? [],
  };
}

export const DEFAULT_POLICIES: Record<string, ToolPolicy> = {
  bash: policy(PermissionDecision.ASK),
  write_file: policy(PermissionDecision.ASK),
  read_file: policy(PermissionDecision.ALLOW),
  list_dir: policy(PermissionDecision.ALLOW),
  note_save: policy(PermissionDecision.ALLOW),
};

// Preview key mapping for human-readable param display in permission prompts
const PREVIEW_KEY: Record<string, string> = {
  bash: "command",
  read_file: "path",
  write_file: "path",
  list_dir: "path",
  note_save: "content",
};
const PREVIEW_MAX = 60;

// Generate a human-readable param summary for permission approval events
export function paramPreview(toolName: string, params: Record<string, unknown>): string {
  const key = PREVIEW_KEY[toolName];
  if (key && key in params) {
    const raw = params[key];
    let val = typeof raw === "string" ? raw : String(raw);
    if (val.length > PREVIEW_MAX) val = val.slice(0, PREVIEW_MAX) + "…";
    return `${key}=${val}`;
  }
  const snippet = JSON.stringify(params);
  return snippet.length > PREVIEW_MAX ? snippet.slice(0, PREVIEW_MAX) : snippet;
}

// Evaluate tool + params through 4-tier static policy; returns ALLOW/DENY/ASK
export function evaluate(
  toolName: string,
  params: Record<string, unknown>,
  toolPolicy?: ToolPolicy,
): PermissionDecision {
  const pol = toolPolicy ?? (toolName in DEFAULT_POLICIES ? DEFAULT_POLICIES[toolName] : undefined);
  if (!pol) return PermissionDecision.ASK;

  const commandRaw = params["command"];
  const command = toolName === "bash" && typeof commandRaw === "string" ? commandRaw : "";

  // Tier 1: deny_patterns (bash only)
  if (command) {
    for (const pat of pol.denyPatterns) {
      if (new RegExp(pat).test(command)) return PermissionDecision.DENY;
    }
  }

  // Tier 2: OUTSIDE_CWD_HEURISTICS — forced ASK
  if (command && matchesOutsideCwd(command)) return PermissionDecision.ASK;

  // Tier 3: allow_patterns (bash only)
  if (command) {
    for (const pat of pol.allowPatterns) {
      if (new RegExp(pat).test(command)) return PermissionDecision.ALLOW;
    }
  }

  // Tier 4: tool default
  return pol.default;
}
