package history

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadEmpty(t *testing.T) {
	dir := t.TempDir()
	entries := Load(dir)
	if len(entries) != 0 {
		t.Fatalf("expected 0 entries, got %d", len(entries))
	}
}

func TestAppendAndLoad(t *testing.T) {
	dir := t.TempDir()

	Append(dir, "hello")
	Append(dir, "world")

	entries := Load(dir)
	if len(entries) != 2 {
		t.Fatalf("expected 2 entries, got %d", len(entries))
	}
	if entries[0] != "hello" || entries[1] != "world" {
		t.Fatalf("unexpected entries: %v", entries)
	}
}

func TestDedup(t *testing.T) {
	dir := t.TempDir()

	Append(dir, "same")
	Append(dir, "same")

	entries := Load(dir)
	if len(entries) != 1 {
		t.Fatalf("expected 1 entry after dedup, got %d", len(entries))
	}
}

func TestTrim(t *testing.T) {
	dir := t.TempDir()

	for i := 0; i < 210; i++ {
		Append(dir, "entry"+string(rune('A'+i%26))+string(rune('0'+i/26)))
	}

	entries := Load(dir)
	if len(entries) > maxEntries {
		t.Fatalf("expected <= %d entries, got %d", maxEntries, len(entries))
	}
}

func TestFileCreated(t *testing.T) {
	dir := t.TempDir()

	Append(dir, "test")

	path := filepath.Join(dir, ".larky", "prompt_history.jsonl")
	if _, err := os.Stat(path); os.IsNotExist(err) {
		t.Fatal("history file was not created")
	}
}
