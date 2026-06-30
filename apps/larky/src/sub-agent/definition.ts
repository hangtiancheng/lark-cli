import type { PermissionMode } from "../permissions/checker.js";

export interface AgentDefinition {
  name: string;
  description: string;
  tools?: string[];
  disallowedTools?: string[];
  systemPromptOverride?: string;
  maxTurns?: number;
  model?: string;
  permissionMode?: PermissionMode;
  background?: boolean;
  isolation?: "worktree";
  initialPrompt?: string;
  omitMarkdown?: boolean;
  skills?: string[];
  memory?: boolean;
  mcpServers?: string[];
}

export const BUILTIN_AGENTS: AgentDefinition[] = [
  {
    name: "general-purpose",
    description:
      "General-purpose agent for researching complex questions, searching for code, and executing multi-step tasks.",
  },
  {
    name: "plan",
    description:
      "Software architect agent for designing implementation plans. Returns step-by-step plans, identifies critical files.",
    disallowedTools: ["EditFile", "WriteFile"],
    permissionMode: "plan",
  },
  {
    name: "explore",
    description:
      "Fast read-only search agent for locating code. Use it to find files by pattern, grep for symbols or keywords.",
    disallowedTools: ["EditFile", "WriteFile"],
    permissionMode: "plan",
  },
];
