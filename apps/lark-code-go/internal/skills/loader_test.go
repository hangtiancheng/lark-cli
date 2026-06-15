package skills_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/hangtiancheng/lark-cli/apps/lark-code-go/internal/skills"
)

func TestLoaderResolveBuiltin(t *testing.T) {
	loader := skills.NewLoader()

	skill, err := loader.Resolve("init", "")
	if err != nil {
		t.Fatalf("Resolve('init') failed: %v", err)
	}
	if skill.Name != "init" {
		t.Errorf("expected name 'init', got %q", skill.Name)
	}
	if skill.Description == "" {
		t.Error("expected non-empty description")
	}
}

func TestLoaderResolveAllBuiltins(t *testing.T) {
	loader := skills.NewLoader()

	names := []string{"init", "orchestrate", "review", "summarize"}
	for _, name := range names {
		skill, err := loader.Resolve(name, "")
		if err != nil {
			t.Errorf("Resolve(%q) failed: %v", name, err)
			continue
		}
		if skill.Name != name {
			t.Errorf("expected name %q, got %q", name, skill.Name)
		}
	}
}

func TestLoaderResolveNotFound(t *testing.T) {
	loader := skills.NewLoader()

	_, err := loader.Resolve("nonexistent_skill", "")
	if err == nil {
		t.Error("expected error for nonexistent skill")
	}
}

func TestLoaderResolveProjectLevel(t *testing.T) {
	tmpDir := t.TempDir()

	// 创建项目级 skill
	skillsDir := filepath.Join(tmpDir, ".lark", "skills")
	os.MkdirAll(skillsDir, 0o755)

	skillContent := `---
description: Custom project skill
allowed_tools:
  - bash
  - read_file
---
This is a custom skill for the project. $ARGUMENTS`

	os.WriteFile(filepath.Join(skillsDir, "custom.md"), []byte(skillContent), 0o644)

	loader := skills.NewLoader()
	skill, err := loader.Resolve("custom", tmpDir)
	if err != nil {
		t.Fatalf("Resolve('custom') failed: %v", err)
	}
	if skill.Name != "custom" {
		t.Errorf("expected name 'custom', got %q", skill.Name)
	}
	if skill.Description != "Custom project skill" {
		t.Errorf("expected description 'Custom project skill', got %q", skill.Description)
	}
	if len(skill.AllowedTools) != 2 {
		t.Errorf("expected 2 allowed tools, got %d", len(skill.AllowedTools))
	}
}

func TestLoaderProjectOverridesBuiltin(t *testing.T) {
	tmpDir := t.TempDir()

	skillsDir := filepath.Join(tmpDir, ".lark", "skills")
	os.MkdirAll(skillsDir, 0o755)

	// 覆盖内置 init skill
	os.WriteFile(filepath.Join(skillsDir, "init.md"), []byte("---\ndescription: Custom init\n---\nCustom init prompt"), 0o644)

	loader := skills.NewLoader()
	skill, err := loader.Resolve("init", tmpDir)
	if err != nil {
		t.Fatalf("Resolve('init') failed: %v", err)
	}
	if skill.Description != "Custom init" {
		t.Errorf("expected project-level override, got description %q", skill.Description)
	}
}

func TestLoaderListAll(t *testing.T) {
	loader := skills.NewLoader()

	skills := loader.ListAll()
	if len(skills) < 4 {
		t.Errorf("expected at least 4 builtin skills, got %d", len(skills))
	}
}

func TestLoaderRenderPrompt(t *testing.T) {
	loader := skills.NewLoader()

	skill := &skills.Skill{
		Name:           "test",
		PromptTemplate: "Do the task: $ARGUMENTS",
	}

	rendered := loader.RenderPrompt(skill, "fix the bug")
	if rendered != "Do the task: fix the bug" {
		t.Errorf("expected 'Do the task: fix the bug', got %q", rendered)
	}
}

func TestLoaderRenderPromptNoArgs(t *testing.T) {
	loader := skills.NewLoader()

	skill := &skills.Skill{
		Name:           "test",
		PromptTemplate: "No arguments needed",
	}

	rendered := loader.RenderPrompt(skill, "")
	if rendered != "No arguments needed" {
		t.Errorf("expected 'No arguments needed', got %q", rendered)
	}
}

func TestParseSkillFileWithoutFrontmatter(t *testing.T) {
	tmpDir := t.TempDir()
	skillsDir := filepath.Join(tmpDir, ".lark", "skills")
	os.MkdirAll(skillsDir, 0o755)

	// 没有 frontmatter 的 skill
	os.WriteFile(filepath.Join(skillsDir, "simple.md"), []byte("Just a simple prompt"), 0o644)

	loader := skills.NewLoader()
	skill, err := loader.Resolve("simple", tmpDir)
	if err != nil {
		t.Fatalf("Resolve('simple') failed: %v", err)
	}
	if skill.Description != "Run the simple skill" {
		t.Errorf("expected default description, got %q", skill.Description)
	}
}
