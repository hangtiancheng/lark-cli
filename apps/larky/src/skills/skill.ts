import type { ToolRegistry } from "../tools/registry.js";

export interface SkillMeta {
  name: string;
  description: string;
  allowedTools?: string[];
  mode: "inline" | "fork";
  model?: string;
  forkContext?: "full" | "recent" | "none";
}

export interface Skill {
  meta: SkillMeta;
  body: string;
  sourceDir: string;
  isDirectory: boolean;
}

export interface SkillHost {
  activateSkill(name: string, body: string): void;
  setToolFilter(filter: ((name: string) => boolean) | null): void;
  toolRegistry(): ToolRegistry;
}

export interface SkillForkHost extends SkillHost {
  runSubAgent(prompt: string, toolFilter?: string[]): Promise<string>;
  snapshotParentMessages(count: number): string;
}
