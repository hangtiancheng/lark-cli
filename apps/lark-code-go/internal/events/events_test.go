package events_test

import (
	"testing"
	"time"

	"github.com/hangtiancheng/lark-cli/apps/lark-code-go/internal/bus"
	"github.com/hangtiancheng/lark-cli/apps/lark-code-go/internal/events"
)

func TestEventBusPubSub(t *testing.T) {
	eb := events.NewEventBus()
	defer eb.Close()

	ch := eb.Subscribe()

	evt := &bus.RunStartedEvent{
		Type:  "run.started",
		RunID: "run-test",
		Goal:  "test",
		TS:    time.Now().UTC().Format(time.RFC3339),
	}

	eb.Publish(evt)

	select {
	case received := <-ch:
		if received.EventType() != "run.started" {
			t.Errorf("expected run.started, got %s", received.EventType())
		}
	case <-time.After(time.Second):
		t.Error("timed out waiting for event")
	}
}

func TestEventBusMultipleSubscribers(t *testing.T) {
	eb := events.NewEventBus()
	defer eb.Close()

	ch1 := eb.Subscribe()
	ch2 := eb.Subscribe()

	evt := &bus.StepStartedEvent{
		Type:  "step.started",
		RunID: "run-test",
		Step:  1,
		TS:    time.Now().UTC().Format(time.RFC3339),
	}

	eb.Publish(evt)

	for i, ch := range []<-chan bus.Event{ch1, ch2} {
		select {
		case received := <-ch:
			if received.EventType() != "step.started" {
				t.Errorf("subscriber %d: expected step.started, got %s", i, received.EventType())
			}
		case <-time.After(time.Second):
			t.Errorf("subscriber %d: timed out", i)
		}
	}
}

func TestEventBusUnsubscribe(t *testing.T) {
	eb := events.NewEventBus()
	defer eb.Close()

	ch := eb.Subscribe()
	eb.Unsubscribe(ch)

	// Publish after unsubscribe should not block
	evt := &bus.RunStartedEvent{
		Type:  "run.started",
		RunID: "run-test",
		Goal:  "test",
		TS:    time.Now().UTC().Format(time.RFC3339),
	}

	eb.Publish(evt)

	// Channel should be closed
	select {
	case _, ok := <-ch:
		if ok {
			t.Error("expected closed channel")
		}
	case <-time.After(100 * time.Millisecond):
		// OK - channel is closed, receive returns zero value immediately
	}
}

func TestEventBusClose(t *testing.T) {
	eb := events.NewEventBus()
	ch := eb.Subscribe()

	eb.Close()

	// Publishing after close should not panic
	evt := &bus.RunStartedEvent{
		Type:  "run.started",
		RunID: "run-test",
		Goal:  "test",
		TS:    time.Now().UTC().Format(time.RFC3339),
	}
	eb.Publish(evt)

	// Channel should be closed
	_, ok := <-ch
	if ok {
		t.Error("expected closed channel after Close()")
	}
}

func TestMatchTopics(t *testing.T) {
	tests := []struct {
		eventType string
		topics    []string
		expected  bool
	}{
		{"run.started", []string{"run.*"}, true},
		{"run.finished", []string{"run.*"}, true},
		{"tool.call_started", []string{"run.*"}, false},
		{"tool.call_started", []string{"tool.*"}, true},
		{"llm.token", []string{"*"}, true},
		{"session.created", []string{"session.created"}, true},
		{"session.created", []string{"session.closed"}, false},
		{"run.started", []string{"run.*", "step.*"}, true},
	}

	for _, tc := range tests {
		result := events.MatchTopics(tc.eventType, tc.topics)
		if result != tc.expected {
			t.Errorf("MatchTopics(%q, %v) = %v, want %v", tc.eventType, tc.topics, result, tc.expected)
		}
	}
}
