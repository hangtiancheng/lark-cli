import { existsSync, readFileSync, statSync } from "fs";
import { isAbsolute, join } from "path";

export interface WorktreeResult {
  path: string;
  branch: string;
  headCommit: string;
  gitRoot: string;
}

// Pure filesystem-based git HEAD reading
// The following functions retrieve the branch and SHA by directly reading files
// under the .git directory, without spawning a git subprocess.

// This saves ~15ms of process startup overhead in large repositories (with millions of objects)

/** Allowed character set of ref names - prevents path traversal and shell injection */
const SAFE_REF_RE = /^[a-zA-Z0-9/._+@-]+$/;

/** Full SHA-1 (40 hex) or SHA-256 (64 hex) */
const SHA_RE = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

function isSafeRefName(name: string): boolean {
  if (!name || name.startsWith("-") || name.startsWith("/")) {
    return false;
  }
  if (name.includes("..")) {
    return false;
  }
  const segments = name.split("/");
  for (const seg of segments) {
    if (seg === "." || seg === "") {
      return false;
    }
  }

  return SAFE_REF_RE.test(name);
}

/**
 * Resolves the .git directory: handles scenarios where .git is a file instead of a directory
 * (e.g., in worktrees or submodules).
 * Returns an empty string to indicate it not a git repository
 */
export function resolveGitDir(root: string): string {
  const gitPath = join(root, ".git");
  if (!existsSync(gitPath)) {
    return "";
  }
  const stat = statSync(gitPath);
  if (stat.isDirectory()) {
    return gitPath;
  }

  // Worktree / submodule: .git is a file containing `gitdir: <path>`
  const raw = readFileSync(gitPath, "utf-8").trim();
  if (!raw.startsWith("gitdir:")) {
    return "";
  }
  const rel = raw.slice("gitdir:".length).trim();
  return isAbsolute(rel) ? rel : join(root, rel);
}


/**
 * Read the commondir file in the worktree gitDir to locate the shared git directory
 */
function getCommonDir(gitDir: string): string {
  try {
    const commonDir = join(gitDir, "commondir")
    const raw = readFileSync(commonDir, 'utf-8').trim()
    return isAbsolute(raw) ? raw : join(gitDir, raw)
  } catch (err) {
    console.error(err);
    return "";
  }
}

interface GitHead {
  branch?: string; // Non-empty indicates on a branch
  sha?: string // Non-empty indicates detached HEAD
}

/**
 * Parse the <gitDir>/HEAD file to get the current branch or detached HEAD
 * Returns null if the file does not exist or has an invalid format
 */


function readGitHead(gitDir: string): GitHead | null {
  let raw: string;
  try {
    raw = readFileSync(join(gitDir, 'HEAD'), 'utf-8').trim();
  } catch (err) {
    console.error(err);
    return null;
  }

  if (raw.startsWith("ref:")) {
    const ref = raw.slice("ref:".length).trim();
    if (ref.startsWith("refs/heads/")) {
      const name = ref.slice("refs/heads/".length);
      if (!isSafeRefName(name)) {
        return null;
      }

      return { branch: name }
    }

    // Non-standard symref (e.g., bisect) -- resolve to SHA
    if (!isSafeRefName(ref)) {
      return null;
    }

    const sha = resolveRef(gitDir, ref);
    return sha ? { sha } : null;
  }

  // Bare SHA (detached HEAD)
  if (SHA_RE.test(raw)) {
    return { sha: raw }
  }

  return null;
}

/**
 * Resolves a ref within a single git directory (checks loose files first, then packed-refs)
 */
function resolveRefInDir(dir: string, ref: string): string {
  // Check loose ref file first
  try {
    const content = readFileSync(join(dir, ref), 'utf-8').trim();
    if (content.startsWith("ref:")) {
      const target = content.slice("ref:".length).trim();
      if (!isSafeRefName(target)) {
        return "";
      }
    }
  } catch (err) {
    console.error(err);
    // Loose file does not exist, try packed-refs
  }
}
