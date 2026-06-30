import { ToolRegistry } from "../tools/registry.js";

// Global list of tools disallowed for sub-agents — prevents recursive Agent calls or using main-thread-only tools
export const ALL_AGENT_DISALLOWED_TOOLS = new Set([
  "TaskOutput",
  "ExitPlanMode",
  "EnterPlanMode",
  "Agent", // Prevents recursive spawning of sub-agents
  "AskUserQuestion",
  "TaskStop",
  "Workflow",
]);

// Additional tools disallowed for custom Agents (loaded from .larky/agents/);
// Currently identical to the global list, but maintained separately for future extensibility
export const CUSTOM_AGENT_DISALLOWED_TOOLS = new Set([
  "TaskOutput",
  "ExitPlanMode",
  "EnterPlanMode",
  "Agent",
  "AskUserQuestion",
  "TaskStop",
  "Workflow",
]);

// Asynchronous (background) Agents are restricted to only these tools
export const ASYNC_AGENT_ALLOWED_TOOLS = new Set([
  "ReadFile",
  "WebSearch",
  "TodoWrite",
  "Grep",
  "WebFetch",
  "Glob",
  "Bash",
  "EditFile",
  "WriteFile",
  "NotebookEdit",
  "Skill",
  "LoadSkill",
  "SyntheticOutput",
  "ToolSearch",
  "EnterWorktree",
  "ExitWorktree",
]);

function isMCPTool(name: string): boolean {
  return name.startsWith("mcp__");
}

/**
 * Multi-layer tool filtering, applied in order:
 * 1. MCP tools (mcp__*) — Always allowed
 * 2. ALL_AGENT_DISALLOWED_TOOLS — Globally disallowed (prevents recursion)
 * 3. CUSTOM_AGENT_DISALLOWED_TOOLS — Additional restrictions for custom Agents
 * 4. ASYNC_AGENT_ALLOWED_TOOLS — Whitelist for background Agents
 * 5. Definition-level disallowedTools — Blacklist
 * 6. Definition-level tools — Whitelist intersection ("*" disables this layer)
 */
export function filterToolsForAgent(
  registry: ToolRegistry,
  allowedTools: string[] | undefined,
  disallowedTools: string[] | undefined,
  isAsync: boolean,
  isCustom = false,
): ToolRegistry {
  const disallowed = new Set(disallowedTools ?? []);
  const allowed = new Set(allowedTools ?? []);
  // Enable whitelist intersection if a tools list is defined and is not the wildcard "*"
  const hasWhitelist = allowed.size > 0 && !(allowed.size === 1 && allowed.has("*"));

  const filtered = new ToolRegistry();

  for (const tool of registry.listTools()) {
    const name = tool.name;

    // Layer 1: MCP tools are always allowed
    if (isMCPTool(name)) {
      filtered.register(tool);
      continue;
    }

    // Layer 2: Global disallow — no sub-agent can use these
    if (ALL_AGENT_DISALLOWED_TOOLS.has(name)) {
      continue;
    }

    // Layer 3: Additional restrictions for custom Agents
    if (isCustom && CUSTOM_AGENT_DISALLOWED_TOOLS.has(name)) {
      continue;
    }

    // Layer 4: Whitelist filtering for asynchronous Agents
    if (isAsync && !ASYNC_AGENT_ALLOWED_TOOLS.has(name)) {
      continue;
    }

    // Layer 5: Definition-level blacklist
    if (disallowed.has(name)) {
      continue;
    }

    // Layer 6: Definition-level whitelist intersection
    if (hasWhitelist && !allowed.has(name)) {
      continue;
    }

    filtered.register(tool);
  }

  return filtered;
}
