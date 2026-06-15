package trace

import (
	"encoding/json"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
)

// Record represents a single trace record written to the NDJSON trace file.
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

// Writer asynchronously writes trace records to an NDJSON file via a buffered queue.
type Writer struct {
	path  string
	mu    sync.Mutex
	file  *os.File
	queue chan Record
	done  chan struct{}
}

// NewWriter creates a new trace Writer that appends to the file at the given path.
// Parent directories are created automatically if they do not exist.
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

// Write enqueues a trace record for asynchronous writing. If the queue is full, the record is dropped.
func (w *Writer) Write(rec Record) {
	select {
	case w.queue <- rec:
	default:
		slog.Warn("trace writer: queue full, dropping record")
	}
}

// Stop closes the writer, flushes any queued records, and closes the underlying file.
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

// writeLoop consumes records from the queue and writes them to the file as NDJSON lines.
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
