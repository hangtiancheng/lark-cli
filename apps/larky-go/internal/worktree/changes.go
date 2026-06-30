package worktree

import (
	"context"
	"strconv"
	"strings"
)

// ChangeSummary holds the result of countWorktreeChanges.
type ChangeSummary struct {
	ChangedFiles int
	Commits      int
}

// HasWorktreeChanges returns true if the worktree has uncommitted changes or new commits since
// headCommit. Returns true on git failure (fail-closed).
func HasWorktreeChanges(ctx context.Context, worktreePath, headCommit string) bool {
	stdout, _, code := runGit(ctx, worktreePath, "status", "--porcelain")
	if code != 0 {
		return true // fail-closed
	}
	if strings.TrimSpace(stdout) != "" {
		return true
	}

	stdout, _, code = runGit(ctx, worktreePath, "rev-list", "--count", headCommit+"..HEAD")
	if code != 0 {
		return true // fail-closed
	}
	n, err := strconv.Atoi(strings.TrimSpace(stdout))
	if err != nil {
		return true // fail-closed
	}
	return n > 0
}

// CountWorktreeChanges returns a detailed change summary, or nil when state cannot be reliably
// determined. Callers that use this as a safety gate must treat nil as "unknown, assume unsafe"
// (fail-closed).
func CountWorktreeChanges(ctx context.Context, worktreePath, originalHeadCommit string) *ChangeSummary {
	stdout, _, code := runGit(ctx, worktreePath, "status", "--porcelain")
	if code != 0 {
		return nil // fail-closed
	}
	changedFiles := 0
	for _, line := range strings.Split(stdout, "\n") {
		if strings.TrimSpace(line) != "" {
			changedFiles++
		}
	}

	if originalHeadCommit == "" {
		// Without a baseline commit we cannot count commits. Fail-closed.
		return nil
	}

	stdout, _, code = runGit(ctx, worktreePath, "rev-list", "--count", originalHeadCommit+"..HEAD")
	if code != 0 {
		return nil // fail-closed
	}
	commits, err := strconv.Atoi(strings.TrimSpace(stdout))
	if err != nil {
		return nil
	}

	return &ChangeSummary{
		ChangedFiles: changedFiles,
		Commits:      commits,
	}
}
