package commands

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoadDirEmptyOrMissing(t *testing.T) {
	if got := LoadDir(""); got != nil {
		t.Errorf("empty dir should return nil, got %v", got)
	}
	if got := LoadDir(filepath.Join(t.TempDir(), "nonexistent")); got != nil {
		t.Errorf("missing dir should return nil, got %v", got)
	}
}

func TestLoadDirSingleFile(t *testing.T) {
	dir := t.TempDir()
	mustWrite(t, filepath.Join(dir, "review.md"), `---
description: Review the current changes
argument-hint: "[focus]"
---

Please review the current code changes.

$ARGUMENTS
`)
	cmds := LoadDir(dir)
	if len(cmds) != 1 {
		t.Fatalf("expected 1 command, got %d", len(cmds))
	}
	c := cmds[0]
	if c.Name != "review" {
		t.Errorf("name = %q, want review", c.Name)
	}
	if c.Description != "Review the current changes" {
		t.Errorf("description = %q", c.Description)
	}
	if c.ArgPrompt != "[focus]" {
		t.Errorf("argprompt = %q", c.ArgPrompt)
	}
	if c.Type != TypePrompt {
		t.Errorf("type = %v", c.Type)
	}
	got := c.Handler(&Context{Args: "performance"})
	if !strings.Contains(got, "performance") {
		t.Errorf("$ARGUMENTS not substituted: %q", got)
	}
	if strings.Contains(got, "$ARGUMENTS") {
		t.Errorf("$ARGUMENTS placeholder leaked: %q", got)
	}
}

func TestLoadDirNestedNamespacing(t *testing.T) {
	dir := t.TempDir()
	mustWrite(t, filepath.Join(dir, "git", "log.md"), `prompt body for git:log`)
	mustWrite(t, filepath.Join(dir, "git", "branch", "list.md"), `prompt body for git:branch:list`)

	cmds := LoadDir(dir)
	got := map[string]bool{}
	for _, c := range cmds {
		got[c.Name] = true
	}
	for _, want := range []string{"git:log", "git:branch:list"} {
		if !got[want] {
			t.Errorf("missing command %q in %v", want, got)
		}
	}
}

func TestLoadDirNoFrontmatter(t *testing.T) {
	dir := t.TempDir()
	mustWrite(t, filepath.Join(dir, "hello.md"), `# Big Header

This is the first prose line.

More content.`)
	cmds := LoadDir(dir)
	if len(cmds) != 1 {
		t.Fatalf("expected 1 command, got %d", len(cmds))
	}
	if cmds[0].Description != "This is the first prose line." {
		t.Errorf("description fallback = %q", cmds[0].Description)
	}
}

func TestLoadDirHandlerNoPlaceholderWithArgs(t *testing.T) {
	dir := t.TempDir()
	mustWrite(t, filepath.Join(dir, "foo.md"), `Plain body without placeholder.`)
	cmds := LoadDir(dir)
	out := cmds[0].Handler(&Context{Args: "extra"})
	if !strings.Contains(out, "## User Request") || !strings.Contains(out, "extra") {
		t.Errorf("expected appended user request section, got %q", out)
	}
}

func TestLoadDirHandlerNoPlaceholderNoArgs(t *testing.T) {
	dir := t.TempDir()
	mustWrite(t, filepath.Join(dir, "foo.md"), `Plain body.`)
	cmds := LoadDir(dir)
	out := cmds[0].Handler(&Context{Args: ""})
	if out != "Plain body." {
		t.Errorf("expected verbatim body, got %q", out)
	}
}

func TestLoadDirAliases(t *testing.T) {
	dir := t.TempDir()
	mustWrite(t, filepath.Join(dir, "review.md"), `---
description: Review code
aliases:
  - r
  - rv
---

body
`)
	cmds := LoadDir(dir)
	if len(cmds) != 1 || len(cmds[0].Aliases) != 2 {
		t.Fatalf("expected 2 aliases, got %+v", cmds)
	}
}

func TestLoadUserCommandsMergesAndOverrides(t *testing.T) {
	work := t.TempDir()
	mewProj := filepath.Join(work, ".larky", "commands")
	mustWrite(t, filepath.Join(mewProj, "shared.md"), `from larky`)
	mustWrite(t, filepath.Join(mewProj, "only-mew.md"), `mew only`)

	cmds := LoadUserCommands(work)
	names := map[string]string{}
	for _, c := range cmds {
		names[c.Name] = c.Handler(&Context{})
	}
	if !strings.Contains(names["shared"], "from larky") {
		t.Errorf("expected 'from larky'; got %q", names["shared"])
	}
	if !strings.Contains(names["only-mew"], "mew only") {
		t.Errorf("only-mew lost: %v", names)
	}
}

func TestLoadDirSkipsNonMarkdown(t *testing.T) {
	dir := t.TempDir()
	mustWrite(t, filepath.Join(dir, "real.md"), "ok")
	mustWrite(t, filepath.Join(dir, "skip.txt"), "ignored")
	mustWrite(t, filepath.Join(dir, "SKILL.YAML"), "ignored")

	cmds := LoadDir(dir)
	if len(cmds) != 1 || cmds[0].Name != "real" {
		t.Errorf("expected only real.md picked up; got %+v", cmds)
	}
}

func mustWrite(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}
