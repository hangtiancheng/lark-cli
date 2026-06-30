package worktree

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestCopySettingsLocal(t *testing.T) {
	repo := t.TempDir()
	wt := t.TempDir()

	// No settings file → should not error
	copySettingsLocal(repo, wt)

	// Create settings file
	srcDir := filepath.Join(repo, ".larky")
	os.MkdirAll(srcDir, 0o755)
	srcFile := filepath.Join(srcDir, "settings.local.json")
	os.WriteFile(srcFile, []byte(`{"key":"value"}`), 0o644)

	copySettingsLocal(repo, wt)

	dst := filepath.Join(wt, ".larky", "settings.local.json")
	data, err := os.ReadFile(dst)
	if err != nil {
		t.Fatalf("settings not copied: %v", err)
	}
	if string(data) != `{"key":"value"}` {
		t.Fatalf("unexpected content: %s", data)
	}
}

func TestConfigureHooksPath(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not on PATH")
	}

	repo := t.TempDir()
	initTestRepo(t, repo)

	// Create .husky directory
	huskyDir := filepath.Join(repo, ".husky")
	os.MkdirAll(huskyDir, 0o755)

	// Create a worktree to test hooks config
	result, err := getOrCreateWorktree(context.Background(), repo, "hooks-test")
	if err != nil {
		t.Fatalf("create worktree failed: %v", err)
	}

	configureHooksPath(context.Background(), repo, result.WorktreePath)

	// Check that hooks path is set
	stdout, _, code := runGit(context.Background(), result.WorktreePath, "config", "core.hooksPath")
	if code != 0 {
		t.Fatal("core.hooksPath not set")
	}
	if trimNewline(stdout) != huskyDir {
		t.Fatalf("expected hooks path %q, got %q", huskyDir, trimNewline(stdout))
	}
}

func TestSymlinkDirectories(t *testing.T) {
	repo := t.TempDir()
	wt := t.TempDir()

	// Create source directory
	vendor := filepath.Join(repo, "vendor")
	os.MkdirAll(vendor, 0o755)

	symlinkDirectories(repo, wt, []string{"vendor"})

	link := filepath.Join(wt, "vendor")
	info, err := os.Lstat(link)
	if err != nil {
		t.Fatalf("symlink not created: %v", err)
	}
	if info.Mode()&os.ModeSymlink == 0 {
		t.Fatal("expected symlink")
	}
}

func TestSymlinkDirectories_PathTraversal(t *testing.T) {
	repo := t.TempDir()
	wt := t.TempDir()

	// Should skip path traversal attempts
	symlinkDirectories(repo, wt, []string{"../escape"})
	if _, err := os.Lstat(filepath.Join(wt, "../escape")); !os.IsNotExist(err) {
		t.Fatal("should not create symlink for path traversal")
	}
}

func TestCopyWorktreeIncludeFiles(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not on PATH")
	}

	repo := t.TempDir()
	initTestRepo(t, repo)
	wt := t.TempDir()

	// No .worktreeinclude → returns nil, nil
	copied, err := CopyWorktreeIncludeFiles(context.Background(), repo, wt)
	if err != nil || copied != nil {
		t.Fatalf("expected (nil, nil) without .worktreeinclude, got (%v, %v)", copied, err)
	}

	// Create .env (gitignored) and .worktreeinclude
	os.WriteFile(filepath.Join(repo, ".gitignore"), []byte(".env\n"), 0o644)
	os.WriteFile(filepath.Join(repo, ".env"), []byte("SECRET=abc"), 0o644)
	os.WriteFile(filepath.Join(repo, ".worktreeinclude"), []byte(".env\n"), 0o644)

	exec.Command("git", "-C", repo, "add", ".gitignore").Run()
	exec.Command("git", "-C", repo, "commit", "-m", "add gitignore").Run()

	copied, err = CopyWorktreeIncludeFiles(context.Background(), repo, wt)
	if err != nil {
		t.Fatalf("copy failed: %v", err)
	}
	if len(copied) != 1 || copied[0] != ".env" {
		t.Fatalf("expected [.env], got %v", copied)
	}

	// Verify file was copied
	data, err := os.ReadFile(filepath.Join(wt, ".env"))
	if err != nil || string(data) != "SECRET=abc" {
		t.Fatal(".env not correctly copied")
	}
}

func TestMatchesWorktreeInclude(t *testing.T) {
	tests := []struct {
		path     string
		patterns []string
		expected bool
	}{
		{".env", []string{".env"}, true},
		{".env", []string{"*.env"}, true}, // filepath.Match("*.env", ".env") matches in Go
		{"config/.env", []string{".env"}, true},
		{"config/.env", []string{"config/"}, true},
		{"other.txt", []string{".env"}, false},
	}
	for _, tt := range tests {
		got := matchesWorktreeInclude(tt.path, tt.patterns)
		if got != tt.expected {
			t.Errorf("matchesWorktreeInclude(%q, %v) = %v, want %v", tt.path, tt.patterns, got, tt.expected)
		}
	}
}

func TestFindCanonicalGitRoot(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not on PATH")
	}

	repo := t.TempDir()
	initTestRepo(t, repo)

	root := FindCanonicalGitRoot(repo)
	if root != repo {
		t.Fatalf("expected %q, got %q", repo, root)
	}

	// Non-git directory
	tmp := t.TempDir()
	root = FindCanonicalGitRoot(tmp)
	if root != "" {
		t.Fatalf("expected empty string for non-git dir, got %q", root)
	}
}
