import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import yaml from "js-yaml";
import type { Skill, SkillMeta } from "./skill.js";
import { parse, z } from "zod";
/**
 * Internal skill storage with source file path and load timestamp for hot reloading
 *
 */
interface CatalogEntry {
  skill: Skill;
  /** Absolute path to SKILL.md, used for re-reading during hot reloading */
  filePath: string;

  /** File modification time (ms) when last loaded. 0 indicates a built-in skill that requires no reloading */
  loadedMtimeMs: number;
}

export class SkillCatalog {
  private entries = new Map<string, CatalogEntry>();

  load(workDir: string): void {
    // Scan user directory first, then project directory. Project skills override user skills with the same name.
    const dirs = [
      join(homedir(), ".trae", "skills"),
      join(homedir(), ".claude", "skills"),
      join(homedir(), ".github", "skills"),
      join(homedir(), ".larky", "skills"),
      join(workDir, ".trae", "skills"),
      join(workDir, ".claude", "skills"),
      join(workDir, ".github", "skills"),
      join(workDir, ".larky", "skills"),
    ];

    for (const dir of dirs) {
      if (!existsSync(dir)) {
        continue;
      }

      this.scanDirectory(dir);
    }
  }
  scanDirectory(dir: string) {
    let dirEntries: string[];
    try {
      dirEntries = readdirSync(dir);
    } catch {
      return;
    }

    for (const entry of dirEntries) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);

      if (stat.isDirectory()) {
        const skillFile = join(fullPath, "SKILL.md");
        if (existsSync(skillFile)) {
          this.loadSkill(skillFile, fullPath, true);
        }
      }
    }
  }
  loadSkill(filePath: string, sourceDir: string, isDirectory: boolean) {
    try {
      const raw = readFileSync(filePath, "utf-8");
      const parsed = parseSkillFile(raw);
      if (!parsed) {
        return;
      }

      const skill: Skill = {
        meta: parsed.meta,
        body: parsed.body,
        sourceDir,
        isDirectory,
      };

      // Record file modification time for subsequent hot reload detection
      let mtimeMs = 0;
      try {
        mtimeMs = statSync(filePath).mtimeMs;
      } catch {
        // Fail gracefully if timestamp cannot be retrieved
      }

      this.entries.set(skill.meta.name, {
        skill,
        filePath,
        loadedMtimeMs: mtimeMs,
      });
    } catch (err) {
      console.error(err);
      // Skip invalid skill
    }
  }

  list(): SkillMeta[] {
    return [...this.entries.values()].map((e) => e.skill.meta);
  }

  /**
   * Gets a skill with hot reload support: automatically re-reads the file if it has been modified on disk.
   * Aligns with the Go version's GetFull: re-reads the body on every call (hot reload),
   * and retains the cached body if reading fails.
   */
  get(name: string): Skill | undefined {
    const entry = this.entries.get(name);
    if (!entry) {
      return undefined;
    }

    // Attempt hot reload: check if the file has been modified
    if (entry.filePath && entry.loadedMtimeMs > 0) {
      try {
        const currentMtime = statSync(entry.filePath).mtimeMs;
        if (currentMtime > entry.loadedMtimeMs) {
          // File has been modified, re-read it
          const raw = readFileSync(entry.filePath, "utf-8");
          const parsed = parseSkillFile(raw);
          if (parsed) {
            entry.skill = {
              meta: parsed.meta,
              body: parsed.body,
              sourceDir: entry.skill.sourceDir,
              isDirectory: entry.skill.isDirectory,
            };
            entry.loadedMtimeMs = currentMtime;
          }
          // Retain the cached version if parsing fails (consistent with Go behavior)
        }
      } catch {
        // Retain the cached version if reading fails
      }
    }

    return entry.skill;
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }
}

const YamlFrontmatterSchema = z.looseObject({
  name: z.string(),
  description: z.string().optional(),
  allowed_tools: z.array(z.string()).optional(),
  mode: z.enum(["inline", "fork"]).optional(),
  model: z.string().optional(),
  fork_context: z.enum(["full", "none", "recent"]).optional(),
});

function parseSkillFile(content: string): {
  meta: SkillMeta;
  body: string;
} | null {
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
    const data = parse(YamlFrontmatterSchema, raw);
    return {
      meta: {
        name: data.name,
        description: data.description ?? "",
        allowedTools: data.allowed_tools,
        mode: data.mode ?? "inline",
        model: data.model,
        forkContext: data.fork_context,
      },
      body,
    };
  } catch (err) {
    console.error(err);
    return null;
  }
}
