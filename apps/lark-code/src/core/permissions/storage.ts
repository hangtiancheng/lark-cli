// policy.toml persistence: load and save [always] section
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const DEFAULT_POLICY_PATH = path.join(homedir(), ".lark", "policy.toml");

// Load [always] section from policy.toml; returns {tool_name: "allow"/"deny"}; empty dict if file missing
export function loadPolicyFile(filePath?: string): Record<string, string> {
  const p = filePath ?? DEFAULT_POLICY_PATH;
  if (!existsSync(p)) return {};

  const result: Record<string, string> = {};
  let inAlways = false;

  for (const line of readFileSync(p, "utf-8").split("\n")) {
    const stripped = line.trim();
    if (stripped === "[always]") {
      inAlways = true;
      continue;
    }
    if (stripped.startsWith("[")) {
      inAlways = false;
      continue;
    }
    if (inAlways && stripped.includes("=") && !stripped.startsWith("#")) {
      const eqIdx = stripped.indexOf("=");
      const k = stripped.slice(0, eqIdx).trim();
      let v = stripped.slice(eqIdx + 1).trim();
      // Strip quotes
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      if (v === "allow" || v === "deny") {
        result[k] = v;
      }
    }
  }
  return result;
}

// Write {tool_name: "allow"/"deny"} to policy.toml, overwriting [always] section
export function savePolicyFile(
  always: Record<string, string>,
  filePath?: string,
): void {
  const p = filePath ?? DEFAULT_POLICY_PATH;
  mkdirSync(path.dirname(p), { recursive: true });

  const lines = [
    "# ~/.lark/policy.toml",
    "# Managed by lark-core; manual edits are preserved if format is correct",
    "",
    "[always]",
  ];
  for (const tool of Object.keys(always).sort()) {
    const val = always[tool] ?? "";
    lines.push(`${tool} = "${val}"`);
  }
  writeFileSync(p, lines.join("\n") + "\n", "utf-8");
}
