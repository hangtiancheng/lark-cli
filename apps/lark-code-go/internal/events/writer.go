package events

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sync"

	"github.com/hangtiancheng/lark-cli/apps/lark-code-go/internal/bus"
)

// EventWriter 消费 EventBus 事件并持久化到 events.jsonl
type EventWriter struct {
	dir    string
	mu     sync.Mutex
	file   *os.File
	stopCh chan struct{}
}

// NewEventWriter 创建 EventWriter，事件写入指定目录下的 events.jsonl
func NewEventWriter(dir string) (*EventWriter, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, fmt.Errorf("failed to create event dir: %w", err)
	}

	path := filepath.Join(dir, "events.jsonl")
	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return nil, fmt.Errorf("failed to open events file: %w", err)
	}

	return &EventWriter{
		dir:    dir,
		file:   f,
		stopCh: make(chan struct{}),
	}, nil
}

// Consume 从 channel 读取事件并写入文件，直到 channel 关闭或 Stop 被调用
func (w *EventWriter) Consume(ch <-chan bus.Event) {
	for {
		select {
		case evt, ok := <-ch:
			if !ok {
				return
			}
			w.writeEvent(evt)
		case <-w.stopCh:
			return
		}
	}
}

// Stop 停止写入并关闭文件
func (w *EventWriter) Stop() {
	select {
	case <-w.stopCh:
	default:
		close(w.stopCh)
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.file != nil {
		_ = w.file.Close()
		w.file = nil
	}
}

// writeEvent 将单个事件序列化为 JSON 行并写入文件
func (w *EventWriter) writeEvent(evt bus.Event) {
	data, err := bus.MarshalEvent(evt)
	if err != nil {
		slog.Error("event writer: failed to marshal event", "error", err)
		return
	}

	w.mu.Lock()
	defer w.mu.Unlock()

	if w.file == nil {
		return
	}

	if _, err := w.file.Write(append(data, '\n')); err != nil {
		slog.Error("event writer: failed to write", "error", err)
	}
}

// ReplayEvents 从 events.jsonl 文件中读取并按 topic 过滤，返回匹配的事件
func ReplayEvents(path string, topics []string) ([]json.RawMessage, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	var results []json.RawMessage
	for _, line := range splitLines(data) {
		if len(line) == 0 {
			continue
		}

		var probe struct {
			Type string `json:"type"`
		}
		if err := json.Unmarshal(line, &probe); err != nil {
			continue
		}

		if MatchTopics(probe.Type, topics) {
			results = append(results, json.RawMessage(line))
		}
	}
	return results, nil
}

// ReplayEventsWithCallback 从 events.jsonl 文件中读取事件，按 topic 过滤并逐条回调
func ReplayEventsWithCallback(path string, topics []string, callback func(data []byte)) int {
	data, err := os.ReadFile(path)
	if err != nil {
		return 0
	}

	count := 0
	for _, line := range splitLines(data) {
		if len(line) == 0 {
			continue
		}

		var probe struct {
			Type string `json:"type"`
		}
		if err := json.Unmarshal(line, &probe); err != nil {
			continue
		}

		if MatchTopics(probe.Type, topics) {
			callback(line)
			count++
		}
	}
	return count
}

// splitLines 将字节数据按换行符分割
func splitLines(data []byte) [][]byte {
	var lines [][]byte
	start := 0
	for i, b := range data {
		if b == '\n' {
			if i > start {
				lines = append(lines, data[start:i])
			}
			start = i + 1
		}
	}
	if start < len(data) {
		lines = append(lines, data[start:])
	}
	return lines
}

// MatchTopics 检查事件类型是否匹配任一 topic 模式（支持 * 通配符）
func MatchTopics(eventType string, topics []string) bool {
	for _, topic := range topics {
		if matchTopic(eventType, topic) {
			return true
		}
	}
	return false
}

// matchTopic 简单 fnmatch 实现：支持 "prefix.*" 和完整匹配
func matchTopic(eventType, pattern string) bool {
	if pattern == "*" {
		return true
	}
	// 支持 "prefix.*" 形式
	if len(pattern) >= 2 && pattern[len(pattern)-1] == '*' && pattern[len(pattern)-2] == '.' {
		prefix := pattern[:len(pattern)-1]
		return len(eventType) >= len(prefix) && eventType[:len(prefix)] == prefix
	}
	return eventType == pattern
}
