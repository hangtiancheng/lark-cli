package events

import (
	"log/slog"
	"sync"

	"github.com/hangtiancheng/lark-cli/apps/lark-code-go/internal/bus"
)

const subscriberBufferSize = 256

// EventBus 提供 channel-based 的进程内发布/订阅
type EventBus struct {
	mu          sync.RWMutex
	subscribers []chan bus.Event
	closed      bool
}

// NewEventBus 创建一个新的 EventBus
func NewEventBus() *EventBus {
	return &EventBus{}
}

// Subscribe 注册一个新订阅者，返回接收事件的 channel
func (b *EventBus) Subscribe() <-chan bus.Event {
	b.mu.Lock()
	defer b.mu.Unlock()

	ch := make(chan bus.Event, subscriberBufferSize)
	b.subscribers = append(b.subscribers, ch)
	return ch
}

// Unsubscribe 移除指定订阅者的 channel
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

// Publish 向所有订阅者发送事件（非阻塞，满则丢弃并记日志）
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

// Close 关闭所有订阅者 channel
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
