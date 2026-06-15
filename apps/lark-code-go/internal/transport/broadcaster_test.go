package transport_test

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/hangtiancheng/lark-cli/apps/lark-code-go/internal/bus"
	"github.com/hangtiancheng/lark-cli/apps/lark-code-go/internal/transport"
)

// mockWriter is a test writer that records all data written to it.
type mockWriter struct {
	buf bytes.Buffer
}

func (w *mockWriter) Write(p []byte) (int, error) {
	return w.buf.Write(p)
}

func (w *mockWriter) String() string {
	return w.buf.String()
}

func TestBroadcasterRegisterAndHandle(t *testing.T) {
	b := transport.NewBroadcaster()
	w := &mockWriter{}

	b.RegisterWriter(w)

	evt := &bus.RunStartedEvent{
		Type:  "run.started",
		RunID: "run-1",
		Goal:  "test goal",
		TS:    time.Now().UTC().Format(time.RFC3339),
	}

	b.Handle(evt)

	output := w.String()
	if output == "" {
		t.Fatal("expected output, got empty")
	}

	// Verify the output is valid JSON.
	lines := strings.Split(strings.TrimSpace(output), "\n")
	if len(lines) != 1 {
		t.Fatalf("expected 1 line, got %d", len(lines))
	}

	var envelope map[string]json.RawMessage
	if err := json.Unmarshal([]byte(lines[0]), &envelope); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}

	if _, ok := envelope["kind"]; !ok {
		t.Error("missing 'kind' field in envelope")
	}
}

func TestBroadcasterTopicFilter(t *testing.T) {
	b := transport.NewBroadcaster()
	w := &mockWriter{}

	// Subscribe only to run.* events.
	b.Subscribe(w, []string{"run.*"}, "global")

	// Event that should be received.
	b.Handle(&bus.RunStartedEvent{
		Type:  "run.started",
		RunID: "run-1",
		TS:    time.Now().UTC().Format(time.RFC3339),
	})

	// Event that should NOT be received.
	b.Handle(&bus.ToolCallStartedEvent{
		Type:      "tool.call_started",
		RunID:     "run-1",
		ToolUseID: "tool-use-1",
		ToolName:  "bash",
		TS:        time.Now().UTC().Format(time.RFC3339),
	})

	output := w.String()
	lines := strings.Split(strings.TrimSpace(output), "\n")

	// There should be exactly 1 line (run.started).
	if len(lines) != 1 {
		t.Errorf("expected 1 line (only run.started), got %d: %s", len(lines), output)
	}
}

func TestBroadcasterScopeFilter(t *testing.T) {
	b := transport.NewBroadcaster()
	w := &mockWriter{}

	// Subscribe only to events for run-1.
	b.Subscribe(w, []string{"*"}, "run:run-1")

	// Should be received (matching run_id).
	b.Handle(&bus.RunStartedEvent{
		Type:  "run.started",
		RunID: "run-1",
		TS:    time.Now().UTC().Format(time.RFC3339),
	})

	// Should NOT be received (different run_id).
	b.Handle(&bus.RunStartedEvent{
		Type:  "run.started",
		RunID: "run-2",
		TS:    time.Now().UTC().Format(time.RFC3339),
	})

	output := w.String()
	lines := strings.Split(strings.TrimSpace(output), "\n")

	if len(lines) != 1 {
		t.Errorf("expected 1 line (only run-1), got %d: %s", len(lines), output)
	}
}

func TestBroadcasterUnsubscribeWriter(t *testing.T) {
	b := transport.NewBroadcaster()
	w := &mockWriter{}

	b.RegisterWriter(w)

	// Send one event.
	b.Handle(&bus.RunStartedEvent{
		Type:  "run.started",
		RunID: "run-1",
		TS:    time.Now().UTC().Format(time.RFC3339),
	})

	// Unsubscribe.
	b.UnsubscribeWriter(w)

	// Send another event after unsubscribing.
	b.Handle(&bus.RunFinishedEvent{
		Type:   "run.finished",
		RunID:  "run-1",
		Status: "success",
		TS:     time.Now().UTC().Format(time.RFC3339),
	})

	output := w.String()
	lines := strings.Split(strings.TrimSpace(output), "\n")

	// There should be exactly 1 line (the event received before unsubscribing).
	if len(lines) != 1 {
		t.Errorf("expected 1 line (before unsubscribe), got %d: %s", len(lines), output)
	}
}

func TestBroadcasterMultipleWriters(t *testing.T) {
	b := transport.NewBroadcaster()
	w1 := &mockWriter{}
	w2 := &mockWriter{}

	b.RegisterWriter(w1)
	b.RegisterWriter(w2)

	b.Handle(&bus.RunStartedEvent{
		Type:  "run.started",
		RunID: "run-1",
		TS:    time.Now().UTC().Format(time.RFC3339),
	})

	if w1.String() == "" {
		t.Error("w1 should have received event")
	}
	if w2.String() == "" {
		t.Error("w2 should have received event")
	}
}

func TestBroadcasterWildcardSubscription(t *testing.T) {
	b := transport.NewBroadcaster()
	w := &mockWriter{}

	// Subscribe to all events.
	b.Subscribe(w, []string{"*"}, "global")

	b.Handle(&bus.RunStartedEvent{Type: "run.started", RunID: "run-1", TS: "now"})
	b.Handle(&bus.ToolCallStartedEvent{Type: "tool.call_started", RunID: "run-1", ToolUseID: "tool-use-1", ToolName: "bash", TS: "now"})
	b.Handle(&bus.SessionCreatedEvent{Type: "session.created", SessionID: "session-1", TS: "now"})

	output := w.String()
	lines := strings.Split(strings.TrimSpace(output), "\n")

	if len(lines) != 3 {
		t.Errorf("expected 3 lines for wildcard subscription, got %d", len(lines))
	}
}

func TestBroadcasterGlobalScopeReceivesAll(t *testing.T) {
	b := transport.NewBroadcaster()
	w := &mockWriter{}

	// Global scope should receive all events (including those without run_id).
	b.Subscribe(w, []string{"*"}, "global")

	b.Handle(&bus.SessionCreatedEvent{
		Type:      "session.created",
		SessionID: "session-1",
		TS:        time.Now().UTC().Format(time.RFC3339),
	})

	output := w.String()
	if output == "" {
		t.Error("global scope should receive events without run_id")
	}
}
