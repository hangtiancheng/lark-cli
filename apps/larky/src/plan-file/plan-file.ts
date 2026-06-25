import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const ADJECTIVES = [
  "brave",
  "calm",
  "dark",
  "eager",
  "fair",
  "gentle",
  "happy",
  "kind",
  "lively",
  "mighty",
  "noble",
  "proud",
  "quiet",
  "swift",
  "warm",
  "wise",
];

const NOUNS = [
  "crystal",
  "dragon",
  "eagle",
  "falcon",
  "flame",
  "forest",
  "frost",
  "mountain",
  "ocean",
  "phoenix",
  "river",
  "shadow",
  "thunder",
  "tiger",
];

function generateSlug(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const ts = Date.now().toString(36).slice(-4);
  return `${adj}-${noun}-${ts}`;
}

let currentPlanPath: string | null = null;

function isPlanUnderWorkDir(planPath: string, workDir: string): boolean {
  const plansDir = resolve(workDir, ".larky", "plans");
  const resolved = resolve(planPath);
  return resolved.startsWith(plansDir + "/");
}

export function getOrCreatePlanPath(workDir: string): string {
  if (currentPlanPath && existsSync(currentPlanPath)) {
    if (!isPlanUnderWorkDir(currentPlanPath, workDir)) {
      console.warn(
        `Warn: current plan path "${currentPlanPath}" is not under work dir "${workDir}/.larky/plans".`,
      );
    } else {
      return currentPlanPath;
    }
  }

  const dir = join(workDir, ".larky", "plans");
  mkdirSync(dir, { recursive: true });
  const slug = generateSlug();
  currentPlanPath = join(dir, `${slug}.md`);
  writeFileSync(currentPlanPath, "", "utf-8");
  return currentPlanPath;
}

export function savePlan(workDir: string, content: string): void {
  const path = getOrCreatePlanPath(workDir);
  writeFileSync(path, content, "utf-8");
}

export function loadPlan(): string | null {
  if (!currentPlanPath || !existsSync(currentPlanPath)) {
    return null;
  }
  return readFileSync(currentPlanPath, "utf-8");
}

export function planExists(workDir: string): boolean {
  if (!currentPlanPath || !existsSync(currentPlanPath)) {
    return false;
  }
  if (!isPlanUnderWorkDir(currentPlanPath, workDir)) {
    console.warn(
      `Warn: current plan path "${currentPlanPath}" is not under work dir "${workDir}/.larky/plans"`,
    );
    return false;
  }
  return true;
}

export function resetPlanPath(): void {
  currentPlanPath = null;
}

export function getCurrentPlanPath(): string | null {
  return currentPlanPath;
}
