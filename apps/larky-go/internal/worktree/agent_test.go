package worktree

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestCreateAgentWorktree(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not on PATH")
	}

	repo := t.TempDir()
	initTestRepo(t, repo)

	// CreateAgentWorktree needs to be called from within a git repo
	origDir, _ := os.Getwd()
	defer os.Chdir(origDir)
	os.Chdir(repo)

	result, err := CreateAgentWorktree(context.Background(), "agent-a1234567")
	if err != nil {
		t.Fatalf("CreateAgentWorktree failed: %v", err)
	}

	expectedPath := filepath.Join(repo, ".larky", "worktrees", "agent-a1234567")
	if result.WorktreePath != expectedPath {
		t.Fatalf("expected path %q, got %q", expectedPath, result.WorktreePath)
	}
	if result.GitRoot != repo {
		t.Fatalf("expected git root %q, got %q", repo, result.GitRoot)
	}
	if result.HeadCommit == "" {
		t.Fatal("expected non-empty head commit")
	}

	// Directory should exist
	if _, err := os.Stat(result.WorktreePath); err != nil {
		t.Fatalf("worktree directory not created: %v", err)
	}

	// Session singleton should NOT be set (agent worktrees are session-less)
	if s := GetCurrentWorktreeSession(); s != nil {
		t.Fatal("CreateAgentWorktree should not touch global session")
	}
}

func TestCreateAgentWorktree_Resume(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not on PATH")
	}

	repo := t.TempDir()
	initTestRepo(t, repo)

	origDir, _ := os.Getwd()
	defer os.Chdir(origDir)
	os.Chdir(repo)

	// First call creates
	r1, err := CreateAgentWorktree(context.Background(), "agent-a7777777")
	if err != nil {
		t.Fatalf("first call failed: %v", err)
	}

	// Second call should resume (mtime bumped)
	r2, err := CreateAgentWorktree(context.Background(), "agent-a7777777")
	if err != nil {
		t.Fatalf("second call failed: %v", err)
	}
	if r2.WorktreePath != r1.WorktreePath {
		t.Fatal("resume should return same path")
	}
}

func TestRemoveAgentWorktree(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not on PATH")
	}

	repo := t.TempDir()
	initTestRepo(t, repo)

	origDir, _ := os.Getwd()
	defer os.Chdir(origDir)
	os.Chdir(repo)

	result, err := CreateAgentWorktree(context.Background(), "agent-aabcdef0")
	if err != nil {
		t.Fatalf("create failed: %v", err)
	}

	ok := RemoveAgentWorktree(context.Background(), result.WorktreePath, result.WorktreeBranch, result.GitRoot)
	if !ok {
		t.Fatal("RemoveAgentWorktree returned false")
	}

	// Directory should be gone
	if _, err := os.Stat(result.WorktreePath); !os.IsNotExist(err) {
		t.Fatal("worktree directory should be removed")
	}
}

func TestRemoveAgentWorktree_NoGitRoot(t *testing.T) {
	ok := RemoveAgentWorktree(context.Background(), "/tmp/nonexistent", "branch", "")
	if ok {
		t.Fatal("expected false when gitRoot is empty")
	}
}
