package events

import (
	"log/slog"
	"sync"

	"github.com/hangtiancheng/lark-cli/apps/lark-code-go/internal/bus"
)

const subscriberBufferSize = 256

// EventBus provides a channel-based in-process publish/subscribe mechanism.
type EventBus struct {
	mu          sync.RWMutex
	subscribers []chan bus.Event
	closed      bool
}

// NewEventBus creates a new EventBus instance.
func NewEventBus() *EventBus {
	return &EventBus{}
}

// Subscribe registers a new subscriber and returns a channel for receiving events.
func (b *EventBus) Subscribe() <-chan bus.Event {
	b.mu.Lock()
	defer b.mu.Unlock()

	ch := make(chan bus.Event, subscriberBufferSize)
	b.subscribers = append(b.subscribers, ch)
	return ch
}

// Unsubscribe removes the specified subscriber's channel.
func (b *EventBus) Unsubscribe(ch <-chan bus.Event) {
	b.mu.Lock()
	defer b.mu.Unlock()

	for i, sub := range b.subscribers {
		if sub == ch {
			b.subscribers = append(b.subscribers[:i], b.subscribers[i+1:]...)
			close(sub)
			return
		}
	}
}

// Publish sends an event to all subscribers (non-blocking; drops and logs if channel is full).
func (b *EventBus) Publish(evt bus.Event) {
	b.mu.RLock()
	defer b.mu.RUnlock()

	if b.closed {
		return
	}

	for _, sub := range b.subscribers {
		select {
		case sub <- evt:
		default:
			slog.Warn("event bus: subscriber channel full, dropping event",
				"type", evt.EventType())
		}
	}
}

// Close closes all subscriber channels.
func (b *EventBus) Close() {
	b.mu.Lock()
	defer b.mu.Unlock()

	if b.closed {
		return
	}
	b.closed = true

	for _, sub := range b.subscribers {
		close(sub)
	}
	b.subscribers = nil
}
