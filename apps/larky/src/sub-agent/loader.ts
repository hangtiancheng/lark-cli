import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import yaml from "js-yaml";
import { BUILTIN_AGENTS, type AgentDefinition } from "./definition.js";
import z, { parse } from "zod";

/**
 * Loads Agent definitions in order: built-in → user-level (~/.larky/agents/) → project-level (.larky/agents/).
 * Later definitions with the same name override earlier ones. Priority: project > user > built-in.
 */
export function loadAgentDefinitions(workDir: string): AgentDefinition[] {
  const definitions = [...BUILTIN_AGENTS];

  // User-level directory: ~/.larky/agents/
  const home = homedir();
  if (home) {
    loadDir(join(home, ".larky", "agents"), definitions);
  }

  // Project-level directory: <workDir>/.larky/agents/
  const dirs = [join(workDir, ".larky", "agents")];
  for (const dir of dirs) {
    loadDir(dir, definitions);
  }

  return definitions;
}

/** Scans all .md files in a directory and parses them into Agent definitions, overriding duplicates */
function loadDir(dir: string, definitions: AgentDefinition[]): void {
  if (!existsSync(dir)) {
    return;
  }

  const files = readdirSync(dir).filter((f) => f.endsWith(".md"));
  for (const file of files) {
    try {
      const content = readFileSync(join(dir, file), "utf-8");
      const def = parseAgentDefinition(content);
      if (def) {
        const existing = definitions.findIndex((d) => d.name === def.name);
        if (existing >= 0) {
          definitions[existing] = def;
        } else {
          definitions.push(def);
        }
      }
    } catch {
      continue;
    }
  }
}

const YamlFrontmatterSchema = z.looseObject({
  name: z.string(),
  description: z.string().optional(),
  tools: z.array(z.string()).optional(),
  disallowed_tools: z.array(z.string()).optional(),
  system_prompt: z.string().optional(),
  max_turns: z.number().optional(),
  model: z.string().optional(),
  background: z.boolean().optional(),
  isolation: z.literal("worktree").optional(),
});

function parseAgentDefinition(content: string): AgentDefinition | null {
  if (!content.startsWith("---")) {
    return null;
  }
  const endIdx = content.indexOf("---", 3);
  if (endIdx === -1) {
    return null;
  }

  const frontmatter = content.slice(3, endIdx).trim();
  const body = content.slice(endIdx + 3).trim();

  try {
    const raw: unknown = yaml.load(frontmatter);
    const parsed = parse(YamlFrontmatterSchema, raw);

    return {
      name: parsed.name,
      description: parsed.description ?? body.slice(0, 200),
      tools: parsed.tools,
      disallowedTools: parsed.disallowed_tools,
      systemPromptOverride: parsed.system_prompt,
      maxTurns: parsed.max_turns,
      model: parsed.model,
      background: parsed.background,
      isolation: parsed.isolation,
      initialPrompt: body,
    };
  } catch {
    return null;
  }
}
