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

// EventWriter consumes events from the EventBus and persists them to events.jsonl.
type EventWriter struct {
	dir    string
	mu     sync.Mutex
	file   *os.File
	stopCh chan struct{}
}

// NewEventWriter creates a new EventWriter that writes events to events.jsonl in the specified directory.
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

// Consume reads events from a channel and writes them to the file until the channel closes or Stop is called.
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

// Stop stops the writer and closes the underlying file.
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

// writeEvent serializes a single event as a JSON line and writes it to the file.
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

// ReplayEvents reads events from an events.jsonl file, filters by topic, and returns matching events.
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

// ReplayEventsWithCallback reads events from an events.jsonl file, filters by topic, and invokes a callback for each match.
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

// splitLines splits byte data by newline characters.
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

// MatchTopics checks if an event type matches any of the given topic patterns (supports * wildcard).
func MatchTopics(eventType string, topics []string) bool {
	for _, topic := range topics {
		if matchTopic(eventType, topic) {
			return true
		}
	}
	return false
}

// matchTopic is a simple fnmatch implementation supporting 'prefix.*' and exact match.
func matchTopic(eventType, pattern string) bool {
	if pattern == "*" {
		return true
	}
	// Support 'prefix.*' pattern
	if len(pattern) >= 2 && pattern[len(pattern)-1] == '*' && pattern[len(pattern)-2] == '.' {
		prefix := pattern[:len(pattern)-1]
		return len(eventType) >= len(prefix) && eventType[:len(prefix)] == prefix
	}
	return eventType == pattern
}
