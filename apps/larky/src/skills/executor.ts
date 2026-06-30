import type { Skill, SkillHost, SkillForkHost } from "./skill.js";

/**
 * Fail-fast dependency check: verifies that all tools declared in the skill's allowedTools are registered.
 * Throws an error if any tools are unregistered, rather than letting the model discover them during execution.
 * Aligns with the Go version's assertAllowedToolsExist.
 */
function assertAllowedToolsExist(skill: Skill, host: SkillHost): void {
  if (!skill.meta.allowedTools || skill.meta.allowedTools.length === 0) {
    return;
  }

  const registry = host.toolRegistry();
  for (const toolName of skill.meta.allowedTools) {
    if (!registry.get(toolName)) {
      throw new Error(
        `skill "${skill.meta.name}" declares allowed tool "${toolName}" which is not registered`,
      );
    }
  }
}

/**
 * Runs a skill in inline mode: injects the skill body into the current conversation context.
 *
 * Fail-fast: Throws an error if any tools in allowedTools are unregistered,
 * without activating the skill or installing filters. It is better to detect missing dependencies at call time rather than during execution.
 */
export function runInline(skill: Skill, args: string, host: SkillHost): string {
  // Perform dependency check first; the skill will not be activated if it fails
  assertAllowedToolsExist(skill, host);

  // Replace the $ARGUMENTS placeholder in the body; if no placeholder exists, append the user request
  let body = skill.body;
  if (body.includes("$ARGUMENTS")) {
    body = body.replaceAll("$ARGUMENTS", args);
  } else if (args) {
    body += `\n\nUser Request: ${args}`;
  }

  host.activateSkill(skill.meta.name, body);

  // Install the tool whitelist filter
  if (skill.meta.allowedTools) {
    const allowed = new Set(skill.meta.allowedTools);
    host.setToolFilter((name) => allowed.has(name));
  }

  return body;
}

/**
 * Runs a skill in fork mode: executes it in an isolated sub-agent.
 * Fail-fast: Checks allowedTools dependencies before execution as well.
 */
export async function runFork(skill: Skill, args: string, host: SkillForkHost): Promise<string> {
  // Perform dependency check first
  assertAllowedToolsExist(skill, host);

  let prompt = skill.body;
  if (args) {
    prompt += `\n\nARGUMENTS: ${args}`;
  }

  // Determine how much parent conversation context to carry based on forkContext configuration
  const contextMode = skill.meta.forkContext ?? "none";
  if (contextMode === "recent") {
    const context = host.snapshotParentMessages(5);
    prompt = `Context from parent conversation:\n${context}\n\n${prompt}`;
  } else if (contextMode === "full") {
    const context = host.snapshotParentMessages(100);
    prompt = `Context from parent conversation:\n${context}\n\n${prompt}`;
  }

  return host.runSubAgent(prompt, skill.meta.allowedTools);
}
