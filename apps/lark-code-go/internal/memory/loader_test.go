package memory_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/hangtiancheng/lark-cli/apps/lark-code-go/internal/memory"
)

func TestLoadContextFileExists(t *testing.T) {
	tmpDir := t.TempDir()
	path := filepath.Join(tmpDir, "context.md")

	content := "# Project Context\n\nThis is a Go project."
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}

	result := memory.LoadContextFile(path)
	if result != content {
		t.Errorf("expected %q, got %q", content, result)
	}
}

func TestLoadContextFileNonexistent(t *testing.T) {
	result := memory.LoadContextFile("/nonexistent/path/context.md")
	if result != "" {
		t.Errorf("expected empty string for nonexistent file, got %q", result)
	}
}

func TestLoadContextFileEmpty(t *testing.T) {
	tmpDir := t.TempDir()
	path := filepath.Join(tmpDir, "empty.md")
	os.WriteFile(path, []byte(""), 0o644)

	result := memory.LoadContextFile(path)
	if result != "" {
		t.Errorf("expected empty string for empty file, got %q", result)
	}
}

func TestLoadContextFileLargeContent(t *testing.T) {
	tmpDir := t.TempDir()
	path := filepath.Join(tmpDir, "large.md")

	// 10KB 内容
	content := ""
	for i := 0; i < 1000; i++ {
		content += "line " + string(rune('A'+i%26)) + "\n"
	}
	os.WriteFile(path, []byte(content), 0o644)

	result := memory.LoadContextFile(path)
	if result != content {
		t.Error("content mismatch for large file")
	}
}
