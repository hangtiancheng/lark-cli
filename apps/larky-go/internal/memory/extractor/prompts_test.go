package extractor

import (
	"strings"
	"testing"
)

func TestBuildExtractAutoOnlyPromptMarkers(t *testing.T) {
	got := BuildExtractAutoOnlyPrompt(7, "", false, "/home/test/.larky/memory/", "/tmp/proj/.larky/memory/")
	for _, expect := range []string{
		"memory extraction subagent",
		"most recent ~7 messages",
		"Available tools: ReadFile, Grep, Glob, read-only Bash",
		"EditFile/WriteFile",
		"## Types of memory",
		"## What NOT to save in memory",
		"## How to save memories",
		"**Step 1**",
		"**Step 2** — add a pointer",
		"MEMORY.md",
	} {
		if !strings.Contains(got, expect) {
			t.Errorf("missing %q in prompt", expect)
		}
	}
}

func TestBuildExtractAutoOnlyPromptSkipIndex(t *testing.T) {
	got := BuildExtractAutoOnlyPrompt(5, "", true, "/home/test/.larky/memory/", "/tmp/proj/.larky/memory/")
	if strings.Contains(got, "**Step 2** — add a pointer") {
		t.Errorf("skipIndex=true should remove Step 2 / MEMORY.md update section")
	}
	if !strings.Contains(got, "Write each memory to its own file") {
		t.Errorf("skipIndex=true should still include single-step write instructions")
	}
}

func TestBuildExtractAutoOnlyPromptIncludesExistingManifest(t *testing.T) {
	manifest := "- [user] foo.md (2026-05-22T01:00:00.000Z): existing note"
	got := BuildExtractAutoOnlyPrompt(3, manifest, false, "/home/test/.larky/memory/", "/tmp/proj/.larky/memory/")
	if !strings.Contains(got, "## Existing memory files") {
		t.Errorf("manifest section header missing")
	}
	if !strings.Contains(got, "foo.md") {
		t.Errorf("manifest content not embedded: %s", got)
	}
	if !strings.Contains(got, "update an existing file rather than creating a duplicate") {
		t.Errorf("dedup guidance missing")
	}
}

func TestBuildExtractAutoOnlyPromptNoTeamSection(t *testing.T) {
	// Dual-path mode uses <scope> tags for user-level / project-level routing, but the
	// "team memory" / "private or team" guidance from the Claude Code COMBINED variant
	// must still never appear — Larky keeps the user/project split simple.
	got := BuildExtractAutoOnlyPrompt(3, "", false, "/home/test/.larky/memory/", "/tmp/proj/.larky/memory/")
	for _, banned := range []string{
		"team memor",
		"private or team",
	} {
		if strings.Contains(got, banned) {
			t.Errorf("dual-path prompt must not contain %q", banned)
		}
	}
}

func TestBuildExtractAutoOnlyPromptIncludesGuardrails(t *testing.T) {
	got := BuildExtractAutoOnlyPrompt(3, "", false, "/home/test/.larky/memory/", "/tmp/proj/.larky/memory/")
	for _, expect := range []string{
		"MCP, Agent, write-capable Bash, etc — will be denied",
		"Do not interleave reads and writes",
		"no grepping source files",
		"forget something, find and remove",
	} {
		if !strings.Contains(got, expect) {
			t.Errorf("missing guardrail %q", expect)
		}
	}
}
