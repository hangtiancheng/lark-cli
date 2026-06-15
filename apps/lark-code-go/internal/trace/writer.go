package trace

import (
	"encoding/json"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
)

// Record 表示单条追踪记录
type Record struct {
	TS        string         `json:"ts"`
	Direction string         `json:"direction"`
	Layer     string         `json:"layer"`
	Kind      string         `json:"kind"`
	RunID     string         `json:"run_id,omitempty"`
	Step      int            `json:"step,omitempty"`
	ClientID  string         `json:"client_id,omitempty"`
	Data      map[string]any `json:"data,omitempty"`
}

// Writer 异步写入追踪记录到 NDJSON 文件
type Writer struct {
	path  string
	mu    sync.Mutex
	file  *os.File
	queue chan Record
	done  chan struct{}
}

// NewWriter 创建 TraceWriter
func NewWriter(path string) (*Writer, error) {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}

	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return nil, err
	}

	w := &Writer{
		path:  path,
		file:  f,
		queue: make(chan Record, 1024),
		done:  make(chan struct{}),
	}

	go w.writeLoop()
	return w, nil
}

// Write 将记录入队（非阻塞）
func (w *Writer) Write(rec Record) {
	select {
	case w.queue <- rec:
	default:
		slog.Warn("trace writer: queue full, dropping record")
	}
}

// Stop 关闭 writer，刷新队列
func (w *Writer) Stop() {
	close(w.queue)
	<-w.done

	w.mu.Lock()
	defer w.mu.Unlock()
	if w.file != nil {
		_ = w.file.Close()
		w.file = nil
	}
}

// writeLoop 消费队列并写入文件
func (w *Writer) writeLoop() {
	defer close(w.done)

	for rec := range w.queue {
		data, err := json.Marshal(rec)
		if err != nil {
			slog.Error("trace writer: marshal error", "error", err)
			continue
		}

		w.mu.Lock()
		if w.file != nil {
			if _, err := w.file.Write(append(data, '\n')); err != nil {
				slog.Error("trace writer: write error", "error", err)
			}
		}
		w.mu.Unlock()
	}
}
