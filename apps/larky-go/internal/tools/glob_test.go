package tools

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func setupGlobTree(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	files := []string{
		"main.go",
		"cmd/cli/main.go",
		"internal/agents/agent.go",
		"internal/agents/agent_test.go",
		"docs/readme.md",
	}
	for _, rel := range files {
		path := filepath.Join(root, rel)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return root
}

func TestGlobDoubleStarPattern(t *testing.T) {
	// Before the fix, `**/*.go` returned "No files matched the pattern."
	// because filepath.Match doesn't understand `**`. Verify the fix
	// recursively matches .go files at every depth.
	root := setupGlobTree(t)
	tool := &GlobTool{}
	res := tool.Execute(context.Background(), map[string]any{
		"pattern": "**/*.go",
		"path":    root,
	})
	if res.IsError {
		t.Fatalf("glob errored: %s", res.Output)
	}
	for _, want := range []string{"main.go", "cmd/cli/main.go", "internal/agents/agent.go", "internal/agents/agent_test.go"} {
		if !strings.Contains(res.Output, want) {
			t.Errorf("expected %q in output, got:\n%s", want, res.Output)
		}
	}
	if strings.Contains(res.Output, "readme.md") {
		t.Errorf("readme.md should NOT match **/*.go")
	}
}

func TestGlobPlainPatternStillWorks(t *testing.T) {
	root := setupGlobTree(t)
	tool := &GlobTool{}
	res := tool.Execute(context.Background(), map[string]any{
		"pattern": "*.go",
		"path":    root,
	})
	if res.IsError {
		t.Fatalf("glob errored: %s", res.Output)
	}
	// Plain `*.go` matches only top-level + same base name match at each dir.
	if !strings.Contains(res.Output, "main.go") {
		t.Errorf("plain pattern should still match base names, got:\n%s", res.Output)
	}
}
