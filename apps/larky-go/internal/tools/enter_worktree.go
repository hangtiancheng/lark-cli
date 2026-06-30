package tools

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"

	"github.com/hangtiancheng/lark-cli/apps/larky/internal/worktree"
)

// EnterWorktreeTool creates an isolated git worktree and switches the session into it.
type EnterWorktreeTool struct {
	SessionID string // injected by TUI at startup
	RepoRoot  string // injected by TUI at startup
}

func (t *EnterWorktreeTool) Name() string { return "EnterWorktree" }

func (t *EnterWorktreeTool) Category() ToolCategory { return CategoryCommand }

func (t *EnterWorktreeTool) Description() string {
	return "Creates an isolated worktree (via git) and switches the session into it"
}

func (t *EnterWorktreeTool) ShouldDefer() bool { return true }

func (t *EnterWorktreeTool) Schema() map[string]any {
	return map[string]any{
		"name":        t.Name(),
		"description": t.Description(),
		"input_schema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"name": map[string]any{
					"type":        "string",
					"description": `Optional name for the worktree. Each "/"-separated segment may contain only letters, digits, dots, underscores, and dashes; max 64 chars total. A random name is generated if not provided.`,
				},
			},
		},
	}
}

func (t *EnterWorktreeTool) Execute(ctx context.Context, args map[string]any) ToolResult {
	// Guard: reject if already in a worktree session.
	if worktree.GetCurrentWorktreeSession() != nil {
		return ToolResult{
			Output:  "Already in a worktree session",
			IsError: true,
		}
	}

	slug, _ := args["name"].(string)
	if slug == "" {
		slug = generateWorktreeSlug()
	}

	repoRoot := t.RepoRoot
	if repoRoot == "" {
		return ToolResult{
			Output:  "Error: not in a git repository",
			IsError: true,
		}
	}

	session, err := worktree.CreateWorktreeForSession(ctx, t.SessionID, slug, repoRoot)
	if err != nil {
		return ToolResult{
			Output:  fmt.Sprintf("Error creating worktree: %s", err),
			IsError: true,
		}
	}

	branchInfo := ""
	if session.WorktreeBranch != "" {
		branchInfo = " on branch " + session.WorktreeBranch
	}

	return ToolResult{
		Output: fmt.Sprintf(
			"Created worktree at %s%s. The session is now working in the worktree. Use ExitWorktree to leave mid-session, or exit the session to be prompted.",
			session.WorktreePath, branchInfo,
		),
	}
}

func generateWorktreeSlug() string {
	b := make([]byte, 4)
	_, _ = rand.Read(b)
	return "wt-" + hex.EncodeToString(b)
}
