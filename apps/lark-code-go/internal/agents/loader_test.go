package agents_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/hangtiancheng/lark-cli/apps/lark-code-go/internal/agents"
)

func TestLoadBuiltinProfilePlanner(t *testing.T) {
	profile, err := agents.LoadBuiltinProfile("planner")
	if err != nil {
		t.Fatalf("LoadBuiltinProfile('planner') failed: %v", err)
	}
	if profile.Name != "planner" {
		t.Errorf("expected name 'planner', got %q", profile.Name)
	}
	if profile.SystemPrompt == "" {
		t.Error("expected non-empty system prompt")
	}
	if len(profile.AllowedTools) == 0 {
		t.Error("expected non-empty allowed tools")
	}
}

func TestLoadBuiltinProfileExecutor(t *testing.T) {
	profile, err := agents.LoadBuiltinProfile("executor")
	if err != nil {
		t.Fatalf("LoadBuiltinProfile('executor') failed: %v", err)
	}
	if profile.Name != "executor" {
		t.Errorf("expected name 'executor', got %q", profile.Name)
	}
}

func TestLoadBuiltinProfileReviewer(t *testing.T) {
	profile, err := agents.LoadBuiltinProfile("reviewer")
	if err != nil {
		t.Fatalf("LoadBuiltinProfile('reviewer') failed: %v", err)
	}
	if profile.Name != "reviewer" {
		t.Errorf("expected name 'reviewer', got %q", profile.Name)
	}
}

func TestLoadBuiltinProfileNotFound(t *testing.T) {
	_, err := agents.LoadBuiltinProfile("nonexistent")
	if err == nil {
		t.Error("expected error for nonexistent profile")
	}
}

func TestLoadProfile(t *testing.T) {
	tmpDir := t.TempDir()
	path := filepath.Join(tmpDir, "custom.toml")

	content := `name = "custom_agent"
description = "A custom agent for testing"
system_prompt = "You are a custom agent."
allowed_tools = ["bash", "read_file"]
model = "claude-3-sonnet"
`
	os.WriteFile(path, []byte(content), 0o644)

	profile, err := agents.LoadProfile(path)
	if err != nil {
		t.Fatalf("LoadProfile failed: %v", err)
	}
	if profile.Name != "custom_agent" {
		t.Errorf("expected name 'custom_agent', got %q", profile.Name)
	}
	if profile.Description != "A custom agent for testing" {
		t.Errorf("expected description, got %q", profile.Description)
	}
	if profile.SystemPrompt != "You are a custom agent." {
		t.Errorf("expected system prompt, got %q", profile.SystemPrompt)
	}
	if len(profile.AllowedTools) != 2 {
		t.Errorf("expected 2 allowed tools, got %d", len(profile.AllowedTools))
	}
	if profile.Model != "claude-3-sonnet" {
		t.Errorf("expected model 'claude-3-sonnet', got %q", profile.Model)
	}
}

func TestLoadProfileNonexistent(t *testing.T) {
	_, err := agents.LoadProfile("/nonexistent/path/profile.toml")
	if err == nil {
		t.Error("expected error for nonexistent file")
	}
}

func TestLoadProfileInvalidTOML(t *testing.T) {
	tmpDir := t.TempDir()
	path := filepath.Join(tmpDir, "bad.toml")
	os.WriteFile(path, []byte("this is not valid toml {{{}}}"), 0o644)

	_, err := agents.LoadProfile(path)
	if err == nil {
		t.Error("expected error for invalid TOML")
	}
}

func TestLoadFromDir(t *testing.T) {
	tmpDir := t.TempDir()

	// Create multiple profile files
	os.WriteFile(filepath.Join(tmpDir, "agent1.toml"), []byte(`name = "agent1"`), 0o644)
	os.WriteFile(filepath.Join(tmpDir, "agent2.toml"), []byte(`name = "agent2"`), 0o644)
	// Non-.toml files should be skipped
	os.WriteFile(filepath.Join(tmpDir, "readme.txt"), []byte("not a profile"), 0o644)

	profiles, err := agents.LoadFromDir(tmpDir)
	if err != nil {
		t.Fatalf("LoadFromDir failed: %v", err)
	}
	if len(profiles) != 2 {
		t.Errorf("expected 2 profiles, got %d", len(profiles))
	}
}

func TestLoadFromDirNonexistent(t *testing.T) {
	profiles, err := agents.LoadFromDir("/nonexistent/dir")
	if err != nil {
		t.Fatalf("expected no error for nonexistent dir, got %v", err)
	}
	if profiles != nil {
		t.Errorf("expected nil profiles for nonexistent dir, got %v", profiles)
	}
}

func TestLoadFromDirEmpty(t *testing.T) {
	tmpDir := t.TempDir()
	profiles, err := agents.LoadFromDir(tmpDir)
	if err != nil {
		t.Fatalf("LoadFromDir failed: %v", err)
	}
	if len(profiles) != 0 {
		t.Errorf("expected 0 profiles for empty dir, got %d", len(profiles))
	}
}
