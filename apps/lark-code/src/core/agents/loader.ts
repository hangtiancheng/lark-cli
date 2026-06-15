// Agent profile loader: parse TOML agent profile files with 3-tier search (project local > user global > builtin)
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import toml from "toml";

import { isRecord } from "../bus/envelope.js";

export interface AgentProfile {
  name: string;
  description: string;
  systemPrompt: string;
  allowedTools: string[];
  model: string;
}

// Search and parse agent profile configs by two-tier priority (project local > user global > builtin)
export class AgentProfileLoader {
  private _builtinDir: string;

  constructor() {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    this._builtinDir = path.join(currentDir, "builtin");
  }

  // Load an agent profile by name; returns null if not found
  load(name: string): AgentProfile | null {
    for (const profilePath of this._searchPaths(name)) {
      if (existsSync(profilePath)) {
        try {
          return this._parse(profilePath, name);
        } catch {
          return null;
        }
      }
    }
    return null;
  }

  // Return [project local, user global, builtin] paths; load() returns the first existing one
  private _searchPaths(name: string): string[] {
    const builtin = path.join(this._builtinDir, `${name}.toml`);
    const globalDir = path.join(homedir(), ".lark", "agents", `${name}.toml`);
    const local = path.join(".lark", "agents", `${name}.toml`);
    return [local, globalDir, builtin];
  }

  // Parse a TOML agent profile file
  private _parse(profilePath: string, name: string): AgentProfile {
    const content = readFileSync(profilePath, "utf-8");
    const parsed: unknown = toml.parse(content);
    if (!isRecord(parsed)) {
      throw new Error(`Invalid TOML structure in ${profilePath}`);
    }
    const agentRaw = parsed["agent"];
    const agent = isRecord(agentRaw) ? agentRaw : {};
    const allowedRaw = agent["allowed_tools"];
    return {
      name,
      description: typeof agent["description"] === "string" ? agent["description"] : "",
      systemPrompt: typeof agent["system_prompt"] === "string" ? agent["system_prompt"].trim() : "",
      allowedTools: Array.isArray(allowedRaw) ? allowedRaw.map(String) : [],
      model: typeof agent["model"] === "string" ? agent["model"] : "",
    };
  }
}
