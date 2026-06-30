package memory

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoadInstructionsBasic(t *testing.T) {
	dir := t.TempDir()
	mustInitGit(t, dir)

	mustWrite(t, filepath.Join(dir, "LARKY.md"), "root larky rules")
	mustWrite(t, filepath.Join(dir, "AGENTS.md"), "root agents rules")
	mustWrite(t, filepath.Join(dir, ".larky", "INSTRUCTIONS.md"), "legacy instructions")

	out := LoadInstructions(dir)
	for _, want := range []string{"root larky rules", "root agents rules", "legacy instructions"} {
		if !strings.Contains(out, want) {
			t.Errorf("missing %q in output:\n%s", want, out)
		}
	}
}

func TestLoadInstructionsWalksUp(t *testing.T) {
	root := t.TempDir()
	mustInitGit(t, root)
	sub := filepath.Join(root, "pkg", "deep")
	if err := os.MkdirAll(sub, 0o755); err != nil {
		t.Fatal(err)
	}
	mustWrite(t, filepath.Join(root, "LARKY.md"), "from root")
	mustWrite(t, filepath.Join(sub, "LARKY.md"), "from leaf")

	out := LoadInstructions(sub)
	rootIdx := strings.Index(out, "from root")
	leafIdx := strings.Index(out, "from leaf")
	if rootIdx == -1 || leafIdx == -1 {
		t.Fatalf("both files should appear; got:\n%s", out)
	}
	if rootIdx >= leafIdx {
		t.Errorf("leaf file should be ordered after root (higher priority); root=%d leaf=%d", rootIdx, leafIdx)
	}
}

func TestExpandIncludesResolvesRelative(t *testing.T) {
	dir := t.TempDir()
	mustInitGit(t, dir)

	mustWrite(t, filepath.Join(dir, "rules", "style.md"), "style rule")
	mustWrite(t, filepath.Join(dir, "LARKY.md"), "header\n@./rules/style.md\nfooter\n")

	out := LoadInstructions(dir)
	if !strings.Contains(out, "style rule") {
		t.Errorf("@include did not expand:\n%s", out)
	}
	if !strings.Contains(out, "header") || !strings.Contains(out, "footer") {
		t.Errorf("surrounding text was dropped:\n%s", out)
	}
}

func TestExpandIncludesIgnoresCycles(t *testing.T) {
	dir := t.TempDir()
	mustInitGit(t, dir)

	mustWrite(t, filepath.Join(dir, "a.md"), "from a\n@./b.md\n")
	mustWrite(t, filepath.Join(dir, "b.md"), "from b\n@./a.md\n")
	mustWrite(t, filepath.Join(dir, "LARKY.md"), "@./a.md\n")

	out := LoadInstructions(dir)
	if strings.Count(out, "from a") != 1 || strings.Count(out, "from b") != 1 {
		t.Errorf("cycle protection failed:\n%s", out)
	}
}

func TestExpandIncludesSkipsInsideCodeFences(t *testing.T) {
	dir := t.TempDir()
	mustInitGit(t, dir)

	mustWrite(t, filepath.Join(dir, "skipped.md"), "should not appear")
	mustWrite(t, filepath.Join(dir, "LARKY.md"), "```\n@./skipped.md\n```\n")

	out := LoadInstructions(dir)
	if strings.Contains(out, "should not appear") {
		t.Errorf("include inside fenced code block was expanded:\n%s", out)
	}
}

func TestParseIncludeOnlyAcceptsPathLike(t *testing.T) {
	cases := map[string]string{
		"@./foo.md":     "./foo.md",
		"@~/bar.md":     "~/bar.md",
		"@/abs/path.md": "/abs/path.md",
		"@../up.md":     "../up.md",
		"@username":     "",
		"@@escaped":     "",
		"@ ./space.md":  "",
		"plain text":    "",
	}
	for in, want := range cases {
		if got := parseInclude(in); got != want {
			t.Errorf("parseInclude(%q) = %q, want %q", in, got, want)
		}
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

func mustInitGit(t *testing.T, dir string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Join(dir, ".git"), 0o755); err != nil {
		t.Fatal(err)
	}
}
