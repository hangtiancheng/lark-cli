package tui

import (
	"strings"
	"testing"
)

func TestStreamBlockAppendAndFinalize(t *testing.T) {
	sb := NewStreamBlock()
	if sb.HasContent() {
		t.Error("expected empty stream block")
	}
	if sb.IsFinalized() {
		t.Error("expected non-finalized block")
	}

	sb.AppendToken("Hello ")
	sb.AppendToken("**world**")

	if !sb.HasContent() {
		t.Error("expected content after append")
	}
	if sb.IsFinalized() {
		t.Error("expected non-finalized before FinalizeMarkdown")
	}

	// Before finalization, Render returns raw text.
	got := sb.Render(80)
	if !strings.Contains(got, "Hello") || !strings.Contains(got, "**world**") {
		t.Errorf("expected raw text, got %q", got)
	}

	sb.FinalizeMarkdown(80)
	if !sb.IsFinalized() {
		t.Error("expected finalized after FinalizeMarkdown")
	}

	// After finalization, AppendToken is ignored.
	sb.AppendToken("ignored")
	rendered := sb.Render(80)
	if strings.Contains(rendered, "ignored") {
		t.Error("expected token append to be ignored after finalization")
	}
}

func TestStreamBlockFinalizeEmpty(t *testing.T) {
	sb := NewStreamBlock()
	sb.FinalizeMarkdown(80)
	if sb.Render(80) != "" {
		t.Errorf("expected empty render, got %q", sb.Render(80))
	}
}

func TestToolBlockSummaryPending(t *testing.T) {
	tb := NewToolBlock("bash", map[string]any{"command": "ls -la"})
	rendered := tb.Render(80)
	if !strings.Contains(rendered, "bash") {
		t.Errorf("expected tool name in summary, got %q", rendered)
	}
	if !strings.Contains(rendered, "command=") {
		t.Errorf("expected param summary, got %q", rendered)
	}
	if strings.Contains(rendered, "done") || strings.Contains(rendered, "failed") {
		t.Errorf("pending block should not show status, got %q", rendered)
	}
}

func TestToolBlockSummaryFinished(t *testing.T) {
	tb := NewToolBlock("read_file", map[string]any{"path": "/tmp/test"})
	tb.SetResult("file contents here", 42, false)
	rendered := tb.Render(80)
	if !strings.Contains(rendered, "done") {
		t.Errorf("expected 'done' status, got %q", rendered)
	}
	if !strings.Contains(rendered, "42ms") {
		t.Errorf("expected elapsed time, got %q", rendered)
	}
}

func TestToolBlockSummaryFailed(t *testing.T) {
	tb := NewToolBlock("bash", map[string]any{"command": "false"})
	tb.SetResult("exit status 1", 10, true)
	rendered := tb.Render(80)
	if !strings.Contains(rendered, "failed") {
		t.Errorf("expected 'failed' status, got %q", rendered)
	}
}

func TestToolBlockToggleExpand(t *testing.T) {
	tb := NewToolBlock("bash", map[string]any{"command": "echo hi"})
	tb.SetResult("hi\n", 5, false)

	// Initially collapsed
	rendered := tb.Render(80)
	if strings.Contains(rendered, "params") {
		t.Errorf("expected collapsed by default, got %q", rendered)
	}

	tb.Toggle()
	rendered = tb.Render(80)
	if !strings.Contains(rendered, "params") {
		t.Errorf("expected params in expanded view, got %q", rendered)
	}
	if !strings.Contains(rendered, "output") {
		t.Errorf("expected output in expanded view, got %q", rendered)
	}
	if !strings.Contains(rendered, "echo hi") {
		t.Errorf("expected command in params, got %q", rendered)
	}

	tb.Toggle()
	rendered = tb.Render(80)
	if strings.Contains(rendered, "params") {
		t.Errorf("expected collapsed after second toggle, got %q", rendered)
	}
}

func TestToolBlockToggleNoOutput(t *testing.T) {
	tb := NewToolBlock("bash", map[string]any{"command": "ls"})
	// Not finished yet - toggle should be a no-op.
	tb.Toggle()
	if tb.IsExpanded() {
		t.Error("expected no expand on unfinished block")
	}
}

func TestParamSummaryKnownTools(t *testing.T) {
	tests := []struct {
		toolName string
		params   map[string]any
		want     string
	}{
		{"read_file", map[string]any{"path": "/tmp/x"}, `path="/tmp/x"`},
		{"bash", map[string]any{"command": "ls"}, `command="ls"`},
		{"write_file", map[string]any{"path": "/tmp/y", "content": "..."}, `path="/tmp/y"`},
	}
	for _, tt := range tests {
		got := paramSummary(tt.toolName, tt.params)
		if !strings.Contains(got, tt.want) {
			t.Errorf("paramSummary(%q) = %q, want to contain %q", tt.toolName, got, tt.want)
		}
	}
}

func TestParamSummaryTruncation(t *testing.T) {
	longPath := strings.Repeat("a", 200)
	got := paramSummary("read_file", map[string]any{"path": longPath}, 50)
	if len(got) > 53 { // 50 + "..."
		t.Errorf("expected truncation, got len=%d: %q", len(got), got)
	}
	if !strings.HasSuffix(got, "...") {
		t.Errorf("expected ellipsis suffix, got %q", got)
	}
}

func TestPermissionBlockPending(t *testing.T) {
	pb := NewPermissionBlock("tu_123", "bash", "command=rm -rf")
	rendered := pb.Render(80)
	if !strings.Contains(rendered, "permission") {
		t.Errorf("expected 'permission' label, got %q", rendered)
	}
	if !strings.Contains(rendered, "bash") {
		t.Errorf("expected tool name, got %q", rendered)
	}
	if !strings.Contains(rendered, "?") {
		t.Errorf("expected pending '?' marker, got %q", rendered)
	}
}

func TestPermissionBlockResolvedAllow(t *testing.T) {
	pb := NewPermissionBlock("tu_123", "bash", "command=ls")
	pb.Resolve(DecisionAllowOnce)
	rendered := pb.Render(80)
	if !strings.Contains(rendered, "✓") {
		t.Errorf("expected ✓ for allow, got %q", rendered)
	}
	if !strings.Contains(rendered, "allowed (once)") {
		t.Errorf("expected 'allowed (once)' label, got %q", rendered)
	}
}

func TestPermissionBlockResolvedDeny(t *testing.T) {
	pb := NewPermissionBlock("tu_123", "bash", "command=rm")
	pb.Resolve(DecisionDenyOnce)
	rendered := pb.Render(80)
	if !strings.Contains(rendered, "✗") {
		t.Errorf("expected ✗ for deny, got %q", rendered)
	}
	if !strings.Contains(rendered, "denied") {
		t.Errorf("expected 'denied' label, got %q", rendered)
	}
}

func TestPermissionSelectNavigation(t *testing.T) {
	sel := NewPermissionSelect("tu_1")
	if sel.CurrentDecision() != DecisionAllowOnce {
		t.Errorf("expected initial cursor on allow_once, got %q", sel.CurrentDecision())
	}

	sel.MoveDown()
	if sel.CurrentDecision() != DecisionAlwaysAllow {
		t.Errorf("expected always_allow after down, got %q", sel.CurrentDecision())
	}

	sel.MoveDown()
	sel.MoveDown()
	if sel.CurrentDecision() != DecisionAlwaysDeny {
		t.Errorf("expected always_deny after 3 downs, got %q", sel.CurrentDecision())
	}

	// Wrap around
	sel.MoveDown()
	if sel.CurrentDecision() != DecisionAllowOnce {
		t.Errorf("expected wrap to allow_once, got %q", sel.CurrentDecision())
	}
}

func TestPermissionSelectKeyMap(t *testing.T) {
	sel := NewPermissionSelect("tu_1")
	tests := []struct {
		key      string
		expected string
	}{
		{"y", DecisionAllowOnce},
		{"a", DecisionAlwaysAllow},
		{"n", DecisionDenyOnce},
		{"d", DecisionAlwaysDeny},
		{"1", DecisionAllowOnce},
		{"4", DecisionAlwaysDeny},
		{"x", ""}, // unknown key
	}
	for _, tt := range tests {
		got, ok := sel.LookupKey(tt.key)
		if tt.expected == "" {
			if ok {
				t.Errorf("LookupKey(%q) expected not found", tt.key)
			}
			continue
		}
		if !ok {
			t.Errorf("LookupKey(%q) expected found", tt.key)
		}
		if got != tt.expected {
			t.Errorf("LookupKey(%q) = %q, want %q", tt.key, got, tt.expected)
		}
	}
}

func TestCompletionPopupFiltering(t *testing.T) {
	p := NewCompletionPopup("")

	// Initially shows all items (compact + 4 builtins = at least 5).
	if !p.HasSelection() {
		t.Error("expected selection initially")
	}

	p.SetQuery("compact")
	if !p.HasSelection() {
		t.Error("expected compact to match")
	}
	if name := p.SelectedName(); name != "compact" {
		t.Errorf("expected 'compact', got %q", name)
	}

	p.SetQuery("init")
	if !p.HasSelection() {
		t.Error("expected init to match")
	}
	if name := p.SelectedName(); name != "init" {
		t.Errorf("expected 'init', got %q", name)
	}

	p.SetQuery("nonexistent_zzz")
	if p.HasSelection() {
		t.Error("expected no match for nonexistent query")
	}
}

func TestCompletionPopupNavigation(t *testing.T) {
	p := NewCompletionPopup("")
	p.SetQuery("") // show all

	initial := p.SelectedName()
	p.MoveDown()
	afterDown := p.SelectedName()
	if initial == afterDown {
		t.Error("expected cursor to move down")
	}

	p.MoveUp()
	afterUp := p.SelectedName()
	if afterUp != initial {
		t.Errorf("expected cursor to return to %q, got %q", initial, afterUp)
	}
}

func TestRenderProgressBar(t *testing.T) {
	// Just ensure it doesn't panic and returns a non-empty string.
	bar := renderProgressBar(0.5, 10)
	if bar == "" {
		t.Error("expected non-empty progress bar")
	}

	bar80 := renderProgressBar(0.85, 10)
	if bar80 == "" {
		t.Error("expected non-empty progress bar at 85%")
	}
}

func TestTruncate(t *testing.T) {
	tests := []struct {
		input  string
		maxLen int
		want   string
	}{
		{"short", 10, "short"},
		{"exactly10", 10, "exactly10"},
		{"too long string", 5, "too l..."},
		{"", 5, ""},
	}
	for _, tt := range tests {
		got := truncate(tt.input, tt.maxLen)
		if got != tt.want {
			t.Errorf("truncate(%q, %d) = %q, want %q", tt.input, tt.maxLen, got, tt.want)
		}
	}
}

func TestIntVal(t *testing.T) {
	tests := []struct {
		input any
		want  int
	}{
		{float64(42), 42},
		{int(100), 100},
		{int64(999), 999},
		{"not a number", 0},
		{nil, 0},
	}
	for _, tt := range tests {
		got := intVal(tt.input)
		if got != tt.want {
			t.Errorf("intVal(%v) = %d, want %d", tt.input, got, tt.want)
		}
	}
}
