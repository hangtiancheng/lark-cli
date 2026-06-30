import type { Tool, ToolContext, ToolResult, ToolSchema } from "../tools/types.js";
import type { SkillCatalog } from "./catalog.js";
import type { SkillHost } from "./skill.js";
import { runInline } from "./executor.js";
import { strArg } from "@/utils/index.js";

// On-demand skill activation: lets the model load a skill's SOP into context
// (progressive disclosure) instead of every skill being inlined up front.
// Mirrors Go's LoadSkill tool.
export class LoadSkillTool implements Tool {
  name = "LoadSkill";
  description =
    "Activate a skill by name to load its workflow/SOP into context. Use this when a task matches an available skill's description.";
  category = "read" as const;
  system = true;

  constructor(
    private catalog: SkillCatalog,
    private host: SkillHost,
  ) {}

  schema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      input_schema: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Name of the skill to activate",
          },
        },
        required: ["name"],
      },
    };
  }

  execute(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const name = strArg(args, "name");
    const skill = this.catalog.get(name);
    if (!skill) {
      const available =
        this.catalog
          .list()
          .map((s) => s.name)
          .join(", ") || "(none)";
      return Promise.resolve({
        output: `Skill '${name}' not found. Available skills: ${available}`,
        isError: true,
      });
    }
    const body = runInline(skill, "", this.host);
    return Promise.resolve({
      output: `Skill '${name}' activated.\n\n${body}`,
      isError: false,
    });
  }
}
