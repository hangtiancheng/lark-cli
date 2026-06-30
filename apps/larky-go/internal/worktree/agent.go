package worktree

import (
	"context"
	"os"
	"time"
)

// AgentWorktreeResult holds the result of CreateAgentWorktree.
type AgentWorktreeResult struct {
	WorktreePath   string
	WorktreeBranch string
	HeadCommit     string
	GitRoot        string
}

// CreateAgentWorktree creates a lightweight worktree for a sub-agent. Unlike
// CreateWorktreeForSession, it does NOT touch global session state (currentWorktreeSession,
// process.chdir, project config).
func CreateAgentWorktree(ctx context.Context, slug string) (*AgentWorktreeResult, error) {
	if err := ValidateWorktreeSlug(slug); err != nil {
		return nil, err
	}

	cwd, _ := os.Getwd()
	gitRoot := FindCanonicalGitRoot(cwd)
	if gitRoot == "" {
		return nil, &worktreeError{msg: "cannot create agent worktree: not in a git repository"}
	}

	result, err := getOrCreateWorktree(ctx, gitRoot, slug)
	if err != nil {
		return nil, err
	}

	if !result.Existed {
		performPostCreationSetup(ctx, gitRoot, result.WorktreePath)
	} else {
		// Bump mtime so periodic stale cleanup doesn't consider this stale.
		now := time.Now()
		_ = os.Chtimes(result.WorktreePath, now, now)
	}

	return &AgentWorktreeResult{
		WorktreePath:   result.WorktreePath,
		WorktreeBranch: result.WorktreeBranch,
		HeadCommit:     result.HeadCommit,
		GitRoot:        gitRoot,
	}, nil
}

// RemoveAgentWorktree removes a worktree created by CreateAgentWorktree.
func RemoveAgentWorktree(ctx context.Context, worktreePath, worktreeBranch, gitRoot string) bool {
	if gitRoot == "" {
		return false
	}

	_, _, code := runGit(ctx, gitRoot, "worktree", "remove", "--force", worktreePath)
	if code != 0 {
		return false
	}

	if worktreeBranch != "" {
		// Wait for git lockfile release (sleep).
		time.Sleep(100 * time.Millisecond)
		runGit(ctx, gitRoot, "branch", "-D", worktreeBranch)
	}
	return true
}
