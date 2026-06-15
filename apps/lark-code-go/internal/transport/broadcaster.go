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

// subscription 表示单个客户端的事件订阅
type subscription struct {
	subID  string
	writer io.Writer
	topics []string
	scope  string
}

// Broadcaster 将 EventBus 事件按 topic/scope 过滤后推送给订阅客户端
type Broadcaster struct {
	mu            sync.RWMutex
	subscriptions []*subscription
	nextID        int
}

// NewBroadcaster 创建事件广播器
func NewBroadcaster() *Broadcaster {
	return &Broadcaster{}
}

// RegisterWriter 为新连接注册 writer
func (b *Broadcaster) RegisterWriter(w io.Writer) {
	b.mu.Lock()
	defer b.mu.Unlock()

	// 先检查是否已注册
	for _, sub := range b.subscriptions {
		if sub.writer == w {
			return
		}
	}

	b.nextID++
	sub := &subscription{
		subID:  fmt.Sprintf("sub-%x", b.nextID),
		writer: w,
		topics: []string{"*"}, // 默认订阅所有事件
		scope:  "global",
	}
	b.subscriptions = append(b.subscriptions, sub)
}

// Subscribe 为指定 writer 设置 topic/scope 过滤条件
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

	// Writer 未注册，创建新订阅
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

// UnsubscribeWriter 移除指定 writer 的所有订阅
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

// Handle 处理来自 EventBus 的事件，推送给匹配的订阅者
func (b *Broadcaster) Handle(evt bus.Event) {
	b.mu.RLock()
	defer b.mu.RUnlock()

	eventType := evt.EventType()

	// 提取 run_id 用于 scope 过滤
	runID := extractRunID(evt)

	for _, sub := range b.subscriptions {
		// 检查 scope
		if sub.scope != "global" && sub.scope != "" {
			if runID == "" {
				continue
			}
			expectedScope := "run:" + runID
			if sub.scope != expectedScope {
				continue
			}
		}

		// 检查 topic
		if !events.MatchTopics(eventType, sub.topics) {
			continue
		}

		// 构造推送信封并发送
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

// extractRunID 从事件中提取 run_id
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
