// SkillLoader: 3-tier search (project local > user global > builtin) for Markdown skill files with YAML frontmatter
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface Skill {
  name: string;
  description: string;
  allowedTools: string[];
  systemPromptTemplate: string;
}

const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*\n/;

// Parse a Markdown skill file, extracting YAML frontmatter and body system prompt
function parseSkillFile(filePath: string): Skill {
  const text = readFileSync(filePath, "utf-8");
  const stem = path.basename(filePath, ".md");
  let name = stem;
  let description = "";
  const allowedTools: string[] = [];
  let body = text;

  const match = FRONTMATTER_RE.exec(text);
  if (match) {
    const front = match[1];
    body = text.slice(match[0].length);
    const lines = front.split("\n");
    let i = 0;
    while (i < lines.length) {
      const line = lines[i] ?? "";
      const stripped = line.trim();
      if (stripped.startsWith("name:")) {
        const raw = stripped.slice(5).trim();
        name = raw.replace(/^['"]|['"]$/g, "");
      } else if (stripped.startsWith("description:")) {
        let val = stripped.slice(12).trim();
        // Handle YAML block scalar indicators (> folded, | literal)
        if (val === ">" || val === "|") {
          const fold = val === ">";
          const parts: string[] = [];
          i++;
          while (
            i < lines.length &&
            ((lines[i] ?? "").startsWith(" ") ||
              (lines[i] ?? "").startsWith("\t"))
          ) {
            parts.push((lines[i] ?? "").trim());
            i++;
          }
          description = (fold ? parts.join(" ") : parts.join("\n")).trim();
          continue;
        } else {
          val = val.replace(/^['"]|['"]$/g, "");
          description = val;
        }
      } else if (stripped.startsWith("- ")) {
        allowedTools.push(stripped.slice(2).trim());
      }
      i++;
    }
  }
  return {
    name,
    description,
    allowedTools,
    systemPromptTemplate: body.trim(),
  };
}

// Load skill definitions from Markdown files with 3-tier search (project local > user global > builtin)
export class SkillLoader {
  private _builtinDir: string;

  constructor() {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    this._builtinDir = path.join(currentDir, "builtin");
  }

  // Resolve skill name to a Skill definition; returns null if not found
  resolve(name: string): Skill | null {
    for (const p of this._searchPaths(name)) {
      if (existsSync(p)) {
        try {
          return parseSkillFile(p);
        } catch {
          return null;
        }
      }
    }
    return null;
  }

  // Return candidate paths: supports both flat (name.md) and directory (name/SKILL.md) formats
  private _searchPaths(name: string): string[] {
    const dirs = [
      path.join(".lark", "skills"),
      path.join(homedir(), ".lark", "skills"),
      this._builtinDir,
    ];
    const paths: string[] = [];
    for (const d of dirs) {
      paths.push(path.join(d, `${name}.md`));
      paths.push(path.join(d, name, "SKILL.md"));
    }
    return paths;
  }

  // List all available skill names (builtin + global + local, deduped with local taking priority)
  listAll(): string[] {
    const seen = new Map<string, true>();
    const dirs = [
      this._builtinDir,
      path.join(homedir(), ".lark", "skills"),
      path.join(".lark", "skills"),
    ];
    for (const d of dirs) {
      if (!existsSync(d)) continue;
      try {
        for (const entry of readdirSync(d).sort()) {
          const fullPath = path.join(d, entry);
          const st = statSync(fullPath);
          if (st.isFile() && entry.endsWith(".md")) {
            seen.set(path.basename(entry, ".md"), true);
          } else if (st.isDirectory()) {
            const skillFile = path.join(fullPath, "SKILL.md");
            if (existsSync(skillFile)) {
              seen.set(entry, true);
            }
          }
        }
      } catch {
        // Directory read failure is non-fatal
      }
    }
    return [...seen.keys()];
  }

  // List all available Skill objects with descriptions (local overrides builtin)
  listAllSkills(): Skill[] {
    const seen = new Map<string, Skill>();
    const dirs = [
      this._builtinDir,
      path.join(homedir(), ".lark", "skills"),
      path.join(".lark", "skills"),
    ];
    for (const d of dirs) {
      if (!existsSync(d)) continue;
      try {
        for (const entry of readdirSync(d).sort()) {
          const fullPath = path.join(d, entry);
          const st = statSync(fullPath);
          if (st.isFile() && entry.endsWith(".md")) {
            try {
              const skill = parseSkillFile(fullPath);
              seen.set(skill.name, skill);
            } catch {
              // Parse failure is non-fatal
            }
          } else if (st.isDirectory()) {
            const skillFile = path.join(fullPath, "SKILL.md");
            if (existsSync(skillFile)) {
              try {
                const skill = parseSkillFile(skillFile);
                seen.set(skill.name, skill);
              } catch {
                // Parse failure is non-fatal
              }
            }
          }
        }
      } catch {
        // Directory read failure is non-fatal
      }
    }
    return [...seen.values()];
  }

  // Render skill template, replacing $ARGUMENTS with the provided arguments
  renderPrompt(skill: Skill, args: string): string {
    return skill.systemPromptTemplate.replace(/\$ARGUMENTS/g, args);
  }
}
