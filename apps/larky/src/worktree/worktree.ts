import { execSync } from "child_process";
import {
	cpSync,
	existsSync,
	mkdirSync,
	readFileSync,
	statSync,
	symlinkSync,
} from "fs";
import { dirname, isAbsolute, join } from "path";
import { asErrorString } from "../utils/index.js";

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
		const commonDir = join(gitDir, "commondir");
		const raw = readFileSync(commonDir, "utf-8").trim();
		return isAbsolute(raw) ? raw : join(gitDir, raw);
	} catch (err) {
		console.error(err);
		return "";
	}
}

interface GitHead {
	branch?: string; // Non-empty indicates on a branch
	sha?: string; // Non-empty indicates detached HEAD
}

/**
 * Parse the <gitDir>/HEAD file to get the current branch or detached SHA
 * Returns null if the file does not exist or has an invalid format
 */

function readGitHead(gitDir: string): GitHead | null {
	let raw: string;
	try {
		raw = readFileSync(join(gitDir, "HEAD"), "utf-8").trim();
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

			return { branch: name };
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
		return { sha: raw };
	}

	return null;
}

/**
 * Resolves a ref within a single git directory (checks loose files first, then packed-refs)
 */
function resolveRefInDir(dir: string, ref: string): string {
	// Check loose ref file first
	try {
		const content = readFileSync(join(dir, ref), "utf-8").trim();
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

	// Check packed-refs
	try {
		const packed = readFileSync(join(dir, "packed-refs"), "utf-8");
		for (const line of packed.split("\n")) {
			if (!line || line.startsWith("#") || line.startsWith("^")) {
				continue;
			}
			const spaceIdx = line.indexOf(" ");
			if (spaceIdx === -1) {
				continue;
			}
			if (line.slice(spaceIdx + 1) === ref) {
				const sha = line.slice(0, spaceIdx);
				if (SHA_RE.test(sha)) {
					return sha;
				}
				return "";
			}
		}
	} catch (err) {
		console.error(err);
		// packed-refs does not exist
	}

	return "";
}

/** Resolves a git ref — checks the worktree gitDir first, then falls back to commonDir */
function resolveRef(gitDir: string, ref: string): string {
	const sha = resolveRefInDir(gitDir, ref);
	if (sha) {
		return sha;
	}

	const commonDir = getCommonDir(gitDir);
	if (commonDir && commonDir !== gitDir) {
		return resolveRefInDir(commonDir, ref);
	}
	return "";
}

/**
 * Pure filesystem read of a worktree's HEAD SHA. Directly reads the <worktreePath>/.git
 * pointer file, bypassing the upward traversal logic of resolveGitDir.
 * Returns an empty string if it is not a valid worktree.
 *
 * Performance target: ≤10ms (pure file IO, no subprocesses).
 */
export function readWorktreeHeadSha(worktreePath: string): string {
	let raw: string;
	try {
		raw = readFileSync(join(worktreePath, ".git"), "utf-8").trim();
	} catch (err) {
		console.error(err);
		return "";
	}
	if (!raw.startsWith("gitdir:")) {
		return "";
	}

	const rel = raw.slice("gitdir:".length).trim();
	const gitDir = isAbsolute(rel) ? rel : join(worktreePath, rel);

	const head = readGitHead(gitDir);
	if (!head) return "";

	if (head.branch) {
		return resolveRef(gitDir, "refs/heads/" + head.branch);
	}
	return head.sha ?? "";
}

/**
 * Gets the current branch name (pure filesystem read).
 * Returns an empty string if detached HEAD or not a git repository.
 */
export function getCurrentBranch(repoRoot: string): string {
	const gitDir = resolveGitDir(repoRoot);
	if (!gitDir) return "";
	const head = readGitHead(gitDir);
	if (!head) return "";
	return head.branch ?? "";
}

// ── Worktree Management ──────────────────────────────────────────────

export function createAgentWorktree(
	slug: string,
	gitRoot?: string,
): WorktreeResult {
	const root =
		gitRoot ??
		execSync("git rev-parse --show-toplevel", { encoding: "utf-8" }).trim();

	const worktreeDir = join(root, ".larky", "worktrees", slug);
	const branch = `worktree-${slug}`;

	// Fast path for restoration: if worktree already exists, read HEAD via pure filesystem
	if (existsSync(worktreeDir)) {
		const head = readWorktreeHeadSha(worktreeDir);
		if (head) {
			return { path: worktreeDir, branch, headCommit: head, gitRoot: root };
		}
		// Fallback to git subprocess if filesystem read fails
		const headFallback = execSync("git rev-parse HEAD", {
			cwd: worktreeDir,
			encoding: "utf-8",
		}).trim();
		return {
			path: worktreeDir,
			branch,
			headCommit: headFallback,
			gitRoot: root,
		};
	}

	// `-B` (uppercase): successfully creates even if the residual branch already exists;
	// lowercase `-b` would fail if the branch already exists.
	execSync(`git worktree add -B "${branch}" "${worktreeDir}"`, {
		cwd: root,
		encoding: "utf-8",
		stdio: ["pipe", "pipe", "pipe"],
	});

	performPostCreationSetup(root, worktreeDir);

	// Prefer filesystem read for HEAD in newly created worktrees
	const head = readWorktreeHeadSha(worktreeDir);
	if (head) {
		return { path: worktreeDir, branch, headCommit: head, gitRoot: root };
	}
	// Fallback to subprocess
	const headFallback = execSync("git rev-parse HEAD", {
		cwd: worktreeDir,
		encoding: "utf-8",
	}).trim();

	return { path: worktreeDir, branch, headCommit: headFallback, gitRoot: root };
}

export function removeAgentWorktree(
	path: string,
	branch: string,
	gitRoot: string,
): void {
	try {
		execSync(`git worktree remove "${path}" --force`, {
			cwd: gitRoot,
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
		});
	} catch (err) {
		console.error(err);
		// Worktree may have already been removed
	}

	try {
		execSync(`git branch -D "${branch}"`, {
			cwd: gitRoot,
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
		});
	} catch (err) {
		console.error(err);
		// Branch may have already been deleted
	}
}

export function hasWorktreeChanges(path: string, headCommit: string): boolean {
	try {
		const status = execSync("git status --porcelain", {
			cwd: path,
			encoding: "utf-8",
		}).trim();

		if (status) return true;

		// Compare HEAD SHA: prefer pure filesystem read
		const currentHead =
			readWorktreeHeadSha(path) ||
			execSync("git rev-parse HEAD", { cwd: path, encoding: "utf-8" }).trim();

		return currentHead !== headCommit;
	} catch (err) {
		console.error(err);
		return true; // Conservative handling on failure: assume there are changes
	}
}

export function buildWorktreeNotice(parentCwd: string, wtPath: string): string {
	return (
		`You are working in a git worktree at: ${wtPath}\n` +
		`The parent project is at: ${parentCwd}\n` +
		`Changes made here are isolated from the parent working tree.`
	);
}

/**
 * Propagates settings, hooks, symlinks, and .worktreeinclude files from the
 * main repo into a newly created worktree. Failures are logged but never
 * propagated — they must not break worktree creation.
 */
function performPostCreationSetup(repoRoot: string, wtPath: string): void {
	copyLarkySettings(repoRoot, wtPath);
	configureHooksPath(repoRoot, wtPath);
	symlinkNodeModules(repoRoot, wtPath);
	copyWorktreeIncludeFiles(repoRoot, wtPath);
}

/** Copy .larky/ settings directory from the main repo to the worktree. */
function copyLarkySettings(repoRoot: string, wtPath: string): void {
	try {
		const src = join(repoRoot, ".larky");
		if (!existsSync(src)) return;
		const dst = join(wtPath, ".larky");
		cpSync(src, dst, { recursive: true });
	} catch (err) {
		console.error(
			`Warning: failed to copy .larky/ to worktree: ${asErrorString(err)}`,
		);
	}
}

/**
 * Set core.hooksPath in the worktree so git hooks from the main repo are
 * shared. Prioritizes .husky/ over .git/hooks/.
 */
function configureHooksPath(repoRoot: string, worktreePath: string): void {
	try {
		const candidates = [
			join(repoRoot, ".husky"),
			join(repoRoot, ".git", "hooks"),
		];
		let hooksPath: string | undefined;
		for (const c of candidates) {
			try {
				const info = statSync(c);
				if (info.isDirectory()) {
					hooksPath = c;
					break;
				}
			} catch (err) {
				console.error(err);
				// candidate doesn't exist, try next
			}
		}
		if (!hooksPath) return;

		execSync(`git config core.hooksPath "${hooksPath}"`, {
			cwd: worktreePath,
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
		});
	} catch (err) {
		console.error(
			`Warning: failed to configure hooks path in worktree: ${asErrorString(err)}`,
		);
	}
}

/**
 * If node_modules exists in the source repo, create a symlink in the worktree
 * pointing to it so dependencies don't need to be re-installed.
 */
function symlinkNodeModules(repoRoot: string, worktreePath: string): void {
	try {
		const src = join(repoRoot, "node_modules");
		if (!existsSync(src)) return;
		const dst = join(worktreePath, "node_modules");
		if (existsSync(dst)) return; // already present
		symlinkSync(src, dst);
	} catch (err) {
		console.error(
			`Warning: failed to symlink node_modules in worktree: ${asErrorString(err)}`,
		);
	}
}

/**
 * If .worktreeinclude exists in the source root, read it (one path per line,
 * blank lines and #-comments skipped) and copy each listed file/directory into
 * the worktree.
 */
function copyWorktreeIncludeFiles(
	repoRoot: string,
	worktreePath: string,
): void {
	try {
		const includeFile = join(repoRoot, ".worktreeinclude");
		if (!existsSync(includeFile)) return;

		const content = readFileSync(includeFile, "utf-8");
		const paths = content
			.split("\n")
			.map((l) => l.trim())
			.filter((l) => l && !l.startsWith("#"));

		for (const relPath of paths) {
			// Guard against path traversal.
			if (relPath.includes("..")) continue;

			try {
				const src = join(repoRoot, relPath);
				if (!existsSync(src)) continue;

				const dst = join(worktreePath, relPath);
				mkdirSync(dirname(dst), { recursive: true });

				const info = statSync(src);
				if (info.isDirectory()) {
					cpSync(src, dst, { recursive: true });
				} else {
					cpSync(src, dst);
				}
			} catch (err) {
				console.error(err);
				// best-effort per file — skip failures
			}
		}
	} catch (err) {
		console.error(
			`Warning: failed to process .worktreeinclude: ${asErrorString(err)}`,
		);
	}
}
