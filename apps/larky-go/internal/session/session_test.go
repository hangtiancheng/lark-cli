package session

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestNewID(t *testing.T) {
	id := NewID()
	if len(id) != 20 { // 20060102-150405-xxxx
		t.Fatalf("unexpected ID format: %s (len=%d)", id, len(id))
	}
	// Two IDs generated in the same second should not be identical
	id2 := NewID()
	if id == id2 {
		t.Fatalf("two IDs generated in same second collided: %s", id)
	}
}

func TestSaveAndLoad(t *testing.T) {
	dir := t.TempDir()
	sid := "test-session"

	SaveMessage(dir, sid, Message{Role: "user", Content: "hello", Ts: 1})
	SaveMessage(dir, sid, Message{Role: "assistant", Content: "hi", Ts: 2})

	msgs := LoadSession(dir, sid)
	if len(msgs) != 2 {
		t.Fatalf("expected 2 messages, got %d", len(msgs))
	}
	if msgs[0].Role != "user" || msgs[0].Content != "hello" {
		t.Fatalf("unexpected first message: %+v", msgs[0])
	}
	if msgs[1].Role != "assistant" || msgs[1].Content != "hi" {
		t.Fatalf("unexpected second message: %+v", msgs[1])
	}
}

func TestLoadEmpty(t *testing.T) {
	dir := t.TempDir()
	msgs := LoadSession(dir, "nonexistent")
	if len(msgs) != 0 {
		t.Fatalf("expected 0 messages, got %d", len(msgs))
	}
}

func TestListSessions(t *testing.T) {
	dir := t.TempDir()

	SaveMessage(dir, "s1", Message{Role: "user", Content: "first session", Ts: 1})
	SaveMessage(dir, "s2", Message{Role: "user", Content: "second session", Ts: 2})
	SaveMessage(dir, "s2", Message{Role: "assistant", Content: "reply", Ts: 3})

	sessions := ListSessions(dir)
	if len(sessions) != 2 {
		t.Fatalf("expected 2 sessions, got %d", len(sessions))
	}

	found := map[string]bool{}
	for _, s := range sessions {
		found[s.ID] = true
		if s.ID == "s2" && s.MessageCount != 2 {
			t.Fatalf("expected 2 messages in s2, got %d", s.MessageCount)
		}
	}
	if !found["s1"] || !found["s2"] {
		t.Fatalf("missing sessions: %v", sessions)
	}
}

func TestFileCreated(t *testing.T) {
	dir := t.TempDir()
	SaveMessage(dir, "test", Message{Role: "user", Content: "hi", Ts: 1})

	path := filepath.Join(dir, ".larky", "sessions", "test.jsonl")
	if _, err := os.Stat(path); os.IsNotExist(err) {
		t.Fatal("session file was not created")
	}
}

func TestFormatRelativeTime(t *testing.T) {
	now := time.Now()
	if got := FormatRelativeTime(now.Add(-30 * time.Second)); got != "just now" {
		t.Fatalf("expected 'just now', got %s", got)
	}
	if got := FormatRelativeTime(now.Add(-5 * time.Minute)); got != "5 minutes ago" {
		t.Fatalf("expected '5 minutes ago', got %s", got)
	}
	if got := FormatRelativeTime(now.Add(-3 * time.Hour)); got != "3 hours ago" {
		t.Fatalf("expected '3 hours ago', got %s", got)
	}
}

func TestFormatFileSize(t *testing.T) {
	if got := FormatFileSize(500); got != "500B" {
		t.Fatalf("expected '500B', got %s", got)
	}
	if got := FormatFileSize(53862); got != "52.6KB" {
		t.Fatalf("expected '52.6KB', got %s", got)
	}
}

// A session that contains a compact_boundary must rebuild to the COMPACTED
// state on resume: the boundary's summary + the inlined kept tail + any plain
// messages appended after the boundary — while the original pre-compaction
// prefix written before the boundary is NOT replayed.
func TestFindLastCompactBoundary_RebuildsCompactedState(t *testing.T) {
	dir := t.TempDir()
	sid := "compacted-session"

	// Original pre-compaction prefix (must NOT be replayed after the boundary).
	SaveMessage(dir, sid, Message{Role: "user", Content: "ORIGINAL-PREFIX-1", Ts: 1})
	SaveMessage(dir, sid, Message{Role: "assistant", Content: "ORIGINAL-PREFIX-2", Ts: 2})
	SaveMessage(dir, sid, Message{Role: "user", Content: "ORIGINAL-PREFIX-3", Ts: 3})

	// Compaction fires: write a boundary inlining the summary + kept tail.
	keep := []KeepMessage{
		{Role: "user", Content: "KEPT-TAIL-USER"},
		{Role: "assistant", Content: "KEPT-TAIL-ASSISTANT"},
	}
	SaveCompactBoundary(dir, sid, "THE-SUMMARY", keep)

	// Continuation after the boundary (must be replayed).
	SaveMessage(dir, sid, Message{Role: "user", Content: "AFTER-BOUNDARY-USER", Ts: 5})
	SaveMessage(dir, sid, Message{Role: "assistant", Content: "AFTER-BOUNDARY-ASSISTANT", Ts: 6})

	msgs := LoadSession(dir, sid)

	boundary, after, ok := FindLastCompactBoundary(msgs)
	if !ok {
		t.Fatalf("expected a compact boundary to be found")
	}
	if boundary.Summary != "THE-SUMMARY" {
		t.Fatalf("summary mismatch: got %q", boundary.Summary)
	}
	// Kept tail (boundary-inlined) must round-trip with original role + content.
	if len(boundary.Keep) != 2 ||
		boundary.Keep[0] != (KeepMessage{Role: "user", Content: "KEPT-TAIL-USER"}) ||
		boundary.Keep[1] != (KeepMessage{Role: "assistant", Content: "KEPT-TAIL-ASSISTANT"}) {
		t.Fatalf("kept tail not round-tripped: %+v", boundary.Keep)
	}
	// After-boundary messages present and in order; original prefix absent.
	if len(after) != 2 {
		t.Fatalf("expected 2 after-boundary messages, got %d: %+v", len(after), after)
	}
	if after[0].Content != "AFTER-BOUNDARY-USER" || after[1].Content != "AFTER-BOUNDARY-ASSISTANT" {
		t.Fatalf("after-boundary content mismatch: %+v", after)
	}
	for _, m := range after {
		if strings.Contains(m.Content, "ORIGINAL-PREFIX") {
			t.Fatalf("original pre-compaction prefix must not appear after the boundary: %q", m.Content)
		}
	}

	// Simulate the resume rebuild the TUI performs and assert the final
	// reconstructed conversation: [summary] + keep + after, with no original
	// prefix.
	var rebuilt []Message
	rebuilt = append(rebuilt, Message{Role: "user", Content: boundary.Summary})
	for _, k := range boundary.Keep {
		rebuilt = append(rebuilt, Message{Role: k.Role, Content: k.Content})
	}
	rebuilt = append(rebuilt, after...)

	wantOrder := []string{
		"THE-SUMMARY", "KEPT-TAIL-USER", "KEPT-TAIL-ASSISTANT",
		"AFTER-BOUNDARY-USER", "AFTER-BOUNDARY-ASSISTANT",
	}
	if len(rebuilt) != len(wantOrder) {
		t.Fatalf("rebuilt length %d != expected %d: %+v", len(rebuilt), len(wantOrder), rebuilt)
	}
	for i, want := range wantOrder {
		if rebuilt[i].Content != want {
			t.Fatalf("rebuilt[%d] = %q, want %q", i, rebuilt[i].Content, want)
		}
	}
	for _, m := range rebuilt {
		if strings.Contains(m.Content, "ORIGINAL-PREFIX") {
			t.Fatalf("original prefix leaked into rebuilt conversation: %q", m.Content)
		}
	}
}

// The LAST boundary wins: a session compacted twice must rebuild from the most
// recent boundary, and messages between the two boundaries must not replay.
func TestFindLastCompactBoundary_UsesLastBoundary(t *testing.T) {
	dir := t.TempDir()
	sid := "twice-compacted"

	SaveMessage(dir, sid, Message{Role: "user", Content: "GEN0", Ts: 1})
	SaveCompactBoundary(dir, sid, "SUMMARY-1", []KeepMessage{{Role: "user", Content: "KEEP-1"}})
	SaveMessage(dir, sid, Message{Role: "assistant", Content: "BETWEEN-BOUNDARIES", Ts: 3})
	SaveCompactBoundary(dir, sid, "SUMMARY-2", []KeepMessage{{Role: "assistant", Content: "KEEP-2"}})
	SaveMessage(dir, sid, Message{Role: "user", Content: "NEWEST", Ts: 5})

	msgs := LoadSession(dir, sid)
	boundary, after, ok := FindLastCompactBoundary(msgs)
	if !ok {
		t.Fatalf("expected a boundary")
	}
	if boundary.Summary != "SUMMARY-2" {
		t.Fatalf("expected last boundary SUMMARY-2, got %q", boundary.Summary)
	}
	if len(boundary.Keep) != 1 || boundary.Keep[0].Content != "KEEP-2" {
		t.Fatalf("expected KEEP-2, got %+v", boundary.Keep)
	}
	if len(after) != 1 || after[0].Content != "NEWEST" {
		t.Fatalf("expected only NEWEST after last boundary, got %+v", after)
	}
}

// Backward compatibility: a session WITHOUT any boundary (old format) must
// report ok=false so the caller replays every message verbatim.
func TestFindLastCompactBoundary_NoBoundaryFullReplay(t *testing.T) {
	dir := t.TempDir()
	sid := "legacy-session"

	SaveMessage(dir, sid, Message{Role: "user", Content: "hello", Ts: 1})
	SaveMessage(dir, sid, Message{Role: "assistant", Content: "hi", Ts: 2})
	SaveMessage(dir, sid, Message{Role: "user", Content: "again", Ts: 3})

	msgs := LoadSession(dir, sid)
	_, _, ok := FindLastCompactBoundary(msgs)
	if ok {
		t.Fatalf("legacy session must report no boundary so caller does a full replay")
	}
	if len(msgs) != 3 {
		t.Fatalf("expected 3 messages preserved for full replay, got %d", len(msgs))
	}
}

func TestMatchesSearch(t *testing.T) {
	s := SessionInfo{FirstMessage: "Hello World", ID: "test-123"}
	if !MatchesSearch(s, "hello") {
		t.Fatal("should match case-insensitive")
	}
	if !MatchesSearch(s, "") {
		t.Fatal("empty query should match all")
	}
	if MatchesSearch(s, "zzz") {
		t.Fatal("should not match unrelated query")
	}
}
