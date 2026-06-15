package transport

import (
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"sync"

	"github.com/hangtiancheng/lark-cli/apps/lark-code-go/internal/bus"
	"github.com/hangtiancheng/lark-cli/apps/lark-code-go/internal/events"
)

// subscription represents a single client's event subscription.
type subscription struct {
	subID  string
	writer io.Writer
	topics []string
	scope  string
}

// Broadcaster filters EventBus events by topic and scope, then pushes matching events to subscribed clients.
type Broadcaster struct {
	mu            sync.RWMutex
	subscriptions []*subscription
	nextID        int
}

// NewBroadcaster creates a new event broadcaster.
func NewBroadcaster() *Broadcaster {
	return &Broadcaster{}
}

// RegisterWriter registers a writer for a new connection.
func (b *Broadcaster) RegisterWriter(w io.Writer) {
	b.mu.Lock()
	defer b.mu.Unlock()

	// Check if the writer is already registered.
	for _, sub := range b.subscriptions {
		if sub.writer == w {
			return
		}
	}

	b.nextID++
	sub := &subscription{
		subID:  fmt.Sprintf("sub-%x", b.nextID),
		writer: w,
		topics: []string{"*"}, // Subscribe to all events by default.
		scope:  "global",
	}
	b.subscriptions = append(b.subscriptions, sub)
}

// Subscribe sets the topic/scope filters for a given writer.
func (b *Broadcaster) Subscribe(w io.Writer, topics []string, scope string) string {
	b.mu.Lock()
	defer b.mu.Unlock()

	for _, sub := range b.subscriptions {
		if sub.writer == w {
			sub.topics = topics
			sub.scope = scope
			return sub.subID
		}
	}

	// Writer not registered; create a new subscription.
	b.nextID++
	sub := &subscription{
		subID:  fmt.Sprintf("sub-%x", b.nextID),
		writer: w,
		topics: topics,
		scope:  scope,
	}
	b.subscriptions = append(b.subscriptions, sub)
	return sub.subID
}

// UnsubscribeWriter removes all subscriptions for the given writer.
func (b *Broadcaster) UnsubscribeWriter(w io.Writer) {
	b.mu.Lock()
	defer b.mu.Unlock()

	for i, sub := range b.subscriptions {
		if sub.writer == w {
			b.subscriptions = append(b.subscriptions[:i], b.subscriptions[i+1:]...)
			return
		}
	}
}

// Handle processes an event from the EventBus and pushes it to matching subscribers.
func (b *Broadcaster) Handle(evt bus.Event) {
	b.mu.RLock()
	defer b.mu.RUnlock()

	eventType := evt.EventType()

	// Extract run_id for scope-based filtering.
	runID := extractRunID(evt)

	for _, sub := range b.subscriptions {
		// Check scope.
		if sub.scope != "global" && sub.scope != "" {
			if runID == "" {
				continue
			}
			expectedScope := "run:" + runID
			if sub.scope != expectedScope {
				continue
			}
		}

		// Check topic.
		if !events.MatchTopics(eventType, sub.topics) {
			continue
		}

		// Construct the push envelope and send it.
		envelope, err := bus.MakeEventPush(evt)
		if err != nil {
			slog.Error("broadcaster: failed to marshal event", "error", err)
			continue
		}

		data, err := json.Marshal(envelope)
		if err != nil {
			slog.Error("broadcaster: failed to marshal envelope", "error", err)
			continue
		}

		if _, err := sub.writer.Write(append(data, '\n')); err != nil {
			slog.Debug("broadcaster: write failed, will be cleaned up", "error", err)
		}
	}
}

// extractRunID extracts the run_id from the given event.
func extractRunID(evt bus.Event) string {
	switch e := evt.(type) {
	case *bus.RunStartedEvent:
		return e.RunID
	case *bus.RunFinishedEvent:
		return e.RunID
	case *bus.StepStartedEvent:
		return e.RunID
	case *bus.StepFinishedEvent:
		return e.RunID
	case *bus.ToolCallStartedEvent:
		return e.RunID
	case *bus.ToolCallFinishedEvent:
		return e.RunID
	case *bus.ToolCallFailedEvent:
		return e.RunID
	case *bus.LlmTokenEvent:
		return e.RunID
	case *bus.LlmUsageEvent:
		return e.RunID
	case *bus.LlmModelSelectedEvent:
		return e.RunID
	case *bus.LogLineEvent:
		return e.RunID
	case *bus.PermissionRequestedEvent:
		return e.RunID
	case *bus.PermissionGrantedEvent:
		return e.RunID
	case *bus.PermissionDeniedEvent:
		return e.RunID
	case *bus.SubagentStartedEvent:
		return e.RunID
	case *bus.SubagentFinishedEvent:
		return e.RunID
	case *bus.SkillInvokedEvent:
		return e.RunID
	case *bus.ContextCompactedEvent:
		return e.RunID
	}
	return ""
}
